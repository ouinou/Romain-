import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildIssuerApp } from '../../src/licensing/issuer.js';
import { LicenseGuard } from '../../src/licensing/guard.js';
import { generateLicenseKeyPair, loadPrivateKey } from '../../src/licensing/token.js';
import { sha256 } from '../../src/crypto.js';
import { Client, LICENSE_DB, mission, newCompany, owner, startApp } from './helpers.js';

const keys = generateLicenseKeyPair();
const ADMIN_TOKEN = 'jeton-admin-editeur-de-test';
const licDb = new PrismaClient({ datasources: { db: { url: LICENSE_DB } } });
let issuer: FastifyInstance;

/** fetch() qui route vers le serveur de licences en mémoire, avec une IP simulée. */
const viaIssuer = (ip = '10.0.0.1'): typeof fetch => (async (url: string, init?: RequestInit) => {
  const r = await issuer.inject({ method: (init?.method ?? 'GET') as 'POST', url: new URL(url).pathname, payload: init?.body as string, headers: { 'content-type': 'application/json' }, remoteAddress: ip });
  return new Response(r.body, { status: r.statusCode });
}) as typeof fetch;

async function createLicense(over: Record<string, unknown> = {}) {
  const r = await issuer.inject({ method: 'POST', url: '/licensing/admin/licenses', headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { customer: 'RAHA TRANSPORT', plan: 'pro', maxDevices: 1, maxUsers: 20, expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(), ...over } });
  expect(r.statusCode).toBe(200);
  return r.json() as { id: string; licenseKey: string };
}

async function freshGuard(deviceId: string, ip?: string) {
  // Chaque garde simule une installation distincte
  await owner.installation.deleteMany({});
  return new LicenseGuard(owner, { publicKeyPem: keys.publicKeyPem, issuerUrl: 'http://issuer', enforcement: 'enforce', graceDays: 7, deviceId, fetchImpl: viaIssuer(ip) }).init();
}

beforeAll(async () => {
  issuer = await buildIssuerApp({ prisma: licDb, privateKey: loadPrivateKey(keys.privateKeyPem), adminTokenSha256: sha256(ADMIN_TOKEN), anomaly: { maxAttemptsPerDay: 50, maxDistinctIpsPerDay: 3 } });
  await issuer.ready();
});
afterAll(async () => { await issuer.close(); await licDb.$disconnect(); await owner.installation.deleteMany({}); });

describe('Serveur de licences', () => {
  it('administration protégée par jeton', async () => {
    const r = await issuer.inject({ method: 'POST', url: '/licensing/admin/licenses', payload: {} });
    expect(r.statusCode).toBe(401);
  });

  it('la clé de licence n’est stockée qu’en empreinte', async () => {
    const { id, licenseKey } = await createLicense();
    const row = await licDb.license.findUniqueOrThrow({ where: { id } });
    expect(row.keyHash).not.toContain(licenseKey);
    expect(licenseKey).toMatch(/^RTMS-[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  });

  it('activation, liaison à l’appareil et limite d’appareils', async () => {
    const { licenseKey } = await createLicense({ maxDevices: 1 });
    const g1 = await freshGuard(`dev-${randomUUID()}`);
    expect(g1.status().state).toBe('missing');
    expect(g1.writable()).toBe(false);
    await g1.activate(licenseKey, 'test');
    expect(g1.status()).toMatchObject({ state: 'valid', plan: 'pro', maxUsers: 20 });

    // Une 2e installation avec la même clé : refusée (1 appareil autorisé)
    const g2 = await freshGuard(`dev-${randomUUID()}`);
    await expect(g2.activate(licenseKey, 'test')).rejects.toThrow(/maximal/);
  });

  it('un jeton copié sur une autre machine est rejeté', async () => {
    const { licenseKey } = await createLicense();
    const g1 = await freshGuard('machine-A');
    await g1.activate(licenseKey, 'test');
    const token = (await owner.installation.findUniqueOrThrow({ where: { id: 1 } })).licenseToken!;
    const g2 = await freshGuard('machine-B');
    await expect(g2.installToken(token)).rejects.toThrow(/installation|device/);
  });

  it('un jeton falsifié est rejeté (installation et serveur)', async () => {
    const { licenseKey } = await createLicense();
    const g = await freshGuard('machine-F');
    await g.activate(licenseKey, 'test');
    const token = (await owner.installation.findUniqueOrThrow({ where: { id: 1 } })).licenseToken!;
    const [p, body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString());
    const forged = `${p}.${Buffer.from(JSON.stringify({ ...payload, maxUsers: 9999 })).toString('base64url')}.${sig}`;
    await expect(g.installToken(forged)).rejects.toThrow(/signature/);
    const r = await issuer.inject({ method: 'POST', url: '/licensing/v1/refresh', payload: { token: forged } });
    expect(r.statusCode).toBe(400);
  });

  it('révocation : l’installation passe en consultation seule', async () => {
    const { id, licenseKey } = await createLicense();
    const g = await freshGuard('machine-R');
    await g.activate(licenseKey, 'test');
    expect((await g.refresh()).state).toBe('valid');
    await issuer.inject({ method: 'POST', url: `/licensing/admin/licenses/${id}/revoke`, headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, payload: { reason: 'Clé compromise' } });
    expect((await g.refresh()).state).toBe('revoked');
    expect(g.writable()).toBe(false);
    const crl = (await issuer.inject({ method: 'GET', url: '/licensing/v1/crl' })).json() as { crl: string };
    expect(JSON.parse(Buffer.from(crl.crl.split('.')[1]!, 'base64url').toString()).features).toContain(id);
  });

  it('licence expirée refusée à l’activation', async () => {
    const { licenseKey } = await createLicense({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const g = await freshGuard('machine-E');
    await expect(g.activate(licenseKey, 'test')).rejects.toThrow(/expirée/);
  });

  it('activations depuis trop d’adresses : licence suspendue automatiquement', async () => {
    const { id, licenseKey } = await createLicense({ maxDevices: 50 });
    for (let i = 1; i <= 4; i++) {
      const g = await freshGuard(`machine-ip-${i}`, `198.51.100.${i}`);
      const p = g.activate(licenseKey, 'test');
      if (i <= 3) await p; else await expect(p).rejects.toThrow(/suspendue/);
    }
    expect((await licDb.license.findUniqueOrThrow({ where: { id } })).status).toBe('suspended');
    const ev = await licDb.licenseEvent.findMany({ where: { licenseId: id, type: 'anomaly_suspended' } });
    expect(ev).toHaveLength(1);
  });
});

describe('Application de la licence par l’API', () => {
  it('sans licence (mode enforce) : lecture possible, écriture bloquée', async () => {
    await owner.installation.deleteMany({});
    const env = await startApp({ LICENSE_ENFORCEMENT: 'enforce', LICENSE_PUBLIC_KEY_PEM: keys.publicKeyPem, LICENSE_ISSUER_URL: 'http://issuer' }, { fetchImpl: viaIssuer(), deviceId: 'srv-1' });
    const co = await newCompany();
    const c = new Client(env.app);
    await c.login(co.email);
    expect((await c.get('/api/records/transport')).status).toBe(200);
    const blocked = await c.post('/api/records/transport', mission('L-1'));
    expect(blocked.status).toBe(402);

    const { licenseKey } = await createLicense();
    const act = await c.post('/api/admin/license/activate', { licenseKey });
    expect(act.body.state).toBe('valid');
    expect((await c.post('/api/records/transport', mission('L-1'))).status).toBe(201);
    await env.app.close(); env.ctx.redis.disconnect(); await env.ctx.prisma.$disconnect();
  });
});
