import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { withTenant } from '../db.js';
import { requirePermission } from '../security/guard.js';

interface Stats { counts: Record<string, number>; finance: { recettes: number; depenses: number; solde: number }; generatedAt: string }

/**
 * Indicateurs agrégés en une seule requête SQL, mis en cache dans Redis.
 * Le cache est invalidé par génération : toute écriture incrémente gen:<société>.
 */
export async function companyStats(ctx: AppContext, companyId: string): Promise<Stats> {
  const gen = (await ctx.redis.get(`gen:${companyId}`)) ?? '0';
  const key = `stats:${companyId}:${gen}`;
  const hit = await ctx.redis.get(key);
  if (hit) return JSON.parse(hit) as Stats;

  const rows = await withTenant(ctx.prisma, { companyId }, (tx) => tx.$queryRaw<{ module: string; n: bigint; rec: string | null; dep: string | null }[]>`
    SELECT module, count(*) AS n,
           sum((data->>'Montant (FCFA)')::numeric) FILTER (WHERE module = 'finance' AND data->>'Type (Recette/Dépense)' = 'Recette') AS rec,
           sum((data->>'Montant (FCFA)')::numeric) FILTER (WHERE module = 'finance' AND data->>'Type (Recette/Dépense)' = 'Dépense') AS dep
      FROM records WHERE company_id = ${companyId}::uuid AND cancelled_at IS NULL
     GROUP BY module`);
  const counts: Record<string, number> = {};
  let recettes = 0, depenses = 0;
  for (const r of rows) {
    counts[r.module] = Number(r.n);
    recettes += Number(r.rec ?? 0);
    depenses += Number(r.dep ?? 0);
  }
  const stats: Stats = { counts, finance: { recettes, depenses, solde: recettes - depenses }, generatedAt: new Date().toISOString() };
  await ctx.redis.set(key, JSON.stringify(stats), 'EX', 300);
  return stats;
}

export function dashboardRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/dashboard', { preHandler: requirePermission(ctx, 'dashboard', 'read') }, async (req) => {
    const s = await companyStats(ctx, req.session!.companyId);
    // Les montants ne sont visibles qu'avec un accès finance ou rapports
    const canMoney = req.perms!.has('finance:read') || req.perms!.has('reports:read');
    return { counts: s.counts, finance: canMoney ? s.finance : null, generatedAt: s.generatedAt };
  });
  app.get('/api/reports/summary', { preHandler: requirePermission(ctx, 'reports', 'read') }, async (req) => companyStats(ctx, req.session!.companyId));
}
