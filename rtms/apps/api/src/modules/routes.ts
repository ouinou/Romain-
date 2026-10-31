import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { audit } from '../audit/audit.js';
import type { AppContext } from '../context.js';
import { FieldCipher } from '../crypto.js';
import { withTenant, type Tx } from '../db.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors.js';
import { requirePermission } from '../security/guard.js';
import { permKey, type ModuleKey } from '../security/permissions.js';
import { computeFields, csvCell, isModule, MODULE_DEFS, recordSchema } from './definitions.js';

/** Statuts qui « figent » un enregistrement : toute modification exige le droit `validate`. */
const LOCKED_STATUSES = new Set(['Validé', 'Validée', 'Clôturé', 'Payée']);

export async function bumpCompanyGeneration(ctx: AppContext, companyId: string) {
  await ctx.redis.incr(`gen:${companyId}`);
}

function moduleParam(req: FastifyRequest): ModuleKey {
  const m = (req.params as { module?: string }).module ?? '';
  if (!isModule(m)) throw notFound('Module inconnu');
  return m;
}

function zodMessage(e: z.ZodError) {
  return e.issues.map((i) => (i.path.length && !i.message.includes(String(i.path[0])) ? `${String(i.path[0])} : ${i.message}` : i.message));
}

export function encryptSensitive(ctx: AppContext, module: ModuleKey, data: Record<string, unknown>) {
  const out = { ...data };
  for (const f of MODULE_DEFS[module].fields) {
    const v = out[f.name];
    if (f.sensitive && typeof v === 'string' && v !== '' && !FieldCipher.isEncrypted(v)) out[f.name] = ctx.cipher.encrypt(v, `${module}:${f.name}`);
  }
  return out;
}
function decryptSensitive(ctx: AppContext, module: ModuleKey, data: Record<string, unknown>) {
  const out = { ...data };
  for (const f of MODULE_DEFS[module].fields) {
    const v = out[f.name];
    if (f.sensitive && FieldCipher.isEncrypted(v)) {
      try { out[f.name] = ctx.cipher.decrypt(v, `${module}:${f.name}`); } catch { out[f.name] = '[illisible]'; }
    }
  }
  return out;
}

