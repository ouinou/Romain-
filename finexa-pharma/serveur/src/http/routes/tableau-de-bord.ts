import type { FastifyInstance } from "fastify";
import { proteger, type Dependances } from "../contexte.js";
import { lireParametres } from "../../domaine/pharmacie/parametres.js";
import { NATURES_MOUVEMENT } from "./stock.js";

/**
 * Tableau de bord de l'officine : des chiffres qui appellent une action (ruptures, péremptions, lots bloqués),
 * la valeur du stock et les derniers mouvements. Les ventes et achats du jour s'ajouteront avec leurs modules.
 */
export function routesTableauDeBord(app: FastifyInstance, deps: Dependances) {
  app.get("/api/tableau-de-bord", proteger(deps, { permission: null }, async (_req, ctx) => {
    const lecture = ctx.a("stock.read") || ctx.a("catalog.read");
    if (!lecture) return { autorise: false };
    const { delaiAlertePeremption: delai } = await lireParametres(ctx.c, ctx.entrepriseId);
    const { rows: [k] } = await ctx.c.query(
      `WITH vendable AS (
         SELECT p.id, p.alert_threshold,
                coalesce((SELECT sum(s.quantity) FROM lot_stock s JOIN lots l ON l.id = s.lot_id
                           WHERE l.product_id = p.id AND l.status = 'available' AND l.expiry_date >= current_date), 0) AS q
           FROM products p WHERE p.status = 'active')
       SELECT (SELECT count(*)::int FROM vendable) AS produits,
              (SELECT count(*)::int FROM vendable WHERE q = 0) AS ruptures,
              (SELECT count(*)::int FROM vendable WHERE q > 0 AND q <= alert_threshold) AS sous_seuil,
              (SELECT count(*)::int FROM lots l JOIN lot_stock s ON s.lot_id = l.id WHERE s.quantity > 0 AND l.expiry_date >= current_date AND l.expiry_date <= current_date + $1::int) AS proches,
              (SELECT count(*)::int FROM lots l JOIN lot_stock s ON s.lot_id = l.id WHERE s.quantity > 0 AND l.expiry_date < current_date) AS perimes,
              (SELECT count(*)::int FROM lots l JOIN lot_stock s ON s.lot_id = l.id WHERE s.quantity > 0 AND l.status <> 'available') AS bloques,
              (SELECT coalesce(sum(s.quantity * l.purchase_price), 0)::bigint FROM lots l JOIN lot_stock s ON s.lot_id = l.id WHERE s.quantity > 0) AS valeur,
              (SELECT coalesce(sum(quantity) FILTER (WHERE quantity > 0), 0)::int FROM stock_movements WHERE created_at >= current_date) AS entrees_jour,
              (SELECT coalesce(-sum(quantity) FILTER (WHERE quantity < 0), 0)::int FROM stock_movements WHERE created_at >= current_date) AS sorties_jour`, [delai]);
    const voitStock = ctx.a("stock.read");
    const { rows: derniers } = voitStock ? await ctx.c.query(
      `SELECT m.id, m.number, m.created_at, m.kind, m.quantity, l.lot_number, p.name, u.full_name FROM stock_movements m JOIN lots l ON l.id = m.lot_id
         JOIN products p ON p.id = m.product_id JOIN app_users u ON u.id = m.created_by ORDER BY m.created_at DESC, m.sequence_no DESC LIMIT 8`) : { rows: [] };
    return {
      autorise: true, delaiAlertePeremption: delai,
      indicateurs: { produits: k.produits, ruptures: k.ruptures, sousSeuil: k.sous_seuil, peremptionsProches: k.proches, lotsPerimes: k.perimes, lotsBloques: k.bloques,
        // Valeur d'achat du stock : réservée au pharmacien, au gestionnaire de stock et aux rapports (pas au vendeur).
        valeurStock: ctx.a("reports.read") || ctx.a("stock.approve") ? Number(k.valeur) : null, entreesJour: k.entrees_jour, sortiesJour: k.sorties_jour },
      derniersMouvements: derniers.map((m) => ({ id: m.id, numero: m.number, date: m.created_at, nature: NATURES_MOUVEMENT[m.kind], quantite: m.quantity, lot: m.lot_number, produit: m.name, auteur: m.full_name })),
    };
  }));
}
