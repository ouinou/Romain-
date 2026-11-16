/**
 * Trajets GPS du parc automobile.
 * - Import d'une trace (fichier GPX, KML ou CSV lu par le poste, ou enregistrement du téléphone) :
 *   les points sont revalidés et les chiffres recalculés ici.
 * - Droits : ceux du module « Parc automobile » (lecture, mise à jour pour importer,
 *   annulation pour retirer un trajet, export pour le fichier GPX).
 * - Isolation par société : RLS PostgreSQL (withTenant), comme pour les enregistrements.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { audit } from '../audit/audit.js';
import type { AppContext } from '../context.js';
import { withTenant, type Tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { requirePermission } from '../security/guard.js';
import { analyse, LIMITS, toGpx, type RawPoint } from './track.js';

const uuid = z.string().uuid('Identifiant invalide');
const MIN_T = Date.UTC(2000, 0, 1) / 1000;

const importSchema = z.object({
  vehicleId: uuid,
  missionId: uuid.nullish(),
  driver: z.string().trim().max(120).nullish(),
  label: z.string().trim().max(200).nullish(),
  source: z.enum(['gpx', 'kml', 'csv', 'telephone']),
  fileName: z.string().trim().max(200).nullish(),
  points: z.array(z.tuple([
    z.number().finite(),
    z.number().finite().min(-90, 'Latitude hors limites').max(90, 'Latitude hors limites'),
    z.number().finite().min(-180, 'Longitude hors limites').max(180, 'Longitude hors limites'),
  ])).min(2, 'La trace doit contenir au moins deux positions').max(LIMITS.maxPoints, `Trace trop volumineuse : ${LIMITS.maxPoints} positions au maximum`),
}).strict();

const editSchema = z.object({
  missionId: uuid.nullable().optional(),
  driver: z.string().trim().max(120).nullable().optional(),
  label: z.string().trim().max(200).nullable().optional(),
}).strict();

type TrackRow = {
  id: string; vehicleId: string; vehicle: string | null; vehicleModel: string | null; missionId: string | null; mission: string | null;
  driver: string | null; label: string | null; source: string; fileName: string | null; startedAt: Date; endedAt: Date;
  pointCount: number; distanceM: number; movingS: number; maxSpeedKmh: string; stops: unknown; bbox: unknown; createdAt: Date; createdBy: string | null;
};

// Requêtes entièrement paramétrées (Prisma.sql) : aucune valeur n'est collée dans le texte SQL.
const COLUMNS = Prisma.sql`
  t.id, t.vehicle_id AS "vehicleId", v.reference AS vehicle, v.data->>'Marque / modèle' AS "vehicleModel",
         t.mission_id AS "missionId", m.reference AS mission, t.driver, t.label, t.source, t.file_name AS "fileName",
         t.started_at AS "startedAt", t.ended_at AS "endedAt", t.point_count AS "pointCount", t.distance_m AS "distanceM",
         t.moving_s AS "movingS", t.max_speed_kmh::text AS "maxSpeedKmh", t.stops, t.bbox, t.created_at AS "createdAt",
         u.full_name AS "createdBy"`;
const FROM = Prisma.sql`    FROM gps_tracks t
    JOIN records v ON v.id = t.vehicle_id
    LEFT JOIN records m ON m.id = t.mission_id
    LEFT JOIN users u ON u.id = t.created_by`;

const present = (r: TrackRow) => ({ ...r, maxSpeedKmh: Number(r.maxSpeedKmh), durationS: Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000) });

async function checkLinked(tx: Tx, vehicleId: string, missionId?: string | null) {
  const v = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM records WHERE id = ${vehicleId}::uuid AND module = 'fleet' AND cancelled_at IS NULL`;
  if (!v.length) throw badRequest('Véhicule introuvable dans le parc automobile');
  if (missionId) {
    const m = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM records WHERE id = ${missionId}::uuid AND module = 'transport' AND cancelled_at IS NULL`;
    if (!m.length) throw badRequest('Mission de transport introuvable');
  }
}

export function gpsRoutes(app: FastifyInstance, ctx: AppContext) {
  const tenant = (req: FastifyRequest) => ({ companyId: req.session!.companyId, userId: req.session!.userId });
  const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
  const idParam = (req: FastifyRequest) => uuid.parse((req.params as { id: string }).id);

  // ---------- Liste (sans les points) + totaux ----------
  app.get('/api/gps/tracks', { preHandler: requirePermission(ctx, 'fleet', 'read') }, async (req) => {
    const p = z.object({
      vehicle: uuid.optional(), mission: uuid.optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    }).safeParse(req.query);
    if (!p.success) throw badRequest('Paramètres invalides');
    const q = p.data;
    const cond: Prisma.Sql[] = [Prisma.sql`t.cancelled_at IS NULL`];
    if (q.vehicle) cond.push(Prisma.sql`t.vehicle_id = ${q.vehicle}::uuid`);
    if (q.mission) cond.push(Prisma.sql`t.mission_id = ${q.mission}::uuid`);
    // Journées au fuseau du Cameroun (UTC+1)
    if (q.from) cond.push(Prisma.sql`t.started_at >= ((${q.from}::date)::timestamp - interval '1 hour') AT TIME ZONE 'UTC'`);
    if (q.to) cond.push(Prisma.sql`t.started_at < (((${q.to}::date) + 1)::timestamp - interval '1 hour') AT TIME ZONE 'UTC'`);
    const where = Prisma.join(cond, ' AND ');
    return withTenant(ctx.prisma, tenant(req), async (tx) => {
      const rows = await tx.$queryRaw<TrackRow[]>`SELECT ${COLUMNS} ${FROM} WHERE ${where} ORDER BY t.started_at DESC, t.id DESC LIMIT ${q.limit} OFFSET ${q.offset}`;
      const [tot] = await tx.$queryRaw<[{ n: bigint; distance: bigint | null; moving: bigint | null }]>`
        SELECT count(*) AS n, sum(t.distance_m) AS distance, sum(t.moving_s) AS moving FROM gps_tracks t WHERE ${where}`;
      return { rows: rows.map(present), total: Number(tot.n), totals: { distanceM: Number(tot.distance ?? 0), movingS: Number(tot.moving ?? 0) } };
    });
  });

  // ---------- Détail avec les points ----------
  app.get('/api/gps/tracks/:id', { preHandler: requirePermission(ctx, 'fleet', 'read') }, async (req) => {
    const id = idParam(req);
    return withTenant(ctx.prisma, tenant(req), async (tx) => {
      const rows = await tx.$queryRaw<(TrackRow & { points: unknown })[]>`SELECT ${COLUMNS}, t.points ${FROM} WHERE t.id = ${id}::uuid AND t.cancelled_at IS NULL`;
      if (!rows.length) throw notFound('Trajet introuvable');
      return present(rows[0]!);
    });
  });

  // ---------- Import ----------
  app.post('/api/gps/tracks', { bodyLimit: 4 * 1024 * 1024, preHandler: requirePermission(ctx, 'fleet', 'update') }, async (req, reply) => {
    const p = importSchema.safeParse(req.body);
    if (!p.success) throw badRequest('Trace GPS refusée', p.error.issues.slice(0, 5).map((i) => i.message));
    const b = p.data;
    const now = Date.now() / 1000;
    if (b.points.some(([t]) => t < MIN_T || t > now + 86_400)) throw badRequest('Trace GPS refusée', ['Horodatage hors limites (avant 2000 ou dans le futur) : vérifiez la date et l’heure de l’appareil']);
    let s;
    try { s = analyse(b.points as RawPoint[]); } catch (e) { throw badRequest('Trace GPS refusée', [(e as Error).message]); }
    const rel = s.points.map(([t, a, o]) => [t - s.startedAt, a, o]);
    const out = await withTenant(ctx.prisma, tenant(req), async (tx) => {
      await checkLinked(tx, b.vehicleId, b.missionId);
      const [row] = await tx.$queryRaw<[{ id: string }]>`
        INSERT INTO gps_tracks (company_id, vehicle_id, mission_id, driver, label, source, file_name, started_at, ended_at,
                                point_count, distance_m, moving_s, max_speed_kmh, stops, bbox, points, created_by)
        VALUES (${req.session!.companyId}::uuid, ${b.vehicleId}::uuid, ${b.missionId ?? null}::uuid, ${b.driver || null}, ${b.label || null},
                ${b.source}, ${b.fileName || null}, to_timestamp(${s.startedAt}), to_timestamp(${s.endedAt}), ${s.points.length},
                ${s.distanceM}, ${s.movingS}, ${s.maxSpeedKmh}, ${JSON.stringify(s.stops)}::jsonb, ${JSON.stringify(s.bbox)}::jsonb,
                ${JSON.stringify(rel)}::jsonb, ${req.session!.userId}::uuid)
        RETURNING id`;
      await audit(tx, { ...tenant(req), action: 'gps.import', entity: 'gps_track', entityId: row.id, after: { vehicleId: b.vehicleId, missionId: b.missionId ?? null, source: b.source, points: s.points.length, distanceM: s.distanceM }, ...meta(req) });
      return row;
    });
    return reply.status(201).send({ id: out.id, pointCount: s.points.length, dropped: s.dropped, distanceM: s.distanceM, movingS: s.movingS, maxSpeedKmh: s.maxSpeedKmh, stops: s.stops.length });
  });

  // ---------- Libellé, chauffeur, mission ----------
  app.patch('/api/gps/tracks/:id', { preHandler: requirePermission(ctx, 'fleet', 'update') }, async (req) => {
    const id = idParam(req);
    const p = editSchema.safeParse(req.body);
    if (!p.success) throw badRequest('Modification refusée', p.error.issues.map((i) => i.message));
    const b = p.data;
    return withTenant(ctx.prisma, tenant(req), async (tx) => {
      const [cur] = await tx.$queryRaw<{ vehicleId: string; missionId: string | null; driver: string | null; label: string | null }[]>`
        SELECT vehicle_id AS "vehicleId", mission_id AS "missionId", driver, label FROM gps_tracks WHERE id = ${id}::uuid AND cancelled_at IS NULL FOR UPDATE`;
      if (!cur) throw notFound('Trajet introuvable');
      const next = { missionId: b.missionId === undefined ? cur.missionId : b.missionId, driver: b.driver === undefined ? cur.driver : (b.driver || null), label: b.label === undefined ? cur.label : (b.label || null) };
      await checkLinked(tx, cur.vehicleId, next.missionId);
      await tx.$executeRaw`UPDATE gps_tracks SET mission_id = ${next.missionId}::uuid, driver = ${next.driver}, label = ${next.label} WHERE id = ${id}::uuid`;
      await audit(tx, { ...tenant(req), action: 'gps.update', entity: 'gps_track', entityId: id, before: { missionId: cur.missionId, driver: cur.driver, label: cur.label }, after: next, ...meta(req) });
      return { ok: true };
    });
  });

  // ---------- Annulation (tracée, pas de suppression) ----------
  app.post('/api/gps/tracks/:id/cancel', { preHandler: requirePermission(ctx, 'fleet', 'cancel') }, async (req) => {
    const id = idParam(req);
    const p = z.object({ reason: z.string().trim().min(3, 'Motif obligatoire (3 caractères au moins)').max(300) }).strict().safeParse(req.body);
    if (!p.success) throw badRequest('Annulation refusée', p.error.issues.map((i) => i.message));
    return withTenant(ctx.prisma, tenant(req), async (tx) => {
      const n = await tx.$executeRaw`UPDATE gps_tracks SET cancelled_at = now(), cancelled_by = ${req.session!.userId}::uuid, cancel_reason = ${p.data.reason}
                                      WHERE id = ${id}::uuid AND cancelled_at IS NULL`;
      if (!n) throw notFound('Trajet introuvable');
      await audit(tx, { ...tenant(req), action: 'gps.cancel', entity: 'gps_track', entityId: id, after: { reason: p.data.reason }, ...meta(req) });
      return { ok: true };
    });
  });

  // ---------- Export GPX ----------
  app.get('/api/gps/tracks/:id/gpx', { preHandler: requirePermission(ctx, 'fleet', 'export') }, async (req, reply) => {
    const id = idParam(req);
    const r = await withTenant(ctx.prisma, tenant(req), async (tx) => {
      const rows = await tx.$queryRaw<{ startedAt: Date; points: [number, number, number][]; vehicle: string | null }[]>`
        SELECT t.started_at AS "startedAt", t.points, v.reference AS vehicle FROM gps_tracks t JOIN records v ON v.id = t.vehicle_id
         WHERE t.id = ${id}::uuid AND t.cancelled_at IS NULL`;
      if (!rows.length) throw notFound('Trajet introuvable');
      await audit(tx, { ...tenant(req), action: 'gps.export', entity: 'gps_track', entityId: id, ...meta(req) });
      return rows[0]!;
    });
    const day = new Date(r.startedAt.getTime() + 3_600_000).toISOString().slice(0, 10);
    const name = `Trajet ${r.vehicle ?? 'vehicule'} ${day}`.replace(/[^\p{L}\p{N} _-]/gu, '-');
    return reply.header('content-type', 'application/gpx+xml; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}.gpx"; filename*=UTF-8''${encodeURIComponent(name)}.gpx`)
      .send(toGpx(name, r.startedAt, r.points));
  });
}
