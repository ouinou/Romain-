import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { exiger, pagination, proteger, type Ctx, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";
import { avecReglesBase } from "../../domaine/pharmacie/erreurs.js";
import { lireParametres } from "../../domaine/pharmacie/parametres.js";
import { lireCsv, versCsv } from "../../domaine/pharmacie/csv.js";

/**
 * Catalogue des produits. Un produit n'est jamais supprimé : il s'archive (il reste dans l'historique des
 * mouvements et des ventes). Chaque changement de prix ou de TVA ajoute une ligne à l'historique des prix.
 */
export const STATUTS_PRODUIT: Record<string, string> = { active: "Actif", suspended: "Suspendu", archived: "Archivé" };
const PRIX_MAX = 1_000_000_000;

/** Stock d'un produit : vendable (lots disponibles non périmés), total, prochaine péremption d'un lot en stock. */
export const SQL_STOCK_PRODUIT = `
  coalesce((SELECT sum(s.quantity) FROM lot_stock s JOIN lots l ON l.id = s.lot_id
             WHERE l.product_id = p.id AND l.status = 'available' AND l.expiry_date >= current_date), 0)::bigint AS vendable,
  coalesce((SELECT sum(s.quantity) FROM lot_stock s WHERE s.product_id = p.id), 0)::bigint AS total,
  (SELECT min(l.expiry_date)::text FROM lots l JOIN lot_stock s ON s.lot_id = l.id WHERE l.product_id = p.id AND s.quantity > 0) AS prochaine_peremption`;

const SELECT_PRODUITS = `
  SELECT p.*, c.name AS categorie, cp.name AS categorie_parent, c.parent_id AS categorie_parent_id, f.name AS forme, ${SQL_STOCK_PRODUIT}
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories cp ON cp.id = c.parent_id
    LEFT JOIN dosage_forms f ON f.id = p.form_id`;

export const vueProduit = (r: Record<string, any>) => ({
  id: r.id, code: r.internal_code, codeBarres: r.barcode, nom: r.name, dci: r.dci,
  categorieId: r.category_id, categorie: r.categorie_parent ? `${r.categorie_parent} › ${r.categorie}` : r.categorie ?? null,
  formeId: r.form_id, forme: r.forme ?? null, dosage: r.dosage, presentation: r.presentation, fabricant: r.manufacturer, fournisseur: r.usual_supplier,
  prixAchat: Number(r.purchase_price), prixVente: Number(r.sale_price), tauxTvaPdm: r.tax_rate_bp, seuil: r.alert_threshold,
  conservation: r.storage_conditions, categorieDelivrance: r.dispensing_category,
  statut: r.status, statutLibelle: STATUTS_PRODUIT[r.status],
  stock: { vendable: Number(r.vendable ?? 0), total: Number(r.total ?? 0), prochainePeremption: r.prochaine_peremption ?? null },
  alerte: r.status === "active" ? (Number(r.vendable ?? 0) === 0 ? "rupture" : Number(r.vendable) <= r.alert_threshold ? "seuil" : null) : null,
  creeLe: r.created_at, modifieLe: r.updated_at,
});

const texte = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const prix = z.number({ invalid_type_error: "Prix en francs, sans décimales." }).int("Prix en francs, sans décimales.").min(0, "Le prix ne peut pas être négatif.").max(PRIX_MAX);
const SCHEMA_PRODUIT = z.object({
  nom: z.string().trim().min(2, "Nom du produit obligatoire (2 caractères au moins).").max(160),
  dci: texte(160), codeBarres: texte(32).refine((v) => v == null || /^[0-9A-Za-z-]{4,32}$/.test(v), "Code-barres : 4 à 32 chiffres ou lettres, sans espace."),
  categorieId: z.string().regex(UUID).nullable().optional(), formeId: z.string().regex(UUID).nullable().optional(),
  dosage: texte(60), presentation: texte(120), fabricant: texte(120), fournisseur: texte(120),
  prixAchat: prix.optional(), prixVente: prix, tauxTvaPdm: z.number().int().min(0).max(10000).optional(),
  seuil: z.number().int("Seuil en nombre entier.").min(0, "Le seuil ne peut pas être négatif.").max(1_000_000).optional(),
  conservation: texte(120), categorieDelivrance: texte(80),
});

/** Le taux de TVA doit être 0 (non soumis) ou l'un des taux saisis dans les paramètres de la pharmacie. */
async function verifierTva(c: Client, entrepriseId: string, tauxPdm: number | undefined) {
  if (!tauxPdm) return;
  const p = await lireParametres(c, entrepriseId);
  if (!p.tauxTva.some((t) => t.tauxPdm === tauxPdm))
    throw new ErreurHttp(400, "tva_inconnue", "Ce taux de TVA n'est pas dans les paramètres de la pharmacie. Ajoutez-le d'abord (Administration › Paramètres de la pharmacie).");
}

async function chargerProduit(c: Client, id: string) {
  const { rows: [r] } = await c.query(`${SELECT_PRODUITS} WHERE p.id = $1`, [id]);
  return r ? vueProduit(r) : null;
}

const idParam = (req: { params: unknown }) => {
  const id = (req.params as { id: string }).id;
  if (!UUID.test(id)) throw nonTrouve("Produit");
  return id;
};

/** Filtres de la liste (aussi utilisés par l'export). */
function filtres(q: Record<string, string | undefined>) {
  const conds: string[] = [], vals: unknown[] = [];
  const v = (x: unknown) => { vals.push(x); return `$${vals.length}`; };
  const rech = q.recherche?.trim();
  if (rech) {
    const r = v(`%${rech}%`), exact = v(rech);
    conds.push(`(p.name ILIKE ${r} OR p.dci ILIKE ${r} OR p.internal_code ILIKE ${r} OR p.barcode = ${exact})`);
  }
  if (q.categorie && UUID.test(q.categorie)) { const c = v(q.categorie); conds.push(`(p.category_id = ${c} OR c.parent_id = ${c})`); }
  if (q.statut && q.statut in STATUTS_PRODUIT) conds.push(`p.status = ${v(q.statut)}`);
  else if (q.statut !== "tous") conds.push("p.status <> 'archived'");
  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", vals };
}

async function insererProduit(ctx: Ctx, d: z.infer<typeof SCHEMA_PRODUIT>) {
  const { rows: [r] } = await avecReglesBase(() => ctx.c.query(
    `INSERT INTO products (name, dci, barcode, category_id, form_id, dosage, presentation, manufacturer, usual_supplier, purchase_price, sale_price,
                           tax_rate_bp, alert_threshold, storage_conditions, dispensing_category, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, internal_code`,
    [d.nom, d.dci ?? null, d.codeBarres ?? null, d.categorieId ?? null, d.formeId ?? null, d.dosage ?? null, d.presentation ?? null, d.fabricant ?? null,
     d.fournisseur ?? null, d.prixAchat ?? 0, d.prixVente, d.tauxTvaPdm ?? 0, d.seuil ?? 0, d.conservation ?? null, d.categorieDelivrance ?? null, ctx.utilisateur.id]));
  await ctx.c.query("INSERT INTO product_price_history (product_id, purchase_price, sale_price, tax_rate_bp, changed_by) VALUES ($1,$2,$3,$4,$5)",
    [r.id, d.prixAchat ?? 0, d.prixVente, d.tauxTvaPdm ?? 0, ctx.utilisateur.id]);
  return r as { id: string; internal_code: string };
}

export function routesProduits(app: FastifyInstance, deps: Dependances) {
  app.get("/api/produits", proteger(deps, { permission: "catalog.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { page, taille, offset } = pagination(q);
    const { where, vals } = filtres(q);
    const alerte = q.alerte === "rupture" || q.alerte === "seuil" ? q.alerte : null;
    // Le filtre d'alerte porte sur le stock calculé : il s'applique sur la sous-requête.
    const base = `SELECT * FROM (${SELECT_PRODUITS} ${where}) x ${alerte === "rupture" ? "WHERE x.status = 'active' AND x.vendable = 0" : alerte === "seuil" ? "WHERE x.status = 'active' AND x.vendable > 0 AND x.vendable <= x.alert_threshold" : ""}`;
    const { rows: [n] } = await ctx.c.query(`SELECT count(*)::int AS total FROM (${base}) t`, vals);
    const { rows } = await ctx.c.query(`${base} ORDER BY lower(x.name) LIMIT ${taille} OFFSET ${offset}`, vals);
    return { elements: rows.map(vueProduit), total: n.total, page, taille };
  }));

  app.get("/api/produits/export", proteger(deps, { permission: "catalog.export" }, async (req, ctx) => {
    const { where, vals } = filtres(req.query as Record<string, string | undefined>);
    const { rows } = await ctx.c.query(`${SELECT_PRODUITS} ${where} ORDER BY lower(p.name)`, vals);
    await ctx.journaliser({ type: "catalog", action: "export", objetType: "product", details: { lignes: rows.length } });
    ctx.rep.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="catalogue.csv"');
    return versCsv(["Code", "Nom", "DCI", "Catégorie", "Forme", "Dosage", "Présentation", "Fabricant", "Fournisseur habituel", "Code-barres",
      "Prix d'achat", "Prix de vente", "TVA (%)", "Seuil", "Stock vendable", "Stock total", "Prochaine péremption", "Statut"],
      rows.map(vueProduit).map((p) => [p.code, p.nom, p.dci, p.categorie, p.forme, p.dosage, p.presentation, p.fabricant, p.fournisseur, p.codeBarres,
        p.prixAchat, p.prixVente, (p.tauxTvaPdm / 100).toLocaleString("fr-FR"), p.seuil, p.stock.vendable, p.stock.total, p.stock.prochainePeremption, p.statutLibelle]));
  }));

  app.get("/api/produits/:id", proteger(deps, { permission: "catalog.read" }, async (req, ctx) => {
    const id = idParam(req);
    const p = await chargerProduit(ctx.c, id);
    if (!p) throw nonTrouve("Produit");
    const { rows: prix } = await ctx.c.query(
      `SELECT h.purchase_price, h.sale_price, h.tax_rate_bp, h.changed_at, u.full_name FROM product_price_history h JOIN app_users u ON u.id = h.changed_by
        WHERE h.product_id = $1 ORDER BY h.changed_at DESC LIMIT 50`, [id]);
    return { ...p, historiquePrix: prix.map((h) => ({ prixAchat: Number(h.purchase_price), prixVente: Number(h.sale_price), tauxTvaPdm: h.tax_rate_bp, le: h.changed_at, par: h.full_name })) };
  }));

  app.post("/api/produits", proteger(deps, { permission: "catalog.create" }, async (req, ctx) => {
    const d = SCHEMA_PRODUIT.parse(req.body);
    await verifierTva(ctx.c, ctx.entrepriseId, d.tauxTvaPdm);
    const r = await insererProduit(ctx, d);
    await ctx.journaliser({ type: "catalog", action: "product_create", objetType: "product", objetId: r.id, apres: { code: r.internal_code, ...d } });
    return chargerProduit(ctx.c, r.id);
  }));

  app.patch("/api/produits/:id", proteger(deps, { permission: "catalog.update" }, async (req, ctx) => {
    const id = idParam(req);
    const d = SCHEMA_PRODUIT.partial().parse(req.body);
    const { rows: [avant] } = await ctx.c.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) throw nonTrouve("Produit");
    if (avant.status === "archived") throw new ErreurHttp(409, "produit_archive", "Ce produit est archivé : réactivez-le avant de le modifier.");
    if (d.tauxTvaPdm !== undefined && d.tauxTvaPdm !== avant.tax_rate_bp) await verifierTva(ctx.c, ctx.entrepriseId, d.tauxTvaPdm);
    const col: Record<string, string> = { nom: "name", dci: "dci", codeBarres: "barcode", categorieId: "category_id", formeId: "form_id", dosage: "dosage", presentation: "presentation",
      fabricant: "manufacturer", fournisseur: "usual_supplier", prixAchat: "purchase_price", prixVente: "sale_price", tauxTvaPdm: "tax_rate_bp", seuil: "alert_threshold",
      conservation: "storage_conditions", categorieDelivrance: "dispensing_category" };
    const champs = Object.entries(d).filter(([k, v]) => v !== undefined && col[k]);
    if (champs.length) await avecReglesBase(() => ctx.c.query(
      `UPDATE products SET ${champs.map(([k], i) => `${col[k]} = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...champs.map(([, v]) => v)]));
    const { rows: [apres] } = await ctx.c.query("SELECT purchase_price, sale_price, tax_rate_bp FROM products WHERE id = $1", [id]);
    if (Number(apres.purchase_price) !== Number(avant.purchase_price) || Number(apres.sale_price) !== Number(avant.sale_price) || apres.tax_rate_bp !== avant.tax_rate_bp)
      await ctx.c.query("INSERT INTO product_price_history (product_id, purchase_price, sale_price, tax_rate_bp, changed_by) VALUES ($1,$2,$3,$4,$5)",
        [id, apres.purchase_price, apres.sale_price, apres.tax_rate_bp, ctx.utilisateur.id]);
    await ctx.journaliser({ type: "catalog", action: "product_update", objetType: "product", objetId: id,
      avant: Object.fromEntries(champs.map(([k]) => [k, avant[col[k]]])), apres: Object.fromEntries(champs) });
    return chargerProduit(ctx.c, id);
  }));

  // Statut : actif, suspendu (plus vendable, visible), archivé (retiré des listes). Toujours motivé.
  app.post("/api/produits/:id/statut", proteger(deps, { permission: "catalog.archive" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ statut: z.enum(["active", "suspended", "archived"]), motif: z.string().trim().min(3, "Indiquez le motif (3 caractères au moins).").max(300) }).parse(req.body);
    const { rows: [avant] } = await ctx.c.query("SELECT status FROM products WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) throw nonTrouve("Produit");
    await ctx.c.query("UPDATE products SET status = $2 WHERE id = $1", [id, d.statut]);
    await ctx.journaliser({ type: "catalog", action: "product_status", objetType: "product", objetId: id, motif: d.motif, avant: { statut: avant.status }, apres: { statut: d.statut } });
    return chargerProduit(ctx.c, id);
  }));

  /**
   * Import CSV du catalogue (une ligne par produit). En deux temps : « verifier » contrôle tout et ne crée rien ;
   * l'import réel crée tout ou rien. Les catégories, familles et formes absentes sont créées.
   * Colonnes reconnues (première ligne) : nom, dci, categorie, famille, forme, dosage, presentation, fabricant,
   * fournisseur, code_barres, prix_achat, prix_vente, tva, seuil.
   */
  app.post("/api/produits/import", proteger(deps, { permission: "catalog.create" }, async (req, ctx) => {
    const d = z.object({ contenu: z.string().min(1, "Fichier vide.").max(5_000_000, "Fichier trop volumineux (5 Mo au plus)."), verifier: z.boolean().default(true) }).parse(req.body);
    exiger(ctx, "catalog.create");
    const lignes = lireCsv(d.contenu);
    if (lignes.length < 2) throw new ErreurHttp(400, "csv_vide", "Le fichier doit contenir une ligne d'en-tête et au moins un produit.");
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[\s-]+/g, "_");
    const entete = lignes[0].map(norm);
    const col = (nom: string) => entete.indexOf(nom);
    if (col("nom") < 0 || col("prix_vente") < 0) throw new ErreurHttp(400, "csv_colonnes", "Colonnes « nom » et « prix_vente » obligatoires dans la première ligne.");
    const tva = (await lireParametres(ctx.c, ctx.entrepriseId)).tauxTva;
    const nombre = (s: string | undefined) => { const t = (s ?? "").replace(/[\s  ]/g, "").replace(/(fcfa|xaf|f)$/i, ""); return t === "" ? undefined : /^\d+$/.test(t) ? Number(t) : NaN; };
    const erreurs: { ligne: number; message: string }[] = [];
    const produits: (z.infer<typeof SCHEMA_PRODUIT> & { _categorie?: string; _famille?: string; _forme?: string })[] = [];
    const codes = new Set<string>();
    for (const [i, l] of lignes.slice(1).entries()) {
      const n = i + 2, val = (k: string) => (col(k) >= 0 ? (l[col(k)] ?? "").trim() : "");
      const tvaTexte = val("tva").replace("%", "").replace(",", ".");
      const tauxPdm = tvaTexte === "" ? 0 : Math.round(Number(tvaTexte) * 100);
      if (Number.isNaN(tauxPdm) || (tauxPdm && !tva.some((t) => t.tauxPdm === tauxPdm))) { erreurs.push({ ligne: n, message: `TVA « ${val("tva")} » absente des paramètres de la pharmacie.` }); continue; }
      const brut = { nom: val("nom"), dci: val("dci"), codeBarres: val("code_barres"), dosage: val("dosage"), presentation: val("presentation"), fabricant: val("fabricant"),
        fournisseur: val("fournisseur"), prixAchat: nombre(val("prix_achat")), prixVente: nombre(val("prix_vente")), tauxTvaPdm: tauxPdm, seuil: nombre(val("seuil")) };
      const r = SCHEMA_PRODUIT.safeParse(brut);
      if (!r.success) { erreurs.push({ ligne: n, message: r.error.issues.map((x) => `${x.path.join(".") || "ligne"} : ${x.message}`).join(" ; ") }); continue; }
      if (r.data.codeBarres) {
        if (codes.has(r.data.codeBarres)) { erreurs.push({ ligne: n, message: `Code-barres ${r.data.codeBarres} en double dans le fichier.` }); continue; }
        codes.add(r.data.codeBarres);
      }
      produits.push({ ...r.data, _categorie: val("categorie") || undefined, _famille: val("famille") || undefined, _forme: val("forme") || undefined });
    }
    if (codes.size) {
      const { rows } = await ctx.c.query("SELECT barcode FROM products WHERE barcode = ANY($1)", [[...codes]]);
      for (const r of rows) erreurs.push({ ligne: 0, message: `Code-barres ${r.barcode} déjà attribué à un produit du catalogue.` });
    }
    if (d.verifier || erreurs.length) return { lignes: lignes.length - 1, valides: produits.length, erreurs, crees: 0 };
    // Import réel (dans la transaction de la requête : tout ou rien).
    const idRef = async (table: string, nom: string, parent: string | null = null) => {
      const { rows: [x] } = await ctx.c.query(`SELECT id FROM ${table} WHERE lower(btrim(name)) = lower(btrim($1)) ${table === "categories" ? (parent ? "AND parent_id = $2" : "AND parent_id IS NULL") : ""}`,
        table === "categories" && parent ? [nom, parent] : [nom]);
      if (x) return x.id as string;
      const { rows: [y] } = await ctx.c.query(table === "categories" ? "INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id" : `INSERT INTO ${table} (name) VALUES ($1) RETURNING id`,
        table === "categories" ? [nom, parent] : [nom]);
      return y.id as string;
    };
    for (const p of produits) {
      const cat = p._categorie ? await idRef("categories", p._categorie) : null;
      const categorieId = p._famille && cat ? await idRef("categories", p._famille, cat) : cat;
      const formeId = p._forme ? await idRef("dosage_forms", p._forme) : null;
      const { _categorie, _famille, _forme, ...donnees } = p;
      await insererProduit(ctx, { ...donnees, categorieId, formeId });
    }
    await ctx.journaliser({ type: "catalog", action: "import", objetType: "product", details: { produits: produits.length } });
    return { lignes: lignes.length - 1, valides: produits.length, erreurs: [], crees: produits.length };
  }));
}
