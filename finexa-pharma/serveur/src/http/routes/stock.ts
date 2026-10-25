import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { exigerConfirmation, pagination, proteger, type Ctx, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";
import { avecReglesBase } from "../../domaine/pharmacie/erreurs.js";
import { lireParametres } from "../../domaine/pharmacie/parametres.js";
import { versCsv } from "../../domaine/pharmacie/csv.js";

/**
 * Lots, stock et mouvements. Le stock d'un lot est la somme de ses mouvements (vue lot_stock) ; un mouvement
 * enregistré ne se modifie ni ne se supprime : une erreur se corrige par un ajustement motivé.
 */
export const NATURES_MOUVEMENT: Record<string, string> = {
  initial: "Stock initial", receipt: "Réception", sale: "Vente", customer_return: "Retour client", supplier_return: "Retour fournisseur",
  adjustment: "Ajustement", breakage: "Casse", expiry: "Sortie pour péremption", inventory: "Écart d'inventaire",
};
export const STATUTS_LOT: Record<string, string> = { available: "Disponible", blocked: "Bloqué", recalled: "Rappelé" };
/** Motifs d'ajustement proposés ; « autre » demande un texte. */
export const MOTIFS_AJUSTEMENT: Record<string, { libelle: string; nature: "adjustment" | "breakage" | "expiry"; sens: "entree" | "sortie" | "les_deux" }> = {
  casse: { libelle: "Casse ou produit abîmé", nature: "breakage", sens: "sortie" },
  peremption: { libelle: "Produit périmé retiré du stock", nature: "expiry", sens: "sortie" },
  erreur_saisie: { libelle: "Correction d'une erreur de saisie", nature: "adjustment", sens: "les_deux" },
  vol: { libelle: "Vol ou disparition constatée", nature: "adjustment", sens: "sortie" },
  autre: { libelle: "Autre motif (à préciser)", nature: "adjustment", sens: "les_deux" },
};

const aujourdhui = () => new Date().toISOString().slice(0, 10);

const SELECT_LOTS = `
  SELECT l.*, l.expiry_date::text AS peremption, l.received_on::text AS recu_le, p.name AS produit, p.internal_code, p.status AS statut_produit,
         s.quantity, e.name AS emplacement, (l.expiry_date - current_date) AS jours_restants
    FROM lots l JOIN products p ON p.id = l.product_id JOIN lot_stock s ON s.lot_id = l.id
    LEFT JOIN storage_locations e ON e.id = l.location_id`;

export const vueLot = (r: Record<string, any>, delai: number) => {
  const jours = Number(r.jours_restants);
  return {
    id: r.id, produitId: r.product_id, produit: r.produit, codeProduit: r.internal_code, numero: r.lot_number, peremption: r.peremption,
    joursRestants: jours, fournisseur: r.supplier_name, recuLe: r.recu_le, prixAchat: Number(r.purchase_price),
    emplacementId: r.location_id, emplacement: r.emplacement ?? null, quantite: Number(r.quantity),
    statut: r.status, statutLibelle: STATUTS_LOT[r.status], motifStatut: r.status_reason,
    // État de vente, calculé : seul un lot disponible, non périmé et en stock peut être vendu.
    etat: r.status !== "available" ? r.status : jours < 0 ? "perime" : jours <= delai ? "proche" : "ok",
    vendable: r.status === "available" && jours >= 0 && Number(r.quantity) > 0,
    creeLe: r.created_at,
  };
};

const vueMouvement = (r: Record<string, any>) => ({
  id: r.id, numero: r.number, date: r.created_at, nature: r.kind, natureLibelle: NATURES_MOUVEMENT[r.kind], quantite: r.quantity,
  lotId: r.lot_id, lot: r.lot_number, produitId: r.product_id, produit: r.produit, motif: r.reason, inventaireId: r.inventory_id, inventaire: r.inventaire ?? null, auteur: r.auteur,
});
const SELECT_MOUVEMENTS = `
  SELECT m.*, l.lot_number, p.name AS produit, u.full_name AS auteur, i.number AS inventaire
    FROM stock_movements m JOIN lots l ON l.id = m.lot_id JOIN products p ON p.id = m.product_id JOIN app_users u ON u.id = m.created_by
    LEFT JOIN inventories i ON i.id = m.inventory_id`;

async function chargerLot(c: Client, id: string, delai: number) {
  const { rows: [r] } = await c.query(`${SELECT_LOTS} WHERE l.id = $1`, [id]);
  return r ? vueLot(r, delai) : null;
}

/** Enregistre un mouvement ; les refus de la base (stock insuffisant…) deviennent des messages clairs. */
export async function mouvement(ctx: Ctx, m: { lotId: string; produitId: string; nature: string; quantite: number; motif?: string | null; inventaireId?: string | null }) {
  const { rows: [r] } = await avecReglesBase(() => ctx.c.query(
    "INSERT INTO stock_movements (lot_id, product_id, kind, quantity, reason, inventory_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, number",
    [m.lotId, m.produitId, m.nature, m.quantite, m.motif ?? null, m.inventaireId ?? null, ctx.utilisateur.id]));
  return r as { id: string; number: string };
}

const idParam = (req: { params: unknown }, quoi: string) => {
  const id = (req.params as { id: string }).id;
  if (!UUID.test(id)) throw nonTrouve(quoi);
  return id;
};

function filtresLots(q: Record<string, string | undefined>, delai: number) {
  const conds: string[] = [], vals: unknown[] = [];
  const v = (x: unknown) => { vals.push(x); return `$${vals.length}`; };
  if (q.produit && UUID.test(q.produit)) conds.push(`l.product_id = ${v(q.produit)}`);
  const rech = q.recherche?.trim();
  if (rech) { const r = v(`%${rech}%`); conds.push(`(l.lot_number ILIKE ${r} OR p.name ILIKE ${r} OR p.internal_code ILIKE ${r})`); }
  if (q.statut && q.statut in STATUTS_LOT) conds.push(`l.status = ${v(q.statut)}`);
  if (q.etat === "proche") conds.push(`l.expiry_date >= current_date AND l.expiry_date <= current_date + ${v(delai)}::int AND s.quantity > 0`);
  if (q.etat === "perime") conds.push("l.expiry_date < current_date AND s.quantity > 0");
  if (q.enStock !== "non") conds.push("s.quantity > 0");
  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", vals };
}

export function routesStock(app: FastifyInstance, deps: Dependances) {
  app.get("/api/stock/references", proteger(deps, { permission: "stock.read" }, async () => ({
    natures: NATURES_MOUVEMENT, statutsLot: STATUTS_LOT,
    motifsAjustement: Object.entries(MOTIFS_AJUSTEMENT).map(([cle, m]) => ({ cle, ...m })),
  })));

  /* ------------------------------------------------------------ Lots */
  app.get("/api/lots", proteger(deps, { permission: "stock.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { delaiAlertePeremption: delai } = await lireParametres(ctx.c, ctx.entrepriseId);
    const { page, taille, offset } = pagination(q);
    const { where, vals } = filtresLots(q, delai);
    const { rows: [n] } = await ctx.c.query(`SELECT count(*)::int AS total FROM (${SELECT_LOTS} ${where}) t`, vals);
    const { rows } = await ctx.c.query(`${SELECT_LOTS} ${where} ORDER BY l.expiry_date, lower(p.name) LIMIT ${taille} OFFSET ${offset}`, vals);
    return { elements: rows.map((r) => vueLot(r, delai)), total: n.total, page, taille, delaiAlertePeremption: delai };
  }));

  app.get("/api/lots/export", proteger(deps, { permission: "stock.export" }, async (req, ctx) => {
    const { delaiAlertePeremption: delai } = await lireParametres(ctx.c, ctx.entrepriseId);
    const { where, vals } = filtresLots(req.query as Record<string, string | undefined>, delai);
    const { rows } = await ctx.c.query(`${SELECT_LOTS} ${where} ORDER BY lower(p.name), l.expiry_date`, vals);
    await ctx.journaliser({ type: "stock", action: "export", objetType: "lot", details: { lignes: rows.length } });
    ctx.rep.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="stock-par-lot-${aujourdhui()}.csv"`);
    return versCsv(["Code produit", "Produit", "N° de lot", "Péremption", "Quantité", "Prix d'achat", "Valeur", "Emplacement", "Fournisseur", "Statut"],
      rows.map((r) => vueLot(r, delai)).map((l) => [l.codeProduit, l.produit, l.numero, l.peremption, l.quantite, l.prixAchat, l.quantite * l.prixAchat, l.emplacement, l.fournisseur, l.statutLibelle]));
  }));

  app.get("/api/lots/:id", proteger(deps, { permission: "stock.read" }, async (req, ctx) => {
    const id = idParam(req, "Lot");
    const { delaiAlertePeremption: delai } = await lireParametres(ctx.c, ctx.entrepriseId);
    const l = await chargerLot(ctx.c, id, delai);
    if (!l) throw nonTrouve("Lot");
    const { rows } = await ctx.c.query(`${SELECT_MOUVEMENTS} WHERE m.lot_id = $1 ORDER BY m.year, m.sequence_no`, [id]);
    let cumul = 0;
    return { ...l, mouvements: rows.map((r) => ({ ...vueMouvement(r), solde: (cumul += r.quantity) })) };
  }));

  /**
   * Entrée de stock hors achat : stock d'ouverture de l'officine, ou lot reçu avant la mise en service du module
   * achats. Crée le lot (ou complète un lot existant du même numéro) et un mouvement « stock initial ».
   */
  app.post("/api/lots", proteger(deps, { permission: "stock.create" }, async (req, ctx) => {
    const d = z.object({
      produitId: z.string().regex(UUID, "Choisissez un produit."),
      numero: z.string().trim().min(1, "Numéro de lot obligatoire.").max(40),
      peremption: z.string().date("Date de péremption obligatoire (AAAA-MM-JJ)."),
      quantite: z.number().int("Quantité en nombre entier de boîtes.").min(1, "Quantité d'au moins 1.").max(1_000_000),
      prixAchat: z.number().int().min(0).max(1_000_000_000).optional(),
      fournisseur: z.string().trim().max(120).optional(),
      recuLe: z.string().date().optional(),
      emplacementId: z.string().regex(UUID).nullable().optional(),
      motif: z.string().trim().max(300).optional(),
    }).parse(req.body);
    const { rows: [p] } = await ctx.c.query("SELECT id, status, purchase_price, usual_supplier FROM products WHERE id = $1", [d.produitId]);
    if (!p) throw new ErreurHttp(400, "produit_inconnu", "Produit introuvable.");
    if (p.status === "archived") throw new ErreurHttp(409, "produit_archive", "Ce produit est archivé : réactivez-le avant d'y ajouter du stock.");
    if ((d.recuLe ?? aujourdhui()) > aujourdhui()) throw new ErreurHttp(400, "date_future", "La date de réception ne peut pas être dans le futur.");
    if (d.peremption < aujourdhui()) throw new ErreurHttp(400, "lot_perime", "Ce lot est déjà périmé : il ne peut pas entrer dans le stock vendable.");
    const { rows: [existant] } = await ctx.c.query("SELECT id, expiry_date::text AS peremption FROM lots WHERE product_id = $1 AND upper(btrim(lot_number)) = upper(btrim($2))", [d.produitId, d.numero]);
    if (existant && existant.peremption !== d.peremption)
      throw new ErreurHttp(409, "peremption_differente", `Le lot ${d.numero} existe déjà avec une autre date de péremption (${existant.peremption.split("-").reverse().join("/")}). Vérifiez la boîte.`);
    const lotId = existant?.id ?? (await avecReglesBase(() => ctx.c.query(
      `INSERT INTO lots (product_id, lot_number, expiry_date, supplier_name, received_on, purchase_price, location_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [d.produitId, d.numero, d.peremption, d.fournisseur || p.usual_supplier || null, d.recuLe ?? aujourdhui(), d.prixAchat ?? Number(p.purchase_price), d.emplacementId ?? null, ctx.utilisateur.id]))).rows[0].id;
    const m = await mouvement(ctx, { lotId, produitId: d.produitId, nature: "initial", quantite: d.quantite, motif: d.motif || "Stock initial" });
    await ctx.journaliser({ type: "stock", action: "initial_stock", objetType: "lot", objetId: lotId, apres: { ...d, mouvement: m.number, lotExistant: !!existant } });
    const { delaiAlertePeremption: delai } = await lireParametres(ctx.c, ctx.entrepriseId);
    return chargerLot(ctx.c, lotId, delai);
  }));

  // Blocage (contrôle qualité, doute) ou rappel d'un lot ; déblocage. Toujours motivé et tracé.
  app.post("/api/lots/:id/statut", proteger(deps, { permission: "stock.update" }, async (req, ctx) => {
    const id = idParam(req, "Lot");
    const d = z.object({ statut: z.enum(["available", "blocked", "recalled"]), motif: z.string().trim().min(3, "Indiquez le motif (3 caractères au moins).").max(300) }).parse(req.body);
    const { rows: [avant] } = await ctx.c.query("SELECT status FROM lots WHERE id = $1", [id]);
    if (!avant) throw nonTrouve("Lot");
    if (avant.status === "recalled" && d.statut !== "recalled") exigerConfirmation(ctx);   // lever un rappel : confirmation par mot de passe
    await ctx.c.query("UPDATE lots SET status = $2, status_reason = $3 WHERE id = $1", [id, d.statut, d.statut === "available" ? null : d.motif]);
    await ctx.journaliser({ type: "stock", action: "lot_status", objetType: "lot", objetId: id, motif: d.motif, avant: { statut: avant.status }, apres: { statut: d.statut } });
    const { delaiAlertePeremption: delai } = await lireParametres(ctx.c, ctx.entrepriseId);
    return chargerLot(ctx.c, id, delai);
  }));

  app.patch("/api/lots/:id", proteger(deps, { permission: "stock.update" }, async (req, ctx) => {
    const id = idParam(req, "Lot");
    const d = z.object({ emplacementId: z.string().regex(UUID).nullable() }).parse(req.body);
    const { rowCount } = await avecReglesBase(() => ctx.c.query("UPDATE lots SET location_id = $2 WHERE id = $1", [id, d.emplacementId]));
    if (!rowCount) throw nonTrouve("Lot");
    await ctx.journaliser({ type: "stock", action: "lot_location", objetType: "lot", objetId: id, apres: d });
    const { delaiAlertePeremption: delai } = await lireParametres(ctx.c, ctx.entrepriseId);
    return chargerLot(ctx.c, id, delai);
  }));

  /* ------------------------------------------------------------ Ajustements */
  app.post("/api/stock/ajustements", proteger(deps, { permission: "stock.approve", sensible: true }, async (req, ctx) => {
    const d = z.object({
      lotId: z.string().regex(UUID, "Choisissez un lot."),
      sens: z.enum(["entree", "sortie"]),
      quantite: z.number().int("Quantité en nombre entier.").min(1, "Quantité d'au moins 1.").max(1_000_000),
      motif: z.enum(Object.keys(MOTIFS_AJUSTEMENT) as [string, ...string[]]),
      precision: z.string().trim().max(300).optional(),
    }).parse(req.body);
    const m = MOTIFS_AJUSTEMENT[d.motif];
    if (m.sens !== "les_deux" && m.sens !== d.sens) throw new ErreurHttp(400, "sens_motif", `« ${m.libelle} » est forcément une sortie de stock.`);
    if (d.motif === "autre" && (d.precision ?? "").length < 3) throw new ErreurHttp(400, "precision", "Précisez le motif (3 caractères au moins).");
    const { rows: [l] } = await ctx.c.query("SELECT product_id, lot_number FROM lots WHERE id = $1", [d.lotId]);
    if (!l) throw new ErreurHttp(400, "lot_inconnu", "Lot introuvable.");
    const motif = [m.libelle, d.precision].filter(Boolean).join(" : ");
    const mv = await mouvement(ctx, { lotId: d.lotId, produitId: l.product_id, nature: m.nature, quantite: d.sens === "entree" ? d.quantite : -d.quantite, motif });
    await ctx.journaliser({ type: "stock", action: "adjustment", objetType: "lot", objetId: d.lotId, motif, apres: { mouvement: mv.number, lot: l.lot_number, sens: d.sens, quantite: d.quantite, motif: d.motif } });
    return { numero: mv.number, id: mv.id };
  }));

  /* ------------------------------------------------------------ Mouvements */
  const filtresMouvements = (q: Record<string, string | undefined>) => {
    const conds: string[] = [], vals: unknown[] = [];
    const v = (x: unknown) => { vals.push(x); return `$${vals.length}`; };
    if (q.produit && UUID.test(q.produit)) conds.push(`m.product_id = ${v(q.produit)}`);
    if (q.lot && UUID.test(q.lot)) conds.push(`m.lot_id = ${v(q.lot)}`);
    if (q.nature && q.nature in NATURES_MOUVEMENT) conds.push(`m.kind = ${v(q.nature)}`);
    if (q.du && /^\d{4}-\d{2}-\d{2}$/.test(q.du)) conds.push(`m.created_at >= ${v(q.du)}::date`);
    if (q.au && /^\d{4}-\d{2}-\d{2}$/.test(q.au)) conds.push(`m.created_at < ${v(q.au)}::date + 1`);
    const rech = q.recherche?.trim();
    if (rech) { const r = v(`%${rech}%`); conds.push(`(p.name ILIKE ${r} OR l.lot_number ILIKE ${r} OR m.number ILIKE ${r})`); }
    return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", vals };
  };

  app.get("/api/stock/mouvements", proteger(deps, { permission: "stock.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { page, taille, offset } = pagination(q);
    const { where, vals } = filtresMouvements(q);
    const { rows: [n] } = await ctx.c.query(`SELECT count(*)::int AS total FROM stock_movements m JOIN lots l ON l.id = m.lot_id JOIN products p ON p.id = m.product_id ${where}`, vals);
    const { rows } = await ctx.c.query(`${SELECT_MOUVEMENTS} ${where} ORDER BY m.created_at DESC, m.sequence_no DESC LIMIT ${taille} OFFSET ${offset}`, vals);
    return { elements: rows.map(vueMouvement), total: n.total, page, taille };
  }));

  app.get("/api/stock/mouvements/export", proteger(deps, { permission: "stock.export" }, async (req, ctx) => {
    const { where, vals } = filtresMouvements(req.query as Record<string, string | undefined>);
    const { rows } = await ctx.c.query(`${SELECT_MOUVEMENTS} ${where} ORDER BY m.created_at, m.sequence_no`, vals);
    await ctx.journaliser({ type: "stock", action: "export", objetType: "stock_movement", details: { lignes: rows.length } });
    ctx.rep.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="mouvements-${aujourdhui()}.csv"`);
    return versCsv(["N°", "Date", "Nature", "Produit", "N° de lot", "Quantité", "Motif", "Auteur"],
      rows.map(vueMouvement).map((m) => [m.numero, new Date(m.date).toLocaleString("fr-FR"), m.natureLibelle, m.produit, m.lot, m.quantite, m.motif, m.auteur]));
  }));

  /* ------------------------------------------------------------ Alertes */
  app.get("/api/stock/alertes", proteger(deps, { permission: "stock.read" }, async (_req, ctx) => {
    const { delaiAlertePeremption: delai } = await lireParametres(ctx.c, ctx.entrepriseId);
    const { rows: produits } = await ctx.c.query(
      `SELECT * FROM (SELECT p.id, p.name, p.internal_code, p.alert_threshold,
              coalesce((SELECT sum(s.quantity) FROM lot_stock s JOIN lots l ON l.id = s.lot_id WHERE l.product_id = p.id AND l.status = 'available' AND l.expiry_date >= current_date), 0)::bigint AS vendable
         FROM products p WHERE p.status = 'active') x
        WHERE x.vendable = 0 OR x.vendable <= x.alert_threshold ORDER BY x.vendable, lower(x.name) LIMIT 500`);
    const { rows: lots } = await ctx.c.query(`${SELECT_LOTS} WHERE s.quantity > 0 AND (l.expiry_date <= current_date + $1::int OR l.status <> 'available') ORDER BY l.expiry_date LIMIT 500`, [delai]);
    const vues = lots.map((r) => vueLot(r, delai));
    return {
      delaiAlertePeremption: delai,
      ruptures: produits.filter((p) => Number(p.vendable) === 0).map((p) => ({ id: p.id, nom: p.name, code: p.internal_code, vendable: 0, seuil: p.alert_threshold })),
      sousSeuil: produits.filter((p) => Number(p.vendable) > 0).map((p) => ({ id: p.id, nom: p.name, code: p.internal_code, vendable: Number(p.vendable), seuil: p.alert_threshold })),
      perimes: vues.filter((l) => l.etat === "perime"),
      proches: vues.filter((l) => l.etat === "proche"),
      bloques: vues.filter((l) => l.statut !== "available"),
    };
  }));
}
