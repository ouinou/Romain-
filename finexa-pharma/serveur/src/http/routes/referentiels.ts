import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID } from "../../db.js";
import { proteger, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";
import { avecReglesBase } from "../../domaine/pharmacie/erreurs.js";
import { SCHEMA_PARAMETRES, lireParametres } from "../../domaine/pharmacie/parametres.js";

/**
 * Référentiels de l'officine : catégories et familles (deux niveaux), formes pharmaceutiques, emplacements de
 * rangement ; paramètres de la pharmacie (délai d'alerte de péremption, taux de TVA disponibles).
 * Rien ne se supprime : un élément utilisé s'archive et disparaît des listes de choix.
 */
const NATURES_EMPLACEMENT: Record<string, string> = { shelf: "Rayon", reserve: "Réserve", cold: "Réfrigérateur", other: "Autre" };
const idParam = (req: { params: unknown }) => {
  const id = (req.params as { id: string }).id;
  if (!UUID.test(id)) throw nonTrouve("Élément");
  return id;
};

export function routesReferentiels(app: FastifyInstance, deps: Dependances) {
  /* ------------------------------------------------------------ Catégories et familles */
  app.get("/api/referentiels/categories", proteger(deps, { permission: "catalog.read" }, async (_req, ctx) => {
    const { rows } = await ctx.c.query(
      `SELECT c.id, c.parent_id, c.name, c.archived_at IS NOT NULL AS archivee,
              (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.status <> 'archived') AS produits
         FROM categories c ORDER BY lower(c.name)`);
    const vue = (r: Record<string, any>) => ({ id: r.id, nom: r.name, archivee: r.archivee, produits: r.produits });
    return rows.filter((r) => !r.parent_id).map((r) => ({ ...vue(r), familles: rows.filter((f) => f.parent_id === r.id).map(vue) }));
  }));

  app.post("/api/referentiels/categories", proteger(deps, { permission: "catalog.admin" }, async (req, ctx) => {
    const d = z.object({ nom: z.string().trim().min(2, "Nom trop court.").max(80), parentId: z.string().regex(UUID).nullable().optional() }).parse(req.body);
    const { rows: [r] } = await avecReglesBase(() => ctx.c.query("INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id", [d.nom, d.parentId ?? null]));
    await ctx.journaliser({ type: "catalog", action: "category_create", objetType: "category", objetId: r.id, apres: d });
    return { id: r.id };
  }));

  app.patch("/api/referentiels/categories/:id", proteger(deps, { permission: "catalog.admin" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ nom: z.string().trim().min(2).max(80).optional(), archivee: z.boolean().optional() }).parse(req.body);
    const { rows: [avant] } = await ctx.c.query("SELECT name, archived_at FROM categories WHERE id = $1", [id]);
    if (!avant) throw nonTrouve("Catégorie");
    await avecReglesBase(() => ctx.c.query(
      "UPDATE categories SET name = coalesce($2, name), archived_at = CASE WHEN $3::boolean IS NULL THEN archived_at WHEN $3 THEN coalesce(archived_at, now()) ELSE NULL END WHERE id = $1",
      [id, d.nom ?? null, d.archivee ?? null]));
    await ctx.journaliser({ type: "catalog", action: "category_update", objetType: "category", objetId: id, avant: { nom: avant.name, archivee: !!avant.archived_at }, apres: d });
    return { ok: true };
  }));

  /* ------------------------------------------------------------ Formes et emplacements */
  for (const [chemin, table, objet] of [["formes", "dosage_forms", "dosage_form"], ["emplacements", "storage_locations", "storage_location"]] as const) {
    const emplacement = table === "storage_locations";
    app.get(`/api/referentiels/${chemin}`, proteger(deps, { permission: "catalog.read" }, async (_req, ctx) => {
      const { rows } = await ctx.c.query(`SELECT id, name${emplacement ? ", kind" : ""}, archived_at IS NOT NULL AS archive FROM ${table} ORDER BY archived_at IS NOT NULL, lower(name)`);
      return rows.map((r) => ({ id: r.id, nom: r.name, archive: r.archive, ...(emplacement ? { nature: r.kind, natureLibelle: NATURES_EMPLACEMENT[r.kind] } : {}) }));
    }));
    app.post(`/api/referentiels/${chemin}`, proteger(deps, { permission: "catalog.admin" }, async (req, ctx) => {
      const d = z.object({ nom: z.string().trim().min(2, "Nom trop court.").max(60), nature: z.enum(["shelf", "reserve", "cold", "other"]).optional() }).parse(req.body);
      const { rows: [r] } = await avecReglesBase(() => emplacement
        ? ctx.c.query(`INSERT INTO ${table} (name, kind) VALUES ($1, $2) RETURNING id`, [d.nom, d.nature ?? "shelf"])
        : ctx.c.query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id`, [d.nom]));
      await ctx.journaliser({ type: "catalog", action: `${objet}_create`, objetType: objet, objetId: r.id, apres: d });
      return { id: r.id };
    }));
    app.patch(`/api/referentiels/${chemin}/:id`, proteger(deps, { permission: "catalog.admin" }, async (req, ctx) => {
      const id = idParam(req);
      const d = z.object({ nom: z.string().trim().min(2).max(60).optional(), archive: z.boolean().optional(), nature: z.enum(["shelf", "reserve", "cold", "other"]).optional() }).parse(req.body);
      const { rowCount } = await avecReglesBase(() => ctx.c.query(
        `UPDATE ${table} SET name = coalesce($2, name), archived_at = CASE WHEN $3::boolean IS NULL THEN archived_at WHEN $3 THEN coalesce(archived_at, now()) ELSE NULL END
           ${emplacement ? ", kind = coalesce($4, kind)" : ""} WHERE id = $1`,
        emplacement ? [id, d.nom ?? null, d.archive ?? null, d.nature ?? null] : [id, d.nom ?? null, d.archive ?? null]));
      if (!rowCount) throw nonTrouve("Élément");
      await ctx.journaliser({ type: "catalog", action: `${objet}_update`, objetType: objet, objetId: id, apres: d });
      return { ok: true };
    }));
  }

  /* ------------------------------------------------------------ Paramètres de la pharmacie */
  app.get("/api/parametres-pharmacie", proteger(deps, { permission: null }, async (_req, ctx) => lireParametres(ctx.c, ctx.entrepriseId)));

  app.patch("/api/parametres-pharmacie", proteger(deps, { permission: "company.update" }, async (req, ctx) => {
    const d = SCHEMA_PARAMETRES.parse(req.body);
    if (d.tauxTva && new Set(d.tauxTva.map((t) => t.tauxPdm)).size !== d.tauxTva.length)
      throw new ErreurHttp(400, "taux_double", "Deux taux de TVA ont la même valeur.");
    const avant = await lireParametres(ctx.c, ctx.entrepriseId);
    const apres = { ...avant, ...d };
    await ctx.c.query("UPDATE companies SET settings = jsonb_set(settings, '{pharmacie}', $2::jsonb) WHERE id = $1", [ctx.entrepriseId, JSON.stringify(apres)]);
    await ctx.journaliser({ type: "company", action: "pharmacy_settings_change", objetType: "company", objetId: ctx.entrepriseId, avant, apres });
    return apres;
  }));
}
