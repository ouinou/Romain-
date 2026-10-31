import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { audit } from '../audit/audit.js';
import type { AppContext } from '../context.js';
import { randomInt } from 'node:crypto';
import { randomToken } from '../crypto.js';
import { withTenant } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { invalidatePermissions, requirePermission } from '../security/guard.js';
import { hashPassword, passwordProblems } from '../security/password.js';
import { ACTIONS, MODULES, ROLES, SCREENS } from '../security/permissions.js';
import { computeFields, isModule, MODULE_DEFS, recordSchema } from '../modules/definitions.js';
import { bumpCompanyGeneration, encryptSensitive } from '../modules/routes.js';
import type { ModuleKey } from '../security/permissions.js';

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(60).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(200)]).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
  currency: z.enum(['FCFA', 'EUR', 'USD']).default('FCFA'),
  language: z.enum(['Français', 'English']).default('Français'),
}).strict();

export function adminRoutes(app: FastifyInstance, ctx: AppContext, appVersion: string) {
  const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
  const tenant = (req: FastifyRequest) => ({ companyId: req.session!.companyId, userId: req.session!.userId });

  // ---------- Paramètres société (bouton auparavant factice) ----------
  app.get('/api/admin/settings', { preHandler: requirePermission(ctx, 'settings', 'read') }, async (req) =>
    withTenant(ctx.prisma, tenant(req), async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: req.session!.companyId } });
      return { name: c.name, ...(c.settings as object) };
    }));

  app.put('/api/admin/settings', { preHandler: requirePermission(ctx, 'settings', 'admin') }, async (req) => {
    const p = settingsSchema.safeParse(req.body);
    if (!p.success) throw badRequest('Paramètres invalides', p.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`));
    const { name, ...settings } = p.data;
    return withTenant(ctx.prisma, tenant(req), async (tx) => {
      const before = await tx.company.findUniqueOrThrow({ where: { id: req.session!.companyId } });
      await tx.company.update({ where: { id: before.id }, data: { name, settings } });
      await audit(tx, { ...tenant(req), action: 'settings.update', entity: 'company', entityId: before.id, before: { name: before.name, ...(before.settings as object) }, after: p.data, ...meta(req) });
      return p.data;
    });
  });

  // ---------- Utilisateurs ----------
  app.get('/api/admin/users', { preHandler: requirePermission(ctx, 'users', 'read') }, async (req) =>
    withTenant(ctx.prisma, tenant(req), (tx) => tx.user.findMany({
      select: { id: true, email: true, fullName: true, roleKey: true, status: true, mfaEnabled: true, lastLoginAt: true, lockedUntil: true },
      orderBy: { fullName: 'asc' },
    })));

  app.post('/api/admin/users', { preHandler: requirePermission(ctx, 'users', 'admin') }, async (req, reply) => {
    const b = z.object({
      email: z.string().trim().toLowerCase().email().max(200), fullName: z.string().trim().min(2).max(120),
      roleKey: z.enum(Object.keys(ROLES) as [string, ...string[]]),
    }).safeParse(req.body);
    if (!b.success) throw badRequest('Utilisateur invalide');
    const maxUsers = ctx.license.status().maxUsers;
    // Mot de passe initial aléatoire, à transmettre hors bande et à changer à la 1re connexion
    const temp = `${randomToken(12)}#${randomInt(10, 100)}`;
    try {
      const u = await withTenant(ctx.prisma, tenant(req), async (tx) => {
        if (maxUsers && (await tx.user.count({ where: { status: 'active' } })) >= maxUsers) throw conflict(`Limite de ${maxUsers} utilisateurs de la licence atteinte`);
        const created = await tx.user.create({ data: { ...b.data, companyId: req.session!.companyId, passwordHash: await hashPassword(temp) } });
        await audit(tx, { ...tenant(req), action: 'user.create', entity: 'user', entityId: created.id, after: b.data, ...meta(req) });
        return created;
      });
      reply.status(201);
      return { id: u.id, temporaryPassword: temp };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('E-mail déjà utilisé');
      throw e;
    }
  });

  app.patch('/api/admin/users/:id', { preHandler: requirePermission(ctx, 'users', 'admin') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({
      roleKey: z.enum(Object.keys(ROLES) as [string, ...string[]]).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      unlock: z.boolean().optional(),
      resetMfa: z.boolean().optional(),
    }).parse(req.body);
    if (id === req.session!.userId && (b.status === 'disabled' || (b.roleKey && b.roleKey !== 'admin'))) throw badRequest('Vous ne pouvez pas retirer vos propres droits');
    await withTenant(ctx.prisma, tenant(req), async (tx) => {
      const before = await tx.user.findFirst({ where: { id } });
      if (!before) throw notFound();
      await tx.user.update({
        where: { id },
        data: {
          ...(b.roleKey ? { roleKey: b.roleKey } : {}), ...(b.status ? { status: b.status } : {}),
          ...(b.unlock ? { failedLogins: 0, lockedUntil: null } : {}),
          ...(b.resetMfa ? { mfaEnabled: false, mfaSecretEnc: null, recoveryCodes: [] } : {}),
        },
      });
      await audit(tx, { ...tenant(req), action: 'user.update', entity: 'user', entityId: id, before: { roleKey: before.roleKey, status: before.status }, after: b, ...meta(req) });
    });
    if (b.status === 'disabled' || b.roleKey || b.resetMfa) await ctx.sessions.destroyAllForUser(id);
    return { ok: true };
  });

  // ---------- Permissions par rôle (paramétrables, CdC §8) ----------
  app.get('/api/admin/permissions', { preHandler: requirePermission(ctx, 'users', 'read') }, async (req) => {
    const rows = await withTenant(ctx.prisma, tenant(req), (tx) => tx.rolePermission.findMany());
    return { roles: ROLES, resources: [...MODULES, ...SCREENS], actions: ACTIONS, grants: rows.map((r) => `${r.roleKey}:${r.module}:${r.action}`) };
  });

  app.put('/api/admin/permissions/:role', { preHandler: requirePermission(ctx, 'users', 'admin') }, async (req) => {
    const { role } = z.object({ role: z.enum(Object.keys(ROLES) as [string, ...string[]]) }).parse(req.params);
    if (role === 'admin') throw badRequest('Les droits Administrateur ne sont pas modifiables (anti-verrouillage)');
    const grants = z.array(z.string().regex(/^[a-z]+:[a-z]+$/)).max(500).parse((req.body as { grants?: unknown })?.grants);
    const valid = new Set([...MODULES, ...SCREENS].flatMap((m) => ACTIONS.map((a) => `${m}:${a}`)));
    for (const g of grants) if (!valid.has(g)) throw badRequest(`Permission inconnue : ${g}`);
    await withTenant(ctx.prisma, tenant(req), async (tx) => {
      const before = await tx.rolePermission.findMany({ where: { roleKey: role } });
      await tx.rolePermission.deleteMany({ where: { roleKey: role } });
      await tx.rolePermission.createMany({ data: grants.map((g) => { const [module, action] = g.split(':') as [string, string]; return { companyId: req.session!.companyId, roleKey: role, module, action }; }) });
      await audit(tx, { ...tenant(req), action: 'permissions.update', entity: 'role', entityId: role, before: before.map((r) => `${r.module}:${r.action}`), after: grants, ...meta(req) });
    });
    await invalidatePermissions(ctx, req.session!.companyId);
    return { ok: true };
  });

  // ---------- Journal d'audit ----------
  app.get('/api/admin/audit', { preHandler: requirePermission(ctx, 'audit', 'read') }, async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), beforeId: z.coerce.bigint().optional() }).parse(req.query);
    const rows = await withTenant(ctx.prisma, tenant(req), (tx) => tx.auditLog.findMany({
      where: q.beforeId ? { id: { lt: q.beforeId } } : {}, orderBy: { id: 'desc' }, take: q.limit,
      select: { id: true, userId: true, action: true, entity: true, entityId: true, at: true, ip: true, hash: true },
    }));
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  });

  app.get('/api/admin/audit/verify', { preHandler: requirePermission(ctx, 'audit', 'read') }, async (req) => {
    const [r] = await withTenant(ctx.prisma, tenant(req), (tx) => tx.$queryRaw<[{ broken: bigint | null }]>`SELECT audit_verify(${req.session!.companyId}::uuid) AS broken`);
    return { intact: r?.broken === null, firstBrokenId: r?.broken?.toString() ?? null };
  });

  // ---------- Licence ----------
  app.get('/api/admin/license', { preHandler: requirePermission(ctx, 'license', 'read') }, async () => ctx.license.status());
  app.post('/api/admin/license/activate', {
    preHandler: requirePermission(ctx, 'license', 'admin'),
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (req) => {
    const b = z.object({ licenseKey: z.string().trim().min(10).max(64).optional(), token: z.string().trim().max(4096).optional() }).parse(req.body);
    try {
      if (b.token) await ctx.license.installToken(b.token); // activation hors ligne (jeton fourni par l'éditeur)
      else if (b.licenseKey) await ctx.license.activate(b.licenseKey, appVersion);
      else throw new Error('Clé ou jeton requis');
    } catch (e) {
      await withTenant(ctx.prisma, tenant(req), (tx) => audit(tx, { ...tenant(req), action: 'license.activation_failed', entity: 'license', after: { error: (e as Error).message }, ...meta(req) }));
      throw badRequest((e as Error).message);
    }
    await withTenant(ctx.prisma, tenant(req), (tx) => audit(tx, { ...tenant(req), action: 'license.activated', entity: 'license', after: ctx.license.status(), ...meta(req) }));
    return ctx.license.status();
  });

  // ---------- Migration contrôlée des données du prototype (localStorage) ----------
  app.post('/api/admin/import-legacy', {
    preHandler: requirePermission(ctx, 'settings', 'admin'),
    bodyLimit: 10 * 1024 * 1024,
  }, async (req) => {
    const body = z.object({ data: z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(20000)), dryRun: z.boolean().default(false) }).parse(req.body);
    const report: { module: string; imported: number; skipped: number; warnings: string[] }[] = [];
    await withTenant(ctx.prisma, tenant(req), async (tx) => {
      for (const [mod, rows] of Object.entries(body.data)) {
        if (!isModule(mod)) { report.push({ module: mod, imported: 0, skipped: rows.length, warnings: ['module inconnu'] }); continue; }
        const module = mod as ModuleKey;
        const def = MODULE_DEFS[module];
        const known = new Set(def.fields.map((f) => f.name));
        const rep = { module, imported: 0, skipped: 0, warnings: [] as string[] };
        const seen = new Set<string>();
        for (const [i, raw] of rows.entries()) {
          const clean = Object.fromEntries(Object.entries(raw).filter(([k]) => known.has(k)).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]));
          const parsed = recordSchema(module).safeParse(clean);
          let data: Record<string, unknown>;
          if (parsed.success) data = parsed.data as Record<string, unknown>;
          else {
            // On conserve la donnée d'origine (pas de perte) et on signale la ligne à revoir
            data = clean;
            rep.warnings.push(`ligne ${i + 1} : ${parsed.error.issues.map((x) => x.message).join(' ; ')} (importée telle quelle, à vérifier)`);
          }
          const ref = def.referenceField ? String(data[def.referenceField] ?? '').trim() || null : null;
          if (ref) {
            const dup = seen.has(ref.toLowerCase()) || (await tx.record.findFirst({ where: { module, reference: { equals: ref, mode: 'insensitive' }, cancelledAt: null }, select: { id: true } }));
            if (dup) { rep.skipped++; rep.warnings.push(`ligne ${i + 1} : référence « ${ref} » déjà présente, ignorée`); continue; }
            seen.add(ref.toLowerCase());
          }
          if (!body.dryRun) {
            const status = def.statusField ? String(data[def.statusField] ?? '') || null : null;
            await tx.record.create({ data: { companyId: req.session!.companyId, module, reference: ref, status, data: encryptSensitive(ctx, module, data) as Prisma.InputJsonValue, computed: computeFields(module, data), createdById: req.session!.userId } });
          }
          rep.imported++;
        }
        report.push(rep);
      }
      if (!body.dryRun) await audit(tx, { ...tenant(req), action: 'import.legacy', entity: 'records', after: report.map(({ module, imported, skipped }) => ({ module, imported, skipped })), ...meta(req) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!body.dryRun) await bumpCompanyGeneration(ctx, req.session!.companyId);
    return { dryRun: body.dryRun, report };
  });
}
