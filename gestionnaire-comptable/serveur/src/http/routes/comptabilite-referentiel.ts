import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID } from "../../db.js";
import { avecReglesBase } from "../../domaine/comptabilite/erreurs.js";
import { compteMasque } from "../../domaine/comptabilite/visibilite.js";
import { exigerConfirmation, proteger, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";

const motif = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(500);
const idDe = (req: { params: unknown }, quoi: string) => {
  const id = (req.params as { id?: string }).id ?? "";
  if (!UUID.test(id)) throw nonTrouve(quoi);
  return id;
};

const TYPES_JOURNAL = ["purchases", "sales", "bank", "cash", "general", "opening"] as const;

/** Plan comptable, journaux, exercices, paramètres et comptes protégés. Préfixe : /api/comptabilite */
export function routesReferentielComptable(app: FastifyInstance, deps: Dependances) {
  /* ------------------------------------------------------------ Plan de comptes */

  app.get("/api/comptabilite/comptes", proteger(deps, { permission: "accounting.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const f: string[] = [], v: unknown[] = [[...ctx.permissions]];
    if (q.recherche) { v.push(`%${q.recherche.trim()}%`); f.push(`(a.account_number LIKE $${v.length} OR a.label ILIKE $${v.length})`); }
    if (q.classe && /^[1-9]$/.test(q.classe)) { v.push(Number(q.classe)); f.push(`a.account_class = $${v.length}`); }
    if (q.imputables === "oui") f.push("a.postable AND a.active");
    if (q.actifs === "oui") f.push("a.active");
    const { rows } = await ctx.c.query(
      `SELECT a.id, a.account_number, a.label, a.account_class, a.postable, a.active, a.source,
              ${compteMasque("a", 1)} AS masque,
              EXISTS (SELECT 1 FROM entry_lines l WHERE l.account_id = a.id) AS utilise,
              r.to_verify IS TRUE AS a_verifier
         FROM accounts a LEFT JOIN account_reference r ON r.account_number = a.account_number AND a.source = 'reference'
        ${f.length ? "WHERE " + f.join(" AND ") : ""}
        ORDER BY a.account_number`, v);
    return rows.map((a) => ({
      id: a.id, numero: a.account_number, libelle: a.label, classe: a.account_class, imputable: a.postable, actif: a.active,
      source: a.source, protege: a.masque, utilise: a.utilise, aVerifier: a.a_verifier,
    }));
  }));

  app.post("/api/comptabilite/comptes", proteger(deps, { permission: "accounting.admin" }, async (req, ctx) => {
    const d = z.object({
      numero: z.string().trim().regex(/^[1-9][0-9]{2,11}$/, "Numéro : 3 à 12 chiffres, commençant par la classe (1 à 8)."),
      libelle: z.string().trim().min(2).max(200),
    }).parse(req.body);
    if (d.numero.startsWith("9")) throw new ErreurHttp(400, "classe_9", "La classe 9 (hors bilan, analytique) n'est pas tenue dans la comptabilité générale.");
    // Le compte doit se rattacher à un compte existant dont le numéro est un préfixe (au minimum la classe).
    const { rows: [parent] } = await ctx.c.query(
      `SELECT account_number, label FROM accounts WHERE $1 LIKE account_number || '%' AND account_number <> $1
        ORDER BY length(account_number) DESC LIMIT 1`, [d.numero]);
    if (!parent) throw new ErreurHttp(400, "sans_parent", "Aucun compte de regroupement ne correspond à ce numéro.");
    const { rows: [a] } = await avecReglesBase(() => ctx.c.query(
      "INSERT INTO accounts (account_number, label, postable, source) VALUES ($1, $2, true, 'company') RETURNING id", [d.numero, d.libelle]));
    await ctx.journaliser({ type: "accounting", action: "account_create", objetType: "account", objetId: a.id,
      apres: { numero: d.numero, libelle: d.libelle }, details: { rattacheA: parent.account_number } });
    return { id: a.id, numero: d.numero, libelle: d.libelle, parent: { numero: parent.account_number, libelle: parent.label } };
  }));

  app.patch("/api/comptabilite/comptes/:id", proteger(deps, { permission: "accounting.admin" }, async (req, ctx) => {
    const id = idDe(req, "Compte");
    const d = z.object({ libelle: z.string().trim().min(2).max(200).optional(), actif: z.boolean().optional() }).parse(req.body);
    const { rows: [avant] } = await ctx.c.query("SELECT account_number, label, active FROM accounts WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) throw nonTrouve("Compte");
    const { rows: [apres] } = await ctx.c.query(
      "UPDATE accounts SET label = coalesce($2, label), active = coalesce($3, active) WHERE id = $1 RETURNING account_number, label, active",
      [id, d.libelle ?? null, d.actif ?? null]);
    await ctx.journaliser({ type: "accounting", action: "account_update", objetType: "account", objetId: id,
      avant: { libelle: avant.label, actif: avant.active }, apres: { libelle: apres.label, actif: apres.active }, details: { numero: avant.account_number } });
    return { id, numero: apres.account_number, libelle: apres.label, actif: apres.active };
  }));

  // Import d'un plan de comptes (CSV « numero;libelle »), par exemple le plan officiel complet.
  // N'ajoute que les comptes absents ; ne modifie ni ne supprime les comptes existants.
  app.post("/api/comptabilite/comptes/import", proteger(deps, { permission: "accounting.admin", sensible: true }, async (req, ctx) => {
    const d = z.object({ contenu: z.string().max(2_000_000) }).parse(req.body);
    const lignes = d.contenu.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const erreurs: string[] = [];
    let ajoutes = 0, existants = 0;
    for (const [i, l] of lignes.entries()) {
      const [numero, ...reste] = l.split(";");
      const n = (numero ?? "").replace(/"/g, "").trim(), lib = reste.join(";").replace(/^"|"$/g, "").trim();
      if (i === 0 && !/^[1-9]/.test(n)) continue;   // ligne d'en-tête
      if (!/^[1-8][0-9]{0,11}$/.test(n) || lib.length < 2 || lib.length > 200) { erreurs.push(`ligne ${i + 1} : « ${l.slice(0, 60)} » ignorée`); continue; }
      const r = await ctx.c.query(
        "INSERT INTO accounts (account_number, label, postable, source) VALUES ($1, $2, $3, 'import') ON CONFLICT (company_id, account_number) DO NOTHING",
        [n, lib, n.length >= 3]);
      if (r.rowCount) ajoutes++; else existants++;
    }
    await ctx.journaliser({ type: "accounting", action: "accounts_import", details: { ajoutes, existants, erreurs: erreurs.length } });
    return { ajoutes, existants, erreurs: erreurs.slice(0, 50) };
  }));

  /* ------------------------------------------------------------ Journaux */

  app.get("/api/comptabilite/journaux", proteger(deps, { permission: "accounting.read" }, async (_req, ctx) => {
    const { rows } = await ctx.c.query(
      `SELECT j.id, j.code, j.label, j.journal_type, j.active,
              count(e.id) FILTER (WHERE e.status = 'validated')::int AS validees,
              count(e.id) FILTER (WHERE e.status = 'draft')::int AS brouillons
         FROM journals j LEFT JOIN journal_entries e ON e.journal_id = j.id
        GROUP BY j.id ORDER BY j.code`);
    return rows.map((j) => ({ id: j.id, code: j.code, libelle: j.label, type: j.journal_type, actif: j.active, validees: j.validees, brouillons: j.brouillons }));
  }));

  app.post("/api/comptabilite/journaux", proteger(deps, { permission: "accounting.admin" }, async (req, ctx) => {
    const d = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/), libelle: z.string().trim().min(2).max(80), type: z.enum(TYPES_JOURNAL) }).parse(req.body);
    const { rows: [j] } = await avecReglesBase(() => ctx.c.query(
      "INSERT INTO journals (code, label, journal_type) VALUES ($1,$2,$3) RETURNING id", [d.code, d.libelle, d.type]));
    await ctx.journaliser({ type: "accounting", action: "journal_create", objetType: "journal", objetId: j.id, apres: d });
    return { id: j.id, ...d };
  }));

  app.patch("/api/comptabilite/journaux/:id", proteger(deps, { permission: "accounting.admin" }, async (req, ctx) => {
    const id = idDe(req, "Journal");
    const d = z.object({ libelle: z.string().trim().min(2).max(80).optional(), actif: z.boolean().optional() }).parse(req.body);
    const { rows: [avant] } = await ctx.c.query("SELECT code, label, active FROM journals WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) throw nonTrouve("Journal");
    const { rows: [apres] } = await ctx.c.query("UPDATE journals SET label = coalesce($2, label), active = coalesce($3, active) WHERE id = $1 RETURNING label, active", [id, d.libelle ?? null, d.actif ?? null]);
    await ctx.journaliser({ type: "accounting", action: "journal_update", objetType: "journal", objetId: id,
      avant: { libelle: avant.label, actif: avant.active }, apres: { libelle: apres.label, actif: apres.active }, details: { code: avant.code } });
    return { id, code: avant.code, libelle: apres.label, actif: apres.active };
  }));

  /* ------------------------------------------------------------ Exercices */

  app.get("/api/comptabilite/exercices", proteger(deps, { permission: "accounting.read" }, async (_req, ctx) => {
    const { rows } = await ctx.c.query(
      `SELECT f.id, f.code, f.start_date::text AS debut, f.end_date::text AS fin, f.status, f.closed_at,
              count(e.id) FILTER (WHERE e.status = 'draft')::int AS brouillons, count(e.id) FILTER (WHERE e.status = 'validated')::int AS validees
         FROM fiscal_years f LEFT JOIN journal_entries e ON e.fiscal_year_id = f.id GROUP BY f.id ORDER BY f.start_date DESC`);
    return rows.map((f) => ({ id: f.id, code: f.code, debut: f.debut, fin: f.fin, statut: f.status === "open" ? "ouvert" : "cloture", clotureLe: f.closed_at, brouillons: f.brouillons, validees: f.validees }));
  }));

  app.post("/api/comptabilite/exercices", proteger(deps, { permission: "accounting.admin" }, async (req, ctx) => {
    const d = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9-]{2,12}$/), debut: z.string().date(), fin: z.string().date() }).parse(req.body);
    if (d.fin <= d.debut) throw new ErreurHttp(400, "dates", "La date de fin doit suivre la date de début.");
    const { rows: [f] } = await avecReglesBase(() => ctx.c.query(
      "INSERT INTO fiscal_years (code, start_date, end_date) VALUES ($1,$2,$3) RETURNING id", [d.code, d.debut, d.fin]));
    await ctx.journaliser({ type: "accounting", action: "fiscal_year_create", objetType: "fiscal_year", objetId: f.id, apres: d });
    return { id: f.id, ...d, statut: "ouvert" };
  }));

  // Clôture : définitive. Plus aucune écriture sur l'exercice, pas de réouverture.
  app.post("/api/comptabilite/exercices/:id/cloture", proteger(deps, { permission: "accounting.admin", sensible: true }, async (req, ctx) => {
    const id = idDe(req, "Exercice");
    const d = z.object({ motif }).parse(req.body);
    const { rows: [f] } = await ctx.c.query("SELECT code, status FROM fiscal_years WHERE id = $1 FOR UPDATE", [id]);
    if (!f) throw nonTrouve("Exercice");
    if (f.status === "closed") throw new ErreurHttp(409, "deja_cloture", "Cet exercice est déjà clôturé.");
    await avecReglesBase(() => ctx.c.query("UPDATE fiscal_years SET status = 'closed', closed_by = $2 WHERE id = $1", [id, ctx.utilisateur.id]));
    await ctx.journaliser({ type: "accounting", action: "fiscal_year_close", objetType: "fiscal_year", objetId: id, motif: d.motif, details: { code: f.code } });
    return { ok: true };
  }));

  /* ------------------------------------------------------------ Paramètres et comptes protégés */

  app.get("/api/comptabilite/parametres", proteger(deps, { permission: "accounting.read" }, async (_req, ctx) => {
    const { rows: [e] } = await ctx.c.query("SELECT settings, currency_code, currency_decimals FROM companies WHERE id = $1", [ctx.entrepriseId]);
    const { rows: groupes } = await ctx.c.query("SELECT id, prefix, label, required_permission FROM protected_account_groups ORDER BY prefix, required_permission");
    return {
      separationSaisieValidation: e.settings?.separationSaisieValidation ?? true,
      devise: { code: e.currency_code, decimales: e.currency_decimals },
      comptesProteges: groupes.map((g) => ({ id: g.id, prefixe: g.prefix, libelle: g.label, permission: g.required_permission, accessible: ctx.a(g.required_permission) })),
    };
  }));

  app.patch("/api/comptabilite/parametres", proteger(deps, { permission: "accounting.admin", sensible: true }, async (req, ctx) => {
    const d = z.object({ separationSaisieValidation: z.boolean() }).parse(req.body);
    const { rows: [avant] } = await ctx.c.query("SELECT settings FROM companies WHERE id = $1 FOR UPDATE", [ctx.entrepriseId]);
    await ctx.c.query("UPDATE companies SET settings = settings || $2::jsonb WHERE id = $1", [ctx.entrepriseId, JSON.stringify(d)]);
    await ctx.journaliser({ type: "security", action: "accounting_settings_change", objetType: "company", objetId: ctx.entrepriseId,
      avant: { separationSaisieValidation: avant.settings?.separationSaisieValidation ?? true }, apres: d });
    return d;
  }));

  app.put("/api/comptabilite/comptes-proteges", proteger(deps, { permission: "accounting.admin", sensible: true }, async (req, ctx) => {
    const d = z.object({
      groupes: z.array(z.object({
        prefixe: z.string().trim().regex(/^[1-9][0-9]{0,7}$/), libelle: z.string().trim().min(2).max(120),
        permission: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
      })).max(100),
      motif,
    }).parse(req.body);
    const { rows: avant } = await ctx.c.query("SELECT prefix, label, required_permission FROM protected_account_groups ORDER BY prefix");
    await ctx.c.query("DELETE FROM protected_account_groups");
    for (const g of d.groupes)
      await avecReglesBase(() => ctx.c.query("INSERT INTO protected_account_groups (prefix, label, required_permission) VALUES ($1,$2,$3)", [g.prefixe, g.libelle, g.permission]));
    await ctx.journaliser({ type: "security", action: "protected_accounts_change", motif: d.motif,
      avant: avant.map((g) => `${g.prefix} → ${g.required_permission}`), apres: d.groupes.map((g) => `${g.prefixe} → ${g.permission}`) });
    return { ok: true };
  }));
}
