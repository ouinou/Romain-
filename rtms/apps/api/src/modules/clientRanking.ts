/**
 * Classement des clients : qui commande le plus, et avec quelle régularité.
 * Source : factures, missions, dossiers de transit et BL au nom du client (non annulés).
 * Les montants ne sont renvoyés qu'aux profils qui peuvent lire les factures.
 *
 * Catégories (règles de départ, à ajuster avec RAHA TRANSPORT) :
 * - Inactif     : rien depuis plus de 120 jours ;
 * - Régulier    : de l'activité dans au moins 6 des 12 derniers mois ;
 * - Nouveau     : premier document il y a moins de 90 jours ;
 * - Occasionnel : de l'activité dans 2 à 5 des 12 derniers mois ;
 * - Ponctuel    : un seul mois d'activité sur 12 mois.
 * Tendance : nombre de documents des 6 derniers mois comparé aux 6 mois précédents.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { withTenant } from '../db.js';
import { requirePermission } from '../security/guard.js';

type Row = {
  k: string; name: string; clientId: string | null; phone: string | null; invoices: bigint; missions: bigint; dossiers: bigint;
  ca: string | null; reste: string | null; first: Date; last: Date; months12: bigint; recent6: bigint; prev6: bigint;
};

export function categoryOf(r: { first: Date; last: Date; months12: number }, today = new Date()) {
  const days = (d: Date) => Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (days(r.last) > 120) return 'Inactif';
  if (r.months12 >= 6) return 'Régulier';
  if (days(r.first) <= 90) return 'Nouveau';
  if (r.months12 >= 2) return 'Occasionnel';
  return 'Ponctuel';
}
export function trendOf(recent: number, prev: number) {
  if (recent === 0 && prev === 0) return 'stable';
  if (recent >= prev * 1.25 + 1) return 'hausse';
  if (recent <= prev * 0.75 - 1) return 'baisse';
  return 'stable';
}

export function clientRankingRoutes(app: FastifyInstance, ctx: AppContext) {
  const tenant = (req: FastifyRequest) => ({ companyId: req.session!.companyId, userId: req.session!.userId });
  app.get('/api/reports/clients', { preHandler: requirePermission(ctx, 'clients', 'read') }, async (req) => {
    const money = req.perms!.has('invoices:read');
    const rows = await withTenant(ctx.prisma, tenant(req), (tx) => tx.$queryRaw<Row[]>`
      WITH ev AS (
        SELECT lower(regexp_replace(trim(data->>'Client'), '\\s+', ' ', 'g')) AS k,
               regexp_replace(trim(data->>'Client'), '\\s+', ' ', 'g') AS name, module,
               coalesce(rtms_date(data->>'Date'), rtms_date(data->>'Date de départ'), rtms_date(data->>'Date ouverture'), (created_at AT TIME ZONE 'UTC')::date) AS d,
               CASE WHEN module = 'invoices' THEN rtms_num(computed->>'totalTTC') END AS ttc,
               CASE WHEN module = 'invoices' AND coalesce(status, '') NOT IN ('Payée') THEN rtms_num(computed->>'reste') END AS reste
          FROM records
         WHERE cancelled_at IS NULL AND module IN ('invoices', 'transport', 'transit', 'bl')
           AND coalesce(status, '') NOT IN ('Annulée', 'Annulé')
           AND length(trim(coalesce(data->>'Client', ''))) >= 2
      ), agg AS (
        SELECT k, min(name) AS name,
               count(*) FILTER (WHERE module = 'invoices') AS invoices,
               count(*) FILTER (WHERE module = 'transport') AS missions,
               count(*) FILTER (WHERE module IN ('transit', 'bl')) AS dossiers,
               sum(ttc) AS ca, sum(reste) AS reste, min(d) AS first, max(d) AS last,
               count(DISTINCT date_trunc('month', d)) FILTER (WHERE d > current_date - 365) AS months12,
               count(*) FILTER (WHERE d > current_date - 182) AS recent6,
               count(*) FILTER (WHERE d <= current_date - 182 AND d > current_date - 365) AS prev6
          FROM ev GROUP BY k
      )
      SELECT agg.*, c.id AS "clientId", c.data->>'Téléphone' AS phone
        FROM agg
        LEFT JOIN LATERAL (
          SELECT id, data FROM records
           WHERE module = 'clients' AND cancelled_at IS NULL AND data->>'Type (Client/Fournisseur)' = 'Client'
             AND lower(regexp_replace(trim(data->>'Nom / raison sociale'), '\\s+', ' ', 'g')) = agg.k
           ORDER BY created_at LIMIT 1) c ON true
       ORDER BY greatest(agg.invoices, agg.missions) + agg.dossiers DESC, agg.ca DESC NULLS LAST, agg.name
       LIMIT 500`);
    const clients = rows.map((r, i) => {
      const months12 = Number(r.months12);
      const orders = Math.max(Number(r.invoices), Number(r.missions)) + Number(r.dossiers);
      return {
        rank: i + 1, name: r.name, clientId: r.clientId, phone: r.phone,
        orders, invoices: Number(r.invoices), missions: Number(r.missions), dossiers: Number(r.dossiers),
        ...(money ? { revenue: Number(r.ca ?? 0), outstanding: Number(r.reste ?? 0) } : {}),
        first: r.first, last: r.last, monthsActive12: months12,
        category: categoryOf({ first: r.first, last: r.last, months12 }), trend: trendOf(Number(r.recent6), Number(r.prev6)),
      };
    });
    const byCategory: Record<string, number> = {};
    for (const c of clients) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    return { clients, byCategory, withAmounts: money, generatedAt: new Date().toISOString() };
  });
}
