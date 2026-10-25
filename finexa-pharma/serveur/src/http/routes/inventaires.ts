import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { pagination, proteger, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";
import { avecReglesBase } from "../../domaine/pharmacie/erreurs.js";
import { mouvement } from "./stock.js";

/**
 * Inventaire physique. À l'ouverture, une ligne par lot en stock (dans le périmètre choisi). Quand on saisit un
 * comptage, le stock théorique du lot est relu à cet instant : les ventes faites pendant l'inventaire ne
 * faussent donc pas l'écart. À la validation, chaque écart devient un mouvement « écart d'inventaire ».
 * Un seul inventaire ouvert à la fois ; un inventaire validé ou annulé est figé (contrôle en base).
 */
const STATUTS: Record<string, string> = { open: "En cours", validated: "Validé", cancelled: "Annulé" };

async function charger(c: Client, id: string) {
  const { rows: [i] } = await c.query(
    `SELECT i.*, u.full_name AS auteur, v.full_name AS cloture_par FROM inventories i JOIN app_users u ON u.id = i.created_by
       LEFT JOIN app_users v ON v.id = i.closed_by WHERE i.id = $1`, [id]);
  if (!i) return null;
  const { rows } = await c.query(
    `SELECT il.lot_id, il.expected, il.counted, l.lot_number, l.expiry_date::text AS peremption, p.id AS produit_id, p.name AS produit, p.internal_code,
            s.quantity AS stock_actuel, e.name AS emplacement
       FROM inventory_lines il JOIN lots l ON l.id = il.lot_id JOIN products p ON p.id = l.product_id JOIN lot_stock s ON s.lot_id = l.id
       LEFT JOIN storage_locations e ON e.id = l.location_id
      WHERE il.inventory_id = $1 ORDER BY lower(p.name), l.expiry_date`, [id]);
  const lignes = rows.map((r) => ({
    lotId: r.lot_id, lot: r.lot_number, peremption: r.peremption, produitId: r.produit_id, produit: r.produit, codeProduit: r.internal_code, emplacement: r.emplacement,
    theorique: r.expected, compte: r.counted, ecart: r.counted === null ? null : r.counted - r.expected, stockActuel: Number(r.stock_actuel),
  }));
  return {
    id: i.id, numero: i.number, libelle: i.label, statut: i.status, statutLibelle: STATUTS[i.status], auteur: i.auteur, creeLe: i.created_at,
    cloturePar: i.cloture_par, clotureLe: i.closed_at, lignes,
    resume: { lignes: lignes.length, comptees: lignes.filter((l) => l.compte !== null).length, ecarts: lignes.filter((l) => l.ecart).length,
      ecartTotal: lignes.reduce((s, l) => s + (l.ecart ?? 0), 0) },
  };
}

const idParam = (req: { params: unknown }) => {
  const id = (req.params as { id: string }).id;
  if (!UUID.test(id)) throw nonTrouve("Inventaire");
  return id;
};

export function routesInventaires(app: FastifyInstance, deps: Dependances) {
  app.get("/api/inventaires", proteger(deps, { permission: "stock.read" }, async (req, ctx) => {
    const { page, taille, offset } = pagination(req.query as Record<string, string>);
    const { rows: [n] } = await ctx.c.query("SELECT count(*)::int AS total FROM inventories");
    const { rows } = await ctx.c.query(
      `SELECT i.id, i.number, i.label, i.status, i.created_at, i.closed_at, u.full_name AS auteur,
              (SELECT count(*)::int FROM inventory_lines il WHERE il.inventory_id = i.id) AS lignes,
              (SELECT count(*)::int FROM inventory_lines il WHERE il.inventory_id = i.id AND il.counted IS NOT NULL) AS comptees
         FROM inventories i JOIN app_users u ON u.id = i.created_by ORDER BY i.created_at DESC LIMIT ${taille} OFFSET ${offset}`);
    return { elements: rows.map((r) => ({ id: r.id, numero: r.number, libelle: r.label, statut: r.status, statutLibelle: STATUTS[r.status], creeLe: r.created_at, clotureLe: r.closed_at, auteur: r.auteur, lignes: r.lignes, comptees: r.comptees })),
      total: n.total, page, taille };
  }));

  app.get("/api/inventaires/:id", proteger(deps, { permission: "stock.read" }, async (req, ctx) => {
    const i = await charger(ctx.c, idParam(req));
    if (!i) throw nonTrouve("Inventaire");
    return i;
  }));

  app.post("/api/inventaires", proteger(deps, { permission: "stock.create" }, async (req, ctx) => {
    const d = z.object({
      libelle: z.string().trim().min(2, "Donnez un nom à l'inventaire (ex. « Inventaire annuel »).").max(120),
      categorieId: z.string().regex(UUID).nullable().optional(), emplacementId: z.string().regex(UUID).nullable().optional(),
    }).parse(req.body);
    await ctx.c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventaire-ouvert:' || $1, 0))", [ctx.entrepriseId]);
    const { rows: [ouvert] } = await ctx.c.query("SELECT number FROM inventories WHERE status = 'open'");
    if (ouvert) throw new ErreurHttp(409, "inventaire_ouvert", `L'inventaire ${ouvert.number} est déjà en cours : validez-le ou annulez-le avant d'en ouvrir un autre.`);
    const { rows: [inv] } = await ctx.c.query("INSERT INTO inventories (label, created_by) VALUES ($1, $2) RETURNING id, number", [d.libelle, ctx.utilisateur.id]);
    const { rowCount } = await ctx.c.query(
      `INSERT INTO inventory_lines (inventory_id, lot_id, expected)
       SELECT $1, l.id, s.quantity FROM lots l JOIN lot_stock s ON s.lot_id = l.id JOIN products p ON p.id = l.product_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.quantity > 0 AND ($2::uuid IS NULL OR p.category_id = $2 OR c.parent_id = $2) AND ($3::uuid IS NULL OR l.location_id = $3)`,
      [inv.id, d.categorieId ?? null, d.emplacementId ?? null]);
    if (!rowCount) throw new ErreurHttp(409, "inventaire_vide", "Aucun lot en stock dans ce périmètre : rien à inventorier.");
    await ctx.journaliser({ type: "stock", action: "inventory_open", objetType: "inventory", objetId: inv.id, apres: { numero: inv.number, ...d, lignes: rowCount } });
    return charger(ctx.c, inv.id);
  }));

  // Ajouter un lot trouvé en rayon mais absent de la liste (lot connu, stock théorique à zéro par exemple).
  app.post("/api/inventaires/:id/lignes", proteger(deps, { permission: "stock.create" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ lotId: z.string().regex(UUID) }).parse(req.body);
    await avecReglesBase(() => ctx.c.query(
      "INSERT INTO inventory_lines (inventory_id, lot_id, expected) SELECT $1, $2, quantity FROM lot_stock WHERE lot_id = $2 ON CONFLICT DO NOTHING", [id, d.lotId]));
    return charger(ctx.c, id);
  }));

  app.put("/api/inventaires/:id/comptages", proteger(deps, { permission: "stock.create" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ lignes: z.array(z.object({ lotId: z.string().regex(UUID), compte: z.number().int("Quantité en nombre entier.").min(0, "Quantité négative impossible.").max(1_000_000).nullable() })).min(1).max(5000) }).parse(req.body);
    const { rows: [i] } = await ctx.c.query("SELECT status FROM inventories WHERE id = $1 FOR UPDATE", [id]);
    if (!i) throw nonTrouve("Inventaire");
    if (i.status !== "open") throw new ErreurHttp(409, "inventaire_clos", "Cet inventaire est clos : ses comptages ne se modifient plus.");
    for (const l of d.lignes) {
      // Le stock théorique est relu au moment du comptage (voir l'en-tête de ce fichier).
      const { rowCount } = await avecReglesBase(() => ctx.c.query(
        `UPDATE inventory_lines il SET counted = $3, expected = CASE WHEN $3::int IS NULL THEN il.expected ELSE (SELECT quantity FROM lot_stock WHERE lot_id = il.lot_id) END
          WHERE il.inventory_id = $1 AND il.lot_id = $2 AND il.counted IS DISTINCT FROM $3`, [id, l.lotId, l.compte]));
      void rowCount;
    }
    return charger(ctx.c, id);
  }));

  app.post("/api/inventaires/:id/validation", proteger(deps, { permission: "stock.approve", sensible: true }, async (req, ctx) => {
    const id = idParam(req);
    const inv = await charger(ctx.c, id);
    if (!inv) throw nonTrouve("Inventaire");
    if (inv.statut !== "open") throw new ErreurHttp(409, "inventaire_clos", "Cet inventaire est déjà clos.");
    if (!inv.resume.comptees) throw new ErreurHttp(409, "rien_compte", "Aucune ligne n'a été comptée.");
    const mouvements: string[] = [];
    for (const l of inv.lignes.filter((x) => x.ecart)) {
      const m = await mouvement(ctx, { lotId: l.lotId, produitId: l.produitId, nature: "inventory", quantite: l.ecart!, inventaireId: id, motif: `Inventaire ${inv.numero}` });
      mouvements.push(m.number);
    }
    await ctx.c.query("UPDATE inventories SET status = 'validated', closed_by = $2, closed_at = now() WHERE id = $1", [id, ctx.utilisateur.id]);
    await ctx.journaliser({ type: "stock", action: "inventory_validate", objetType: "inventory", objetId: id,
      apres: { numero: inv.numero, comptees: inv.resume.comptees, nonComptees: inv.resume.lignes - inv.resume.comptees, ecarts: inv.resume.ecarts, ecartTotal: inv.resume.ecartTotal }, details: { mouvements } });
    return charger(ctx.c, id);
  }));

  app.post("/api/inventaires/:id/annulation", proteger(deps, { permission: "stock.approve" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ motif: z.string().trim().min(3, "Indiquez le motif (3 caractères au moins).").max(300) }).parse(req.body);
    const { rowCount } = await ctx.c.query("UPDATE inventories SET status = 'cancelled', closed_by = $2, closed_at = now() WHERE id = $1 AND status = 'open'", [id, ctx.utilisateur.id]);
    if (!rowCount) throw new ErreurHttp(409, "inventaire_clos", "Seul un inventaire en cours peut être annulé.");
    await ctx.journaliser({ type: "stock", action: "inventory_cancel", objetType: "inventory", objetId: id, motif: d.motif });
    return charger(ctx.c, id);
  }));
}
