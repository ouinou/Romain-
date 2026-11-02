/**
 * Présence : qui est connecté en ce moment, avec quel profil et depuis quel poste.
 * Une entrée par session (un même utilisateur sur deux postes apparaît deux fois),
 * qui expire seule après 3 minutes sans activité. Rien n'est écrit en base.
 * Le nom de poste vient de l'application de bureau (en-tête x-rtms-poste) : c'est une
 * information d'affichage fournie par le client, pas une preuve d'identité.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppContext } from '../context.js';
import { sha256 } from '../crypto.js';
import { ROLES } from './permissions.js';
import { requirePermission } from './guard.js';
import type { SessionData } from './session.js';

const TTL = 180;
const THROTTLE_MS = 20_000;
const lastWrite = new Map<string, number>();
const key = (companyId: string, token: string) => `pres:${companyId}:${sha256(token).slice(0, 32)}`;

interface Presence { userId: string; name: string; roleKey: string; since: number; lastSeen: number; address: string; device: string }

const cleanDevice = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) : '');

export async function touchPresence(redis: Redis, s: SessionData, token: string, req: FastifyRequest) {
  if (s.state !== 'active') return;
  const k = key(s.companyId, token);
  const now = Date.now();
  if ((lastWrite.get(k) ?? 0) > now - THROTTLE_MS) return;
  lastWrite.set(k, now);
  if (lastWrite.size > 5000) lastWrite.clear();
  const p: Presence = { userId: s.userId, name: s.fullName, roleKey: s.roleKey, since: s.createdAt, lastSeen: now, address: req.ip, device: cleanDevice(req.headers['x-rtms-poste']) };
  await redis.set(k, JSON.stringify(p), 'EX', TTL);
}

export async function dropPresence(redis: Redis, companyId: string, token: string) {
  const k = key(companyId, token);
  lastWrite.delete(k);
  await redis.del(k);
}

export function presenceRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/presence', { preHandler: requirePermission(ctx, 'dashboard', 'read') }, async (req) => {
    const s = req.session!;
    const seeDetails = req.perms!.has('users:read');
    const keys = await ctx.redis.keys(`pres:${s.companyId}:*`);
    const mine = key(s.companyId, req.sessionToken!);
    const out = [];
    for (const k of keys.slice(0, 500)) {
      const raw = await ctx.redis.get(k);
      if (!raw) continue;
      const p = JSON.parse(raw) as Presence;
      out.push({
        name: p.name, roleKey: p.roleKey, roleLabel: (ROLES as Record<string, string>)[p.roleKey] ?? p.roleKey,
        since: new Date(p.since).toISOString(), lastSeen: new Date(p.lastSeen).toISOString(), me: k === mine,
        // Adresse et nom de poste : réservés aux profils qui gèrent les utilisateurs
        ...(seeDetails ? { address: p.address, device: p.device } : {}),
      });
    }
    return out.sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name, 'fr'));
  });
}
