/**
 * Serveur de licences centralisé (exploité par l'éditeur, PAS livré chez le client).
 * Il détient la clé privée Ed25519 (chargée depuis Vault ou un secret monté).
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import type { PrismaClient } from '@prisma/client';
import type { KeyObject } from 'node:crypto';
import { createPublicKey, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { safeEqual, sha256 } from '../crypto.js';
import { signLicense, signRevocationList, verifyLicense, type LicensePayload } from './token.js';

export interface IssuerDeps {
  prisma: PrismaClient;
  privateKey: KeyObject;
  adminTokenSha256: string;
  refreshDays?: number;
  anomaly?: { maxAttemptsPerDay: number; maxDistinctIpsPerDay: number };
  logger?: boolean;
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
export function newLicenseKey(): string {
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('');
  return `RTMS-${chars.match(/.{5}/g)!.join('-')}`;
}
const keyHash = (k: string) => sha256(k.trim().toUpperCase());

export async function buildIssuerApp(deps: IssuerDeps): Promise<FastifyInstance> {
  const { prisma, privateKey } = deps;
  const refreshDays = deps.refreshDays ?? 30;
  const anomaly = deps.anomaly ?? { maxAttemptsPerDay: 20, maxDistinctIpsPerDay: 5 };
  const publicKey = createPublicKey(privateKey);

  const app = Fastify({ logger: deps.logger ?? false, trustProxy: 'loopback', bodyLimit: 16 * 1024 });
  await app.register(helmet);
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

  const err = (code: number, message: string, extra: object = {}) => Object.assign(new Error(message), { statusCode: code, extra });
  app.setErrorHandler((e: Error & { statusCode?: number; extra?: object }, _req, reply) => {
    const code = e.statusCode && e.statusCode < 500 ? e.statusCode : 500;
    reply.status(code).send({ message: code === 500 ? 'Erreur interne' : e.message, ...(e.extra ?? {}) });
  });

  const event = (licenseId: string | null, type: string, ip: string | undefined, detail: object = {}) =>
    prisma.licenseEvent.create({ data: { licenseId, type, ip, detail } });

  function issue(lic: { id: string; customer: string; plan: string; features: unknown; maxUsers: number; expiresAt: Date }, iid: string, dev: string) {
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.floor(lic.expiresAt.getTime() / 1000);
    const payload: LicensePayload = {
      v: 1, lid: lic.id, iid, dev, customer: lic.customer, plan: lic.plan,
      features: (lic.features as string[]) ?? [], maxUsers: lic.maxUsers,
      iat: now, exp, refreshBy: Math.min(exp, now + refreshDays * 86400),
    };
    return signLicense(payload, privateKey);
  }

  // ---------- Activation ----------
  app.post('/licensing/v1/activate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({
      licenseKey: z.string().min(10).max(64),
      installationId: z.string().uuid(),
      deviceHash: z.string().regex(/^[a-f0-9]{64}$/),
      appVersion: z.string().max(40).optional(),
    }).safeParse(req.body);
    if (!b.success) throw err(400, 'Requête invalide');
    const { installationId, deviceHash } = b.data;
    const lic = await prisma.license.findUnique({ where: { keyHash: keyHash(b.data.licenseKey) }, include: { activations: true } });
    if (!lic) {
      await event(null, 'activation_unknown_key', req.ip, { installationId });
      throw err(404, 'Clé de licence inconnue');
    }
    await event(lic.id, 'activation_attempt', req.ip, { installationId, appVersion: b.data.appVersion });

    // Détection d'activations anormales sur 24 h
    const since = new Date(Date.now() - 86400_000);
    const recent = await prisma.licenseEvent.findMany({ where: { licenseId: lic.id, type: 'activation_attempt', at: { gte: since } }, select: { ip: true } });
    const ips = new Set(recent.map((r) => r.ip));
    if (ips.size > anomaly.maxDistinctIpsPerDay && lic.status === 'active') {
      await prisma.license.update({ where: { id: lic.id }, data: { status: 'suspended' } });
      await event(lic.id, 'anomaly_suspended', req.ip, { distinctIps: ips.size });
      throw err(403, 'Licence suspendue : activations depuis trop d’adresses différentes. Contactez l’éditeur.');
    }
    if (recent.length > anomaly.maxAttemptsPerDay) {
      await event(lic.id, 'anomaly_rate', req.ip, { attempts: recent.length });
      throw err(429, 'Trop de tentatives d’activation pour cette licence');
    }

    if (lic.status !== 'active') throw err(403, `Licence ${lic.status === 'revoked' ? 'révoquée' : 'suspendue'}`, { revoked: lic.status === 'revoked' });
    if (lic.expiresAt <= new Date()) throw err(403, 'Licence expirée');

    const existing = lic.activations.find((a) => a.installationId === installationId && a.deviceHash === deviceHash);
    if (existing?.revokedAt) throw err(403, 'Cet appareil a été révoqué', { revoked: true });
    if (!existing) {
      const active = lic.activations.filter((a) => !a.revokedAt).length;
      if (active >= lic.maxDevices) {
        await event(lic.id, 'device_limit', req.ip, { installationId, active, max: lic.maxDevices });
        throw err(409, `Nombre maximal d’appareils atteint (${lic.maxDevices})`);
      }
      await prisma.licenseActivation.create({ data: { licenseId: lic.id, installationId, deviceHash, ip: req.ip } });
      await event(lic.id, 'activated', req.ip, { installationId });
    } else {
      await prisma.licenseActivation.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), ip: req.ip } });
    }
    return { token: issue(lic, installationId, deviceHash) };
  });

  // ---------- Renouvellement périodique ----------
  app.post('/licensing/v1/refresh', async (req) => {
    const b = z.object({ token: z.string().max(4096) }).safeParse(req.body);
    if (!b.success) throw err(400, 'Requête invalide');
    // On lit d'abord le contenu, puis on vérifie la signature contre ses propres valeurs
    let claimed: LicensePayload;
    try {
      claimed = JSON.parse(Buffer.from(b.data.token.split('.')[1] ?? '', 'base64url').toString());
    } catch { throw err(400, 'Jeton illisible'); }
    const v = verifyLicense(b.data.token, publicKey, { installationId: claimed.iid, deviceHash: claimed.dev, graceSeconds: 365 * 86400 });
    if (!v.ok && v.reason !== 'expired') throw err(400, 'Jeton falsifié ou invalide');
    const lic = await prisma.license.findUnique({ where: { id: claimed.lid } });
    if (!lic) throw err(404, 'Licence inconnue');
    const act = await prisma.licenseActivation.findUnique({ where: { licenseId_installationId_deviceHash: { licenseId: lic.id, installationId: claimed.iid, deviceHash: claimed.dev } } });
    if (lic.status === 'revoked' || !act || act.revokedAt) {
      await event(lic.id, 'refresh_refused_revoked', req.ip, { installationId: claimed.iid });
      throw err(403, 'Licence révoquée', { revoked: true });
    }
    if (lic.status !== 'active') throw err(403, 'Licence suspendue');
    if (lic.expiresAt <= new Date()) throw err(403, 'Abonnement expiré');
    await prisma.licenseActivation.update({ where: { id: act.id }, data: { lastSeenAt: new Date(), ip: req.ip } });
    return { token: issue(lic, claimed.iid, claimed.dev) };
  });

  app.get('/licensing/v1/crl', async () => {
    const revoked = await prisma.license.findMany({ where: { status: 'revoked' }, select: { id: true } });
    return { crl: signRevocationList(revoked.map((r) => r.id), privateKey) };
  });
  app.get('/licensing/v1/public-key', async () => ({ pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }));

  // ---------- Administration éditeur ----------
  const adminGuard = async (req: FastifyRequest) => {
    const h = req.headers.authorization ?? '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok || !safeEqual(sha256(tok), deps.adminTokenSha256)) throw err(401, 'Non autorisé');
  };

  app.post('/licensing/admin/licenses', { preHandler: adminGuard }, async (req) => {
    const b = z.object({
      customer: z.string().min(1).max(200), plan: z.string().min(1).max(40),
      maxDevices: z.number().int().min(1).max(100).default(1), maxUsers: z.number().int().min(1).max(10000).default(10),
      expiresAt: z.string().datetime(), features: z.array(z.string().max(40)).max(50).default([]),
    }).safeParse(req.body);
    if (!b.success) throw err(400, 'Requête invalide');
    const licenseKey = newLicenseKey();
    const lic = await prisma.license.create({ data: { ...b.data, expiresAt: new Date(b.data.expiresAt), keyHash: keyHash(licenseKey) } });
    await event(lic.id, 'created', req.ip, { plan: lic.plan });
    // La clé n'est affichée qu'une fois ; seule son empreinte est conservée
    return { id: lic.id, licenseKey };
  });

  app.get('/licensing/admin/licenses/:id', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const lic = await prisma.license.findUnique({ where: { id }, include: { activations: true, events: { orderBy: { at: 'desc' }, take: 100 } } });
    if (!lic) throw err(404, 'Licence inconnue');
    const { keyHash: _k, ...safe } = lic;
    return JSON.parse(JSON.stringify(safe, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
  });

  app.post('/licensing/admin/licenses/:id/revoke', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const reason = z.object({ reason: z.string().min(3).max(300) }).parse(req.body).reason;
    await prisma.license.update({ where: { id }, data: { status: 'revoked', revokedAt: new Date(), revokeReason: reason } });
    await event(id, 'revoked', req.ip, { reason });
    return { ok: true };
  });

  app.post('/licensing/admin/licenses/:id/renew', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ expiresAt: z.string().datetime(), reactivate: z.boolean().default(false) }).parse(req.body);
    const lic = await prisma.license.findUniqueOrThrow({ where: { id } });
    if (lic.status === 'revoked') throw err(409, 'Une licence révoquée ne peut pas être renouvelée');
    await prisma.license.update({ where: { id }, data: { expiresAt: new Date(b.expiresAt), ...(b.reactivate ? { status: 'active' } : {}) } });
    await event(id, 'renewed', req.ip, b);
    return { ok: true };
  });

  app.post('/licensing/admin/activations/:id/revoke', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const a = await prisma.licenseActivation.update({ where: { id }, data: { revokedAt: new Date() } });
    await event(a.licenseId, 'device_revoked', req.ip, { activationId: id });
    return { ok: true };
  });

  app.get('/healthz', async () => ({ ok: true }));
  return app;
}
