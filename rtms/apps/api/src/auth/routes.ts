import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { audit } from '../audit/audit.js';
import type { AppContext } from '../context.js';
import { randomToken, sha256, safeEqual } from '../crypto.js';
import { withTenant } from '../db.js';
import { badRequest, HttpError, unauthorized } from '../errors.js';
import { burnDummyVerify, hashPassword, passwordProblems, verifyPassword } from '../security/password.js';
import { loadPermissions, requireSession, SESSION_COOKIE } from '../security/guard.js';
import { ROLES } from '../security/permissions.js';
import { APP_VERSION } from '../version.js';
import type { SessionData } from '../security/session.js';

authenticator.options = { window: 1, step: 30, digits: 6 };

const LOCK_AFTER = 5;

const userKey = (req: FastifyRequest) => `u:${req.session?.userId ?? req.ip}`;
const loginKey = (req: FastifyRequest) => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return `l:${req.ip}:${typeof email === 'string' ? sha256(email.toLowerCase()).slice(0, 16) : '-'}`;
};
const MAX_MFA_ATTEMPTS = 5;

interface FoundUser {
  id: string; company_id: string; password_hash: string; status: string;
  locked_until: Date | null; mfa_enabled: boolean; role_key: string; full_name: string;
}

export function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const cookieName = SESSION_COOKIE(ctx.config.COOKIE_SECURE);
  const mfaRequiredRoles = new Set(ctx.config.MFA_REQUIRED_ROLES.split(',').map((s) => s.trim()));

  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(cookieName, token, {
      path: '/', httpOnly: true, secure: ctx.config.COOKIE_SECURE, sameSite: 'strict',
      maxAge: ctx.config.SESSION_ABSOLUTE_HOURS * 3600,
    });
  const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

  async function publicSession(s: SessionData) {
    const perms = s.state === 'active' ? [...(await loadPermissions(ctx, s.companyId, s.roleKey))] : [];
    return {
      user: { id: s.userId, fullName: s.fullName, role: s.roleKey, roleLabel: ROLES[s.roleKey as keyof typeof ROLES] ?? s.roleKey },
      state: s.state, csrfToken: s.csrf, permissions: perms, license: ctx.license.status(),
      instance: ctx.config.INSTANCE_NAME, version: APP_VERSION,
    };
  }

  // ---------- Connexion ----------
  app.post('/api/auth/login', {
    // Clé = IP + compte visé : un bureau derrière une seule IP publique (NAT) n'est pas bloqué
    // en entier par un seul poste ; la limite globale par IP reste active en plus.
    config: { rateLimit: { max: ctx.config.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: loginKey } },
  }, async (req, reply) => {
    const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!body.success) throw badRequest('Identifiants invalides');
    const email = body.data.email.toLowerCase();
    const generic = new HttpError(401, 'identifiants_invalides', 'E-mail ou mot de passe incorrect');

    const [u] = await ctx.prisma.$queryRaw<FoundUser[]>`SELECT * FROM auth_find_user(${email})`;
    if (!u) {
      await burnDummyVerify(body.data.password);
      await ctx.prisma.$transaction((tx) => audit(tx, { action: 'auth.login_failed', entity: 'user', after: { emailHash: sha256(email) }, ...meta(req) }));
      throw generic;
    }
    const tenant = { companyId: u.company_id, userId: u.id };
    if (u.status !== 'active') {
      await burnDummyVerify(body.data.password);
      throw generic;
    }
    if (u.locked_until && u.locked_until > new Date()) {
      await burnDummyVerify(body.data.password);
      throw new HttpError(423, 'compte_verrouille', 'Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard.');
    }

    const ok = await verifyPassword(u.password_hash, body.data.password);
    if (!ok) {
      await withTenant(ctx.prisma, tenant, async (tx) => {
        const user = await tx.user.update({ where: { id: u.id }, data: { failedLogins: { increment: 1 } } });
        if (user.failedLogins >= LOCK_AFTER) {
          // Verrouillage progressif : 15 min, 30, 60... plafonné à 24 h
          const minutes = Math.min(15 * 2 ** (user.failedLogins - LOCK_AFTER), 1440);
          await tx.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() + minutes * 60000) } });
          await audit(tx, { ...tenant, action: 'auth.account_locked', entity: 'user', entityId: u.id, after: { minutes }, ...meta(req) });
        }
        await audit(tx, { ...tenant, action: 'auth.login_failed', entity: 'user', entityId: u.id, ...meta(req) });
      });
      throw generic;
    }

    await withTenant(ctx.prisma, tenant, async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
      await audit(tx, { ...tenant, action: 'auth.password_ok', entity: 'user', entityId: u.id, ...meta(req) });
    });

    const state: SessionData['state'] = u.mfa_enabled ? 'mfa_pending' : mfaRequiredRoles.has(u.role_key) ? 'mfa_enroll' : 'active';
    const { token, session } = await ctx.sessions.create({
      userId: u.id, companyId: u.company_id, roleKey: u.role_key, fullName: u.full_name, state,
      ip: req.ip, ua: req.headers['user-agent']?.slice(0, 200),
    });
    setCookie(reply, token);
    return publicSession(session);
  });

  // ---------- Vérification MFA (TOTP ou code de secours) ----------
  app.post('/api/auth/mfa/verify', {
    preHandler: requireSession(ctx, ['mfa_pending']),
    config: { rateLimit: { max: 10, timeWindow: '5 minutes', hook: 'preHandler', keyGenerator: userKey } },
  }, async (req, reply) => {
    const s = req.session!;
    const body = z.object({ code: z.string().trim().min(6).max(32) }).safeParse(req.body);
    if (!body.success) throw badRequest('Code invalide');
    const tenant = { companyId: s.companyId, userId: s.userId };

    const user = await withTenant(ctx.prisma, tenant, (tx) => tx.user.findUniqueOrThrow({ where: { id: s.userId } }));
    let ok = false;
    let usedRecovery = false;
    const code = body.data.code.replace(/\s/g, '');
    if (/^\d{6}$/.test(code) && user.mfaSecretEnc) {
      const secret = ctx.cipher.decrypt(user.mfaSecretEnc, `mfa:${user.id}`);
      // Anti-rejeu : un code TOTP ne sert qu'une fois
      const replayKey = `totp:${user.id}:${code}`;
      ok = authenticator.check(code, secret) && (await ctx.redis.set(replayKey, '1', 'EX', 120, 'NX')) === 'OK';
    } else {
      const codes = user.recoveryCodes as string[];
      const h = sha256(code.toUpperCase());
      if (codes.includes(h)) {
        ok = true;
        usedRecovery = true;
        await withTenant(ctx.prisma, tenant, (tx) => tx.user.update({ where: { id: user.id }, data: { recoveryCodes: codes.filter((c) => c !== h) } }));
      }
    }

    if (!ok) {
      s.mfaAttempts = (s.mfaAttempts ?? 0) + 1;
      await withTenant(ctx.prisma, tenant, (tx) => audit(tx, { ...tenant, action: 'auth.mfa_failed', entity: 'user', entityId: s.userId, ...meta(req) }));
      if (s.mfaAttempts >= MAX_MFA_ATTEMPTS) {
        await ctx.sessions.destroy(req.sessionToken!, s.userId);
        throw new HttpError(401, 'mfa_trop_essais', 'Trop de tentatives. Reconnectez-vous.');
      }
      await ctx.sessions.save(req.sessionToken!, s);
      throw new HttpError(401, 'mfa_invalide', 'Code incorrect');
    }

    const { token, session } = await ctx.sessions.rotate(req.sessionToken!, s, { state: 'active', mfaAttempts: 0 });
    await withTenant(ctx.prisma, tenant, (tx) => audit(tx, { ...tenant, action: usedRecovery ? 'auth.login_recovery_code' : 'auth.login', entity: 'user', entityId: s.userId, ...meta(req) }));
    setCookie(reply, token);
    return publicSession(session);
  });

  // ---------- Enrôlement MFA ----------
  app.post('/api/auth/mfa/setup', { preHandler: requireSession(ctx, ['mfa_enroll', 'active']) }, async (req) => {
    const s = req.session!;
    const user = await withTenant(ctx.prisma, s, (tx) => tx.user.findUniqueOrThrow({ where: { id: s.userId }, select: { email: true, mfaEnabled: true } }));
    if (user.mfaEnabled) throw badRequest('La vérification en deux étapes est déjà active');
    const secret = authenticator.generateSecret(20);
    s.pendingMfaSecretEnc = ctx.cipher.encrypt(secret, `mfa:${s.userId}`);
    await ctx.sessions.save(req.sessionToken!, s);
    const uri = authenticator.keyuri(user.email, 'RAHA TRANSPORT RTMS', secret);
    return { secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
  });

  app.post('/api/auth/mfa/enable', {
    preHandler: requireSession(ctx, ['mfa_enroll', 'active']),
    config: { rateLimit: { max: 10, timeWindow: '5 minutes', hook: 'preHandler', keyGenerator: userKey } },
  }, async (req, reply) => {
    const s = req.session!;
    const body = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!body.success || !s.pendingMfaSecretEnc) throw badRequest('Lancez d’abord la configuration et saisissez le code à 6 chiffres');
    const secret = ctx.cipher.decrypt(s.pendingMfaSecretEnc, `mfa:${s.userId}`);
    if (!authenticator.check(body.data.code, secret)) throw new HttpError(401, 'mfa_invalide', 'Code incorrect');

    const recovery = Array.from({ length: 10 }, () => randomToken(8).replace(/[-_]/g, 'X').slice(0, 10).toUpperCase());
    await withTenant(ctx.prisma, s, async (tx) => {
      await tx.user.update({
        where: { id: s.userId },
        data: { mfaEnabled: true, mfaSecretEnc: s.pendingMfaSecretEnc, recoveryCodes: recovery.map((c) => sha256(c)) },
      });
      await audit(tx, { companyId: s.companyId, userId: s.userId, action: 'auth.mfa_enabled', entity: 'user', entityId: s.userId, ...meta(req) });
    });
    const { token, session } = await ctx.sessions.rotate(req.sessionToken!, s, { state: 'active', pendingMfaSecretEnc: undefined });
    setCookie(reply, token);
    return { ...(await publicSession(session)), recoveryCodes: recovery };
  });

  // ---------- Session courante / déconnexion ----------
  app.get('/api/auth/me', async (req) => {
    if (!req.session) throw unauthorized();
    return publicSession(req.session);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.session && req.sessionToken) {
      const s = req.session;
      await ctx.sessions.destroy(req.sessionToken, s.userId);
      await withTenant(ctx.prisma, s, (tx) => audit(tx, { companyId: s.companyId, userId: s.userId, action: 'auth.logout', entity: 'user', entityId: s.userId, ...meta(req) }));
    }
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });

  // ---------- Changement de mot de passe : révoque les autres sessions ----------
  app.post('/api/auth/password', {
    preHandler: requireSession(ctx),
    config: { rateLimit: { max: 5, timeWindow: '15 minutes', hook: 'preHandler', keyGenerator: userKey } },
  }, async (req) => {
    const s = req.session!;
    const body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).safeParse(req.body);
    if (!body.success) throw badRequest('Champs manquants');
    const user = await withTenant(ctx.prisma, s, (tx) => tx.user.findUniqueOrThrow({ where: { id: s.userId } }));
    if (!(await verifyPassword(user.passwordHash, body.data.current))) throw new HttpError(401, 'identifiants_invalides', 'Mot de passe actuel incorrect');
    const problems = passwordProblems(body.data.next, user.email);
    if (problems.length) throw badRequest(`Mot de passe refusé : ${problems.join(', ')}`, problems);
    if (safeEqual(body.data.current, body.data.next)) throw badRequest('Le nouveau mot de passe doit être différent');
    const hash = await hashPassword(body.data.next);
    await withTenant(ctx.prisma, s, async (tx) => {
      await tx.user.update({ where: { id: s.userId }, data: { passwordHash: hash, passwordChangedAt: new Date() } });
      await audit(tx, { companyId: s.companyId, userId: s.userId, action: 'auth.password_changed', entity: 'user', entityId: s.userId, ...meta(req) });
    });
    await ctx.sessions.destroyAllForUser(s.userId, req.sessionToken);
    return { ok: true };
  });
}