function referenceOf(module: ModuleKey, data: Record<string, unknown>) {
  const f = MODULE_DEFS[module].referenceField;
  const v = f ? data[f] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function statusOf(module: ModuleKey, data: Record<string, unknown>) {
  const f = MODULE_DEFS[module].statusField;
  const v = f ? data[f] : undefined;
  return typeof v === 'string' ? v : null;
}

type Row = { id: string; version: number; reference: string | null; status: string | null; data: Prisma.JsonValue; computed: Prisma.JsonValue; createdAt: Date; updatedAt: Date };

function present(ctx: AppContext, module: ModuleKey, r: Row) {
  return {
    id: r.id, version: r.version, reference: r.reference, status: r.status,
    data: decryptSensitive(ctx, module, r.data as Record<string, unknown>),
    computed: r.computed, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface ListOptions {
  q: string; limit: number; offset: number;
  sort?: string; dir?: 'asc' | 'desc';
  /** Filtres multicritères : valeur exacte (listes), « contient » (texte), {from,to} (dates, nombres). */
  filters?: Record<string, string | { from?: string | number; to?: string | number }>;
}

/** Colonnes triables hors champs métier. */
const META_SORT: Record<string, Prisma.Sql> = {
  createdAt: Prisma.sql`created_at`, updatedAt: Prisma.sql`updated_at`, reference: Prisma.sql`lower(reference)`,
  status: Prisma.sql`status`, totalTTC: Prisma.sql`rtms_num(computed->>'totalTTC')`,
};

function fieldExpr(module: ModuleKey, name: string): { expr: Prisma.Sql; type: string } {
  const f = MODULE_DEFS[module].fields.find((x) => x.name === name);
  if (!f || f.sensitive || f.type === 'lines') throw badRequest(`Champ « ${name} » non triable ou non filtrable`);
  const raw = Prisma.sql`(data->>${name})`;
  if (f.type === 'number') return { expr: Prisma.sql`rtms_num(${raw})`, type: f.type };
  if (f.type === 'date') return { expr: Prisma.sql`rtms_date(${raw})`, type: f.type };
  return { expr: raw, type: f.type };
}

function buildWhere(companyId: string, module: ModuleKey, o: Pick<ListOptions, 'q' | 'filters'>) {
  const pattern = `%${escapeLike(o.q.toLowerCase())}%`;
  const parts: Prisma.Sql[] = [
    Prisma.sql`company_id = ${companyId}::uuid AND module = ${module} AND cancelled_at IS NULL`,
    Prisma.sql`(${o.q} = '' OR search_text LIKE ${pattern})`,
  ];
  for (const [name, value] of Object.entries(o.filters ?? {})) {
    const { expr, type } = fieldExpr(module, name);
    if (typeof value === 'object' && value !== null) {
      const cast = (v: string | number) => (type === 'number' ? Prisma.sql`${Number(v)}::numeric` : Prisma.sql`rtms_date(${String(v)})`);
      if (value.from !== undefined && value.from !== '') parts.push(Prisma.sql`${expr} >= ${cast(value.from)}`);
      if (value.to !== undefined && value.to !== '') parts.push(Prisma.sql`${expr} <= ${cast(value.to)}`);
    } else if (value !== '') {
      parts.push(type === 'enum'
        ? Prisma.sql`${expr} = ${value}`
        : Prisma.sql`lower(data->>${name}) LIKE ${`%${escapeLike(String(value).toLowerCase())}%`}`);
    }
  }
  return Prisma.join(parts, ' AND ');
}

async function listRows(tx: Tx, companyId: string, module: ModuleKey, o: ListOptions) {
  const where = buildWhere(companyId, module, o);
  const dir = o.dir === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC');
  const sortExpr = !o.sort ? META_SORT.createdAt! : (META_SORT[o.sort] ?? fieldExpr(module, o.sort).expr);
  const rows = await tx.$queryRaw<Row[]>`
    SELECT id, version, reference, status, data, computed, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM records WHERE ${where}
     ORDER BY ${sortExpr} ${dir} NULLS LAST, id DESC LIMIT ${o.limit} OFFSET ${o.offset}`;
  const [{ count }] = await tx.$queryRaw<[{ count: bigint }]>`SELECT count(*) FROM records WHERE ${where}`;
  return { rows, total: Number(count) };
}

function mapUniqueViolation(e: unknown, module: ModuleKey): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw conflict(`${MODULE_DEFS[module].referenceField ?? 'Référence'} déjà utilisée`);
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError && /records_reference_uq/.test(e.message)) {
    throw conflict(`${MODULE_DEFS[module].referenceField ?? 'Référence'} déjà utilisée`);
  }
  throw e;
}

function parseFilters(f?: string): ListOptions['filters'] {
  if (!f) return undefined;
  const range = z.object({ from: z.union([z.string().max(40), z.number()]).optional(), to: z.union([z.string().max(40), z.number()]).optional() }).strict();
  const parsed = z.record(z.string().max(80), z.union([z.string().max(200), range])).refine((o) => Object.keys(o).length <= 15).safeParse((() => { try { return JSON.parse(f); } catch { return null; } })());
  if (!parsed.success) throw badRequest('Filtres invalides');
  return parsed.data;
}

export function recordRoutes(app: FastifyInstance, ctx: AppContext) {
  const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
  const tenant = (req: FastifyRequest) => ({ companyId: req.session!.companyId, userId: req.session!.userId });

  app.get('/api/modules', { preHandler: requirePermission(ctx, 'dashboard', 'read') }, async () =>
    Object.values(MODULE_DEFS).map((m) => ({ key: m.key, referenceField: m.referenceField, statusField: m.statusField, fields: m.fields.map(({ sensitive, ...f }) => ({ ...f, filterable: !sensitive && f.type !== 'lines' })) })));

  // ---------- Liste paginée + recherche serveur ----------
  app.get('/api/records/:module', { preHandler: requirePermission(ctx, moduleParam, 'read') }, async (req) => {
    const module = moduleParam(req);
    const p = z.object({
      q: z.string().max(100).default(''),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      sort: z.string().max(80).optional(),
      dir: z.enum(['asc', 'desc']).default('desc'),
      f: z.string().max(4000).optional(),
    }).parse(req.query);
    const filters = parseFilters(p.f);
    const { rows, total } = await withTenant(ctx.prisma, tenant(req), (tx) => listRows(tx, req.session!.companyId, module, { q: p.q.trim(), limit: p.limit, offset: p.offset, sort: p.sort, dir: p.dir, filters }));
    return { items: rows.map((r) => present(ctx, module, r)), total, limit: p.limit, offset: p.offset };
  });

  // ---------- Compteurs par statut (tuiles d'en-tête des listes) ----------
  app.get('/api/records/:module/stats', { preHandler: requirePermission(ctx, moduleParam, 'read') }, async (req) => {
    const module = moduleParam(req);
    const p = z.object({ q: z.string().max(100).default(''), f: z.string().max(4000).optional() }).parse(req.query);
    const where = buildWhere(req.session!.companyId, module, { q: p.q.trim(), filters: parseFilters(p.f) });
    const rows = await withTenant(ctx.prisma, tenant(req), (tx) => tx.$queryRaw<{ status: string | null; n: bigint }[]>`
      SELECT status, count(*) AS n FROM records WHERE ${where} GROUP BY status`);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) { total += Number(r.n); byStatus[r.status ?? ''] = Number(r.n); }
    return { total, byStatus };
  });

  app.get('/api/records/:module/:id', { preHandler: requirePermission(ctx, moduleParam, 'read') }, async (req) => {
    const module = moduleParam(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await withTenant(ctx.prisma, tenant(req), (tx) => tx.record.findFirst({ where: { id, module, cancelledAt: null } }));
    if (!r) throw notFound();
    return present(ctx, module, r);
  });

  // ---------- Création ----------
  app.post('/api/records/:module', { preHandler: requirePermission(ctx, moduleParam, 'create') }, async (req, reply) => {
    const module = moduleParam(req);
    const parsed = recordSchema(module).safeParse((req.body as { data?: unknown })?.data);
    if (!parsed.success) throw badRequest('Formulaire incomplet ou invalide', zodMessage(parsed.error));
    const data = parsed.data as Record<string, unknown>;
    const status = statusOf(module, data);
    if (status && LOCKED_STATUSES.has(status) && !req.perms!.has(permKey(module, 'validate'))) throw forbidden(`Le statut « ${status} » nécessite le droit de validation`);
    const stored = encryptSensitive(ctx, module, data);
    try {
      const rec = await withTenant(ctx.prisma, tenant(req), async (tx) => {
        const r = await tx.record.create({
          data: {
            companyId: req.session!.companyId, module, reference: referenceOf(module, data), status,
            data: stored as Prisma.InputJsonValue, computed: computeFields(module, data), createdById: req.session!.userId,
          },
        });
        await audit(tx, { ...tenant(req), action: 'record.create', entity: module, entityId: r.id, after: stored, ...meta(req) });
        return r;
      });
      await bumpCompanyGeneration(ctx, req.session!.companyId);
      reply.status(201);
      return present(ctx, module, rec);
    } catch (e) { mapUniqueViolation(e, module); }
  });

  // ---------- Modification avec verrou optimiste (multi-utilisateur) ----------
  app.patch('/api/records/:module/:id', { preHandler: requirePermission(ctx, moduleParam, 'update') }, async (req) => {
    const module = moduleParam(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ version: z.number().int().positive(), data: z.record(z.string(), z.unknown()) }).safeParse(req.body);
    if (!body.success) throw badRequest('Version et données requises');
    const patch = recordSchema(module, true).safeParse(body.data.data);
    if (!patch.success) throw badRequest('Données invalides', zodMessage(patch.error));

    try {
      const rec = await withTenant(ctx.prisma, tenant(req), async (tx) => {
        const cur = await tx.record.findFirst({ where: { id, module, cancelledAt: null } });
        if (!cur) throw notFound();
        const curData = decryptSensitive(ctx, module, cur.data as Record<string, unknown>);
        const merged = { ...curData, ...(patch.data as Record<string, unknown>) };
        const full = recordSchema(module).safeParse(merged);
        if (!full.success) throw badRequest('Données invalides', zodMessage(full.error));
        const nextStatus = statusOf(module, full.data as Record<string, unknown>);
        const canValidate = req.perms!.has(permKey(module, 'validate'));
        if ((cur.status && LOCKED_STATUSES.has(cur.status)) || (nextStatus && LOCKED_STATUSES.has(nextStatus) && nextStatus !== cur.status)) {
          if (!canValidate) throw forbidden('Enregistrement validé : modification réservée aux profils habilités');
        }
        const stored = encryptSensitive(ctx, module, full.data as Record<string, unknown>);
        const res = await tx.record.updateMany({
          where: { id, version: body.data.version, cancelledAt: null },
          data: {
            data: stored as Prisma.InputJsonValue, reference: referenceOf(module, full.data as Record<string, unknown>), status: nextStatus,
            computed: computeFields(module, full.data as Record<string, unknown>), version: { increment: 1 }, updatedById: req.session!.userId,
          },
        });
        if (res.count === 0) throw conflict('Cet enregistrement a été modifié par un autre utilisateur. Rechargez avant de modifier.', { currentVersion: cur.version });
        await audit(tx, { ...tenant(req), action: 'record.update', entity: module, entityId: id, before: cur.data, after: stored, ...meta(req) });
        return tx.record.findUniqueOrThrow({ where: { id } });
      });
      await bumpCompanyGeneration(ctx, req.session!.companyId);
      return present(ctx, module, rec);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      mapUniqueViolation(e, module);
    }
  });

  // ---------- « Supprimer » = annulation tracée (aucune suppression physique) ----------
  app.post('/api/records/:module/:id/cancel', { preHandler: requirePermission(ctx, moduleParam, 'cancel') }, async (req) => {
    const module = moduleParam(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(1).max(300).default('Retiré de la liste') }).parse(req.body ?? {});
    await withTenant(ctx.prisma, tenant(req), async (tx) => {
      const cur = await tx.record.findFirst({ where: { id, module, cancelledAt: null } });
      if (!cur) throw notFound();
      await tx.record.update({ where: { id }, data: { cancelledAt: new Date(), cancelledById: req.session!.userId, cancelReason: reason, version: { increment: 1 } } });
      await audit(tx, { ...tenant(req), action: 'record.cancel', entity: module, entityId: id, before: cur.data, after: { reason }, ...meta(req) });
    });
    await bumpCompanyGeneration(ctx, req.session!.companyId);
    return { ok: true };
  });

  // ---------- Export CSV (serveur : droits + traçabilité + anti-injection de formules) ----------
  app.get('/api/records/:module/export.csv', { preHandler: requirePermission(ctx, moduleParam, 'export') }, async (req, reply) => {
    const module = moduleParam(req);
    const fields = MODULE_DEFS[module].fields.map((f) => f.name);
    const lines = await withTenant(ctx.prisma, tenant(req), async (tx) => {
      const rows = await tx.record.findMany({ where: { module, cancelledAt: null }, orderBy: { createdAt: 'desc' }, take: 50_000 });
      await audit(tx, { ...tenant(req), action: 'record.export', entity: module, after: { count: rows.length }, ...meta(req) });
      return rows.map((r) => {
        const d = decryptSensitive(ctx, module, r.data as Record<string, unknown>);
        return fields.map((f) => csvCell(d[f])).join(';');
      });
    });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="raha_${module}.csv"`);
    return '﻿' + [fields.map(csvCell).join(';'), ...lines].join('\r\n');
  });
}
