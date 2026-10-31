/**
 * Contrôle d'accès côté serveur : chaque route déclare (ressource, action).
 * L'interface web masque les boutons, mais seule cette vérification fait foi.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { withTenant } from '../db.js';
import { forbidden, HttpError, unauthorized } from '../errors.js';
import { permKey, type Action, type Resource } from './permissions.js';
import type { SessionData } from './session.js';

export const SESSION_COOKIE = (secure: boolean) => (secure ? '__Host-rtms_sid' : 'rtms_sid');

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionData;
    sessionToken?: string;
    perms?: Set<string>;
  }
}

export async function loadPermissions(ctx: AppContext, companyId: string, roleKey: string): Promise<Set<string>> {
  const cacheKey = `perm:${companyId}:${roleKey}`;
  const cached = await ctx.redis.get(cacheKey);
  if (cached) return new Set(JSON.parse(cached) as string[]);
  const rows = await withTenant(ctx.prisma, { companyId }, (tx) =>
    tx.rolePermission.findMany({ where: { companyId, roleKey }, select: { module: true, action: true } }),
  );
  const list = rows.map((r) => permKey(r.module, r.action));
  await ctx.redis.set(cacheKey, JSON.stringify(list), 'EX', 300);
  return new Set(list);
}

export async function invalidatePermissions(ctx: AppContext, companyId: string) {
  const keys = await ctx.redis.keys(`perm:${companyId}:*`);
  if (keys.length) await ctx.redis.del(...keys);
}

/** Session complète (MFA franchie) obligatoire. */
export function requireSession(ctx: AppContext, allowStates: SessionData['state'][] = ['active']) {
  return async (req: FastifyRequest) => {
    const s = req.session;
    if (!s) throw unauthorized();
    if (!allowStates.includes(s.state)) {
      throw new HttpError(401, s.state === 'mfa_enroll' ? 'mfa_enrolement_requis' : 'mfa_requis', 'Vérification en deux étapes requise');
    }
    req.perms ??= await loadPermissions(ctx, s.companyId, s.roleKey);
  };
}

export function requirePermission(ctx: AppContext, resource: Resource | ((req: FastifyRequest) => Resource), action: Action) {
  const base = requireSession(ctx);
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    await base(req);
    const r = typeof resource === 'function' ? resource(req) : resource;
    if (!req.perms!.has(permKey(r, action))) throw forbidden();
  };
}
