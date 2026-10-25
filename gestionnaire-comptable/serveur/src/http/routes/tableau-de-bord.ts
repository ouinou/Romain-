import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { versEntier } from "../../domaine/comptabilite/montants.js";
import { proteger, type Dependances } from "../contexte.js";
import { ErreurHttp } from "../erreurs.js";
import { visibles } from "./tresorerie.js";

/**
 * Évolution mensuelle pour le graphique du tableau de bord : ventes TTC facturées et encaissements.
 * Chaque série n'est calculée que si l'utilisateur a le droit de la voir (null sinon) :
 *  - ventes : sales.read (factures émises par mois de la date de facture, moins les avoirs du mois de l'avoir) ;
 *  - encaissements : treasury.read (tous les comptes) ou cash.read (ses caisses seulement). Ce sont les
 *    encaissements clients et autres recettes, nets de leurs annulations et des remboursements d'avoirs ; les transferts internes sont exclus.
 */
export function routesTableauDeBord(app: FastifyInstance, deps: Dependances) {
  app.get("/api/tableau-de-bord/evolution", proteger(deps, { permission: null }, async (req, ctx) => {
    const { mois } = z.object({ mois: z.coerce.number().int().min(2).max(24).default(6) }).parse(req.query);
    const voitVentes = ctx.a("sales.read"), voitTreso = ctx.a("treasury.read") || ctx.a("cash.read");
    if (!voitVentes && !voitTreso)
      throw new ErreurHttp(403, "acces_refuse", "Vous n'avez accès ni aux ventes ni à la trésorerie.",
        { type: "security", action: "access_denied", resultat: "denied", details: { permission: "sales.read|treasury.read|cash.read" } });
    const { rows: periodes } = await ctx.c.query(
      `SELECT to_char(m, 'YYYY-MM') AS mois FROM generate_series(date_trunc('month', current_date) - make_interval(months => $1 - 1), date_trunc('month', current_date), interval '1 month') m`, [mois]);
    const debut = `${periodes[0].mois}-01`;
    const indexer = (rows: { mois: string; total: string | number | null }[]) => {
      const t = new Map(rows.map((r) => [r.mois, versEntier(r.total)]));
      return periodes.map((p) => t.get(p.mois) ?? 0);
    };
    let ventes: number[] | null = null, encaissements: number[] | null = null;
    if (voitVentes) {
      const { rows } = await ctx.c.query(
        `SELECT mois, sum(t) AS total FROM (
           SELECT to_char(invoice_date, 'YYYY-MM') AS mois, total_ttc AS t FROM invoices WHERE invoice_date >= $1::date
           UNION ALL SELECT to_char(credit_date, 'YYYY-MM'), -total_ttc FROM credit_notes WHERE credit_date >= $1::date) x GROUP BY 1`, [debut]);
      ventes = indexer(rows as { mois: string; total: string }[]);
    }
    if (voitTreso) {
      const { rows } = await ctx.c.query(
        `SELECT to_char(m.movement_date, 'YYYY-MM') AS mois,
                sum(CASE WHEN m.direction = 'in' AND m.kind IN ('receipt', 'invoice_payment') THEN m.amount
                         WHEN m.direction = 'out' AND m.kind = 'reversal' AND o.kind IN ('receipt', 'invoice_payment') THEN -m.amount
                         WHEN m.kind = 'credit_refund' THEN -m.amount
                         WHEN m.direction = 'in' AND m.kind = 'reversal' AND o.kind = 'credit_refund' THEN m.amount
                         ELSE 0 END) AS total
           FROM treasury_movements m
           JOIN treasury_accounts t ON t.id = m.treasury_account_id
           LEFT JOIN treasury_movements o ON o.id = m.reversal_of
          WHERE m.movement_date >= $2::date AND ${visibles(ctx)} ${ctx.a("treasury.read") ? "AND $1::uuid IS NOT NULL" : ""}
          GROUP BY 1`, [ctx.utilisateur.id, debut]);
      encaissements = indexer(rows as { mois: string; total: string }[]);
    }
    return { mois: periodes.map((p) => p.mois as string), ventes, encaissements };
  }));
}
