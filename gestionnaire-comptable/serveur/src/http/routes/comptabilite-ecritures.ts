import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { avecReglesBase } from "../../domaine/comptabilite/erreurs.js";
import { compteMasque } from "../../domaine/comptabilite/visibilite.js";
import { MONTANT_MAX, versEntier } from "../../domaine/comptabilite/montants.js";
import { pagination, proteger, type Ctx, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";

const montant = z.number().int("Montant entier attendu (FCFA, sans décimales).").min(0).max(MONTANT_MAX);
const schemaLigne = z.object({
  compteId: z.string().regex(UUID, "Compte invalide."),
  libelle: z.string().trim().max(200).optional().nullable(),
  debit: montant.default(0),
  credit: montant.default(0),
}).refine((l) => (l.debit > 0) !== (l.credit > 0), "Chaque ligne porte soit un débit, soit un crédit (strictement positif), jamais les deux.");

const schemaEcriture = z.object({
  journalId: z.string().regex(UUID, "Journal invalide."),
  date: z.string().date("Date invalide (AAAA-MM-JJ)."),
  piece: z.string().trim().min(1, "Référence de pièce obligatoire.").max(60),
  datePiece: z.string().date().optional().nullable(),
  libelle: z.string().trim().min(2, "Libellé obligatoire.").max(200),
  lignes: z.array(schemaLigne).min(1, "Au moins une ligne.").max(500),
});

const idDe = (req: { params: unknown }) => {
  const id = (req.params as { id?: string }).id ?? "";
  if (!UUID.test(id)) throw nonTrouve("Écriture");
  return id;
};

/** Écriture complète, ou null si elle n'existe pas OU si elle touche un compte masqué pour l'utilisateur. */
export async function chargerEcriture(c: Client, id: string, permissions: string[]) {
  const { rows: [e] } = await c.query(
    `SELECT e.*, e.entry_date::text AS date_ecriture, e.piece_date::text AS date_piece,
            j.code AS journal_code, j.label AS journal_label, f.code AS exercice_code, f.status AS exercice_statut,
            ua.full_name AS auteur, uv.full_name AS validateur,
            o.entry_number AS origine_numero, oj.code AS origine_journal,
            x.id AS extourne_id, x.entry_number AS extourne_numero,
            CASE e.source_type
              WHEN 'invoice' THEN (SELECT json_build_object('type', 'facture', 'id', i.id, 'reference', i.number) FROM invoices i WHERE i.id = e.source_id)
              WHEN 'treasury_movement' THEN (SELECT json_build_object('type', 'mouvement', 'id', m.id, 'reference', m.reference) FROM treasury_movements m WHERE m.id = e.source_id)
            END AS origine,
            EXISTS (SELECT 1 FROM entry_lines l JOIN accounts a ON a.id = l.account_id
                     WHERE l.entry_id = e.id AND ${compteMasque("a", 2)}) AS masquee
       FROM journal_entries e
       JOIN journals j ON j.id = e.journal_id
       JOIN fiscal_years f ON f.id = e.fiscal_year_id
       JOIN app_users ua ON ua.id = e.created_by
       LEFT JOIN app_users uv ON uv.id = e.validated_by
       LEFT JOIN journal_entries o ON o.id = e.reversal_of
       LEFT JOIN journals oj ON oj.id = o.journal_id
       LEFT JOIN journal_entries x ON x.reversal_of = e.id
      WHERE e.id = $1`, [id, permissions]);
  if (!e || e.masquee) return null;
  const { rows: lignes } = await c.query(
    `SELECT l.line_no, l.account_id, a.account_number, a.label AS compte_libelle, l.label, l.debit, l.credit
       FROM entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.line_no`, [id]);
  const ls = lignes.map((l) => ({ ordre: l.line_no, compteId: l.account_id, compte: l.account_number, compteLibelle: l.compte_libelle, libelle: l.label, debit: versEntier(l.debit), credit: versEntier(l.credit) }));
  const totalDebit = ls.reduce((s, l) => s + l.debit, 0), totalCredit = ls.reduce((s, l) => s + l.credit, 0);
  return {
    id: e.id, statut: e.status === "validated" ? "validee" : "brouillard", numero: e.entry_number,
    journal: { id: e.journal_id, code: e.journal_code, libelle: e.journal_label },
    exercice: { id: e.fiscal_year_id, code: e.exercice_code, ouvert: e.exercice_statut === "open" },
    date: e.date_ecriture, piece: e.piece_reference, datePiece: e.date_piece, libelle: e.label,
    auteur: { id: e.created_by, nom: e.auteur }, creeLe: e.created_at, modifieLe: e.updated_at,
    validateur: e.validated_by ? { id: e.validated_by, nom: e.validateur } : null, valideeLe: e.validated_at,
    extourneDe: e.reversal_of ? { id: e.reversal_of, numero: e.origine_numero, journal: e.origine_journal, motif: e.reversal_reason } : null,
    extourneePar: e.extourne_id ? { id: e.extourne_id, numero: e.extourne_numero } : null,
    lignes: ls, totalDebit, totalCredit, equilibree: totalDebit === totalCredit && totalDebit > 0 && ls.length >= 2,
    origine: e.origine as { type: "facture" | "mouvement"; id: string; reference: string } | null,
  };
}

/** Résumé utilisé dans le journal d'audit (avant / après). */
const resume = (e: NonNullable<Awaited<ReturnType<typeof chargerEcriture>>>) => ({
  journal: e.journal.code, numero: e.numero, date: e.date, piece: e.piece, libelle: e.libelle, statut: e.statut,
  lignes: e.lignes.map((l) => `${l.compte} D ${l.debit} C ${l.credit}`), totalDebit: e.totalDebit, totalCredit: e.totalCredit,
});

async function exerciceOuvertPour(c: Client, date: string) {
  const { rows: [f] } = await c.query("SELECT id FROM fiscal_years WHERE status = 'open' AND $1::date BETWEEN start_date AND end_date", [date]);
  if (!f) throw new ErreurHttp(409, "exercice_absent", `Aucun exercice ouvert ne contient la date du ${date.split("-").reverse().join("/")}.`);
  return f.id as string;
}

/** Vérifie que les comptes existent, sont imputables, actifs, et visibles pour l'utilisateur. */
async function verifierComptes(ctx: Ctx, ids: string[]) {
  const uniques = [...new Set(ids)];
  const { rows } = await ctx.c.query(
    `SELECT a.id, a.account_number, a.postable, a.active, ${compteMasque("a", 2)} AS masque FROM accounts a WHERE a.id = ANY($1::uuid[])`,
    [uniques, [...ctx.permissions]]);
  if (rows.length !== uniques.length) throw new ErreurHttp(400, "compte_inconnu", "Un des comptes choisis n'existe pas dans le plan comptable.");
  const masque = rows.find((r) => r.masque);
  if (masque) throw new ErreurHttp(403, "compte_protege", `Le compte ${masque.account_number} est protégé : vous n'avez pas la permission d'y imputer.`,
    { type: "security", action: "access_denied", resultat: "denied", details: { compteProtege: masque.account_number } });
  const ko = rows.find((r) => !r.postable || !r.active);
  if (ko) throw new ErreurHttp(400, "compte_non_imputable", `Le compte ${ko.account_number} n'est pas imputable ou est archivé.`);
}

async function verifierJournal(c: Client, id: string) {
  const { rows: [j] } = await c.query("SELECT active FROM journals WHERE id = $1", [id]);
  if (!j) throw new ErreurHttp(400, "journal_inconnu", "Journal inconnu.");
  if (!j.active) throw new ErreurHttp(400, "journal_archive", "Ce journal est archivé.");
}

async function ecrireLignes(c: Client, entryId: string, lignes: z.infer<typeof schemaLigne>[]) {
  await c.query("DELETE FROM entry_lines WHERE entry_id = $1", [entryId]);
  for (const [i, l] of lignes.entries())
    await c.query("INSERT INTO entry_lines (entry_id, line_no, account_id, label, debit, credit) VALUES ($1,$2,$3,$4,$5,$6)",
      [entryId, i + 1, l.compteId, l.libelle || null, l.debit, l.credit]);
}

export function routesEcritures(app: FastifyInstance, deps: Dependances) {
  app.get("/api/comptabilite/ecritures", proteger(deps, { permission: "accounting.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { page, taille, offset } = pagination(q);
    const f: string[] = [`NOT EXISTS (SELECT 1 FROM entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND ${compteMasque("a", 1)})`];
    const v: unknown[] = [[...ctx.permissions]];
    const ajouter = (sql: string, val: unknown) => { v.push(val); f.push(sql.replaceAll("?", `$${v.length}`)); };
    if (q.exercice && UUID.test(q.exercice)) ajouter("e.fiscal_year_id = ?", q.exercice);
    if (q.journal && UUID.test(q.journal)) ajouter("e.journal_id = ?", q.journal);
    if (q.statut === "brouillard") f.push("e.status = 'draft'");
    if (q.statut === "validee") f.push("e.status = 'validated'");
    if (q.du && !Number.isNaN(Date.parse(q.du))) ajouter("e.entry_date >= ?::date", q.du);
    if (q.au && !Number.isNaN(Date.parse(q.au))) ajouter("e.entry_date <= ?::date", q.au);
    if (q.recherche) ajouter("(e.label ILIKE ? OR e.piece_reference ILIKE ?)", `%${q.recherche.trim()}%`);
    if (q.origine === "operations") f.push("e.source_type IS NOT NULL");
    if (q.origine === "saisie") f.push("e.source_type IS NULL");
    const where = "WHERE " + f.join(" AND ");
    const { rows: [{ total }] } = await ctx.c.query(`SELECT count(*)::int AS total FROM journal_entries e ${where}`, v);
    const { rows } = await ctx.c.query(
      `SELECT e.id, e.status, e.entry_number, e.entry_date::text AS date, e.piece_reference, e.label, j.code AS journal, e.reversal_of, e.source_type,
              ua.full_name AS auteur,
              (SELECT coalesce(sum(debit), 0) FROM entry_lines WHERE entry_id = e.id) AS debit,
              (SELECT coalesce(sum(credit), 0) FROM entry_lines WHERE entry_id = e.id) AS credit,
              (SELECT count(*) FROM entry_lines WHERE entry_id = e.id)::int AS nb_lignes,
              EXISTS (SELECT 1 FROM journal_entries x WHERE x.reversal_of = e.id) AS extournee
         FROM journal_entries e JOIN journals j ON j.id = e.journal_id JOIN app_users ua ON ua.id = e.created_by
        ${where} ORDER BY e.entry_date DESC, e.created_at DESC LIMIT ${taille} OFFSET ${offset}`, v);
    return {
      elements: rows.map((e) => {
        const debit = versEntier(e.debit), credit = versEntier(e.credit);
        return { id: e.id, statut: e.status === "validated" ? "validee" : "brouillard", numero: e.entry_number, date: e.date, journal: e.journal,
          piece: e.piece_reference, libelle: e.label, auteur: e.auteur, totalDebit: debit, totalCredit: credit,
          equilibree: debit === credit && debit > 0 && e.nb_lignes >= 2, extourne: !!e.reversal_of, extournee: e.extournee,
          origine: e.source_type === "invoice" ? "facture" : e.source_type === "treasury_movement" ? "tresorerie" : null };
      }),
      total, page, taille,
    };
  }));

  app.get("/api/comptabilite/ecritures/:id", proteger(deps, { permission: "accounting.read" }, async (req, ctx) => {
    const e = await chargerEcriture(ctx.c, idDe(req), [...ctx.permissions]);
    if (!e) throw nonTrouve("Écriture");
    return e;
  }));

  // Brouillard : enregistrable même déséquilibré ; l'équilibre est exigé à la validation.
  app.post("/api/comptabilite/ecritures", proteger(deps, { permission: "accounting.create" }, async (req, ctx) => {
    const d = schemaEcriture.parse(req.body);
    await verifierJournal(ctx.c, d.journalId);
    await verifierComptes(ctx, d.lignes.map((l) => l.compteId));
    const exercice = await exerciceOuvertPour(ctx.c, d.date);
    const { rows: [e] } = await avecReglesBase(() => ctx.c.query(
      `INSERT INTO journal_entries (fiscal_year_id, journal_id, entry_date, piece_reference, piece_date, label, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [exercice, d.journalId, d.date, d.piece, d.datePiece ?? null, d.libelle, ctx.utilisateur.id]));
    await avecReglesBase(() => ecrireLignes(ctx.c, e.id, d.lignes));
    const cree = (await chargerEcriture(ctx.c, e.id, [...ctx.permissions]))!;
    await ctx.journaliser({ type: "accounting", action: "entry_create", objetType: "entry", objetId: e.id, apres: resume(cree) });
    return cree;
  }));

  app.put("/api/comptabilite/ecritures/:id", proteger(deps, { permission: "accounting.update" }, async (req, ctx) => {
    const id = idDe(req);
    const d = schemaEcriture.parse(req.body);
    await ctx.c.query("SELECT 1 FROM journal_entries WHERE id = $1 FOR UPDATE", [id]);
    const avant = await chargerEcriture(ctx.c, id, [...ctx.permissions]);
    if (!avant) throw nonTrouve("Écriture");
    if (avant.statut !== "brouillard") throw new ErreurHttp(409, "ecriture_validee", "Une écriture validée ne se modifie pas. Utilisez une extourne.");
    if (avant.origine) throw new ErreurHttp(409, "ecriture_generee", `Écriture générée par ${avant.origine.type === "facture" ? "la facture" : "le mouvement"} ${avant.origine.reference} : corrigez l'opération d'origine.`);
    await verifierJournal(ctx.c, d.journalId);
    await verifierComptes(ctx, d.lignes.map((l) => l.compteId));
    const exercice = await exerciceOuvertPour(ctx.c, d.date);
    await avecReglesBase(() => ctx.c.query(
      `UPDATE journal_entries SET fiscal_year_id = $2, journal_id = $3, entry_date = $4, piece_reference = $5, piece_date = $6, label = $7 WHERE id = $1`,
      [id, exercice, d.journalId, d.date, d.piece, d.datePiece ?? null, d.libelle]));
    await avecReglesBase(() => ecrireLignes(ctx.c, id, d.lignes));
    const apres = (await chargerEcriture(ctx.c, id, [...ctx.permissions]))!;
    await ctx.journaliser({ type: "accounting", action: "entry_update", objetType: "entry", objetId: id, avant: resume(avant), apres: resume(apres) });
    return apres;
  }));

  app.delete("/api/comptabilite/ecritures/:id", proteger(deps, { permission: "accounting.update" }, async (req, ctx) => {
    const id = idDe(req);
    await ctx.c.query("SELECT 1 FROM journal_entries WHERE id = $1 FOR UPDATE", [id]);
    const avant = await chargerEcriture(ctx.c, id, [...ctx.permissions]);
    if (!avant) throw nonTrouve("Écriture");
    if (avant.statut !== "brouillard") throw new ErreurHttp(409, "ecriture_validee", "Une écriture validée ne se supprime pas. Utilisez une extourne.");
    if (avant.origine) throw new ErreurHttp(409, "ecriture_generee", `Écriture générée par ${avant.origine.type === "facture" ? "la facture" : "le mouvement"} ${avant.origine.reference} : elle ne se supprime pas.`);
    await avecReglesBase(() => ctx.c.query("DELETE FROM journal_entries WHERE id = $1", [id]));
    await ctx.journaliser({ type: "accounting", action: "entry_delete", objetType: "entry", objetId: id, avant: resume(avant) });
    return { ok: true };
  }));

  // Validation : équilibre, numérotation et séparation des tâches sont garantis par la base.
  app.post("/api/comptabilite/ecritures/:id/validation", proteger(deps, { permission: "accounting.approve", sensible: true }, async (req, ctx) => {
    const id = idDe(req);
    await ctx.c.query("SELECT 1 FROM journal_entries WHERE id = $1 FOR UPDATE", [id]);
    const avant = await chargerEcriture(ctx.c, id, [...ctx.permissions]);
    if (!avant) throw nonTrouve("Écriture");
    if (avant.statut !== "brouillard") throw new ErreurHttp(409, "deja_validee", "Cette écriture est déjà validée.");
    try {
      await avecReglesBase(() => ctx.c.query("UPDATE journal_entries SET status = 'validated', validated_by = $2 WHERE id = $1", [id, ctx.utilisateur.id]));
    } catch (e) {
      if (e instanceof ErreurHttp)   // refus tracé à part (la transaction est annulée)
        throw new ErreurHttp(e.statut, e.code, e.message, { type: "accounting", action: "entry_validate", resultat: "failure", objetType: "entry", objetId: id, details: { raison: e.message } });
      throw e;
    }
    const apres = (await chargerEcriture(ctx.c, id, [...ctx.permissions]))!;
    await ctx.journaliser({ type: "accounting", action: "entry_validate", objetType: "entry", objetId: id, avant: { statut: "brouillard" }, apres: resume(apres) });
    return apres;
  }));

  // Validation par lots (écritures générées par les ventes et la trésorerie, ou brouillards saisis).
  // Chaque écriture est validée dans un point de sauvegarde : un refus n'empêche pas les autres.
  app.post("/api/comptabilite/ecritures/validation-groupee", proteger(deps, { permission: "accounting.approve", sensible: true }, async (req, ctx) => {
    const d = z.object({ ids: z.array(z.string().regex(UUID)).min(1).max(200) }).parse(req.body);
    const resultats: { id: string; ok: boolean; numero?: number; erreur?: string }[] = [];
    for (const id of new Set(d.ids)) {
      await ctx.c.query("SAVEPOINT validation");
      try {
        const e = await chargerEcriture(ctx.c, id, [...ctx.permissions]);
        if (!e) throw new ErreurHttp(404, "introuvable", "Écriture introuvable.");
        if (e.statut !== "brouillard") throw new ErreurHttp(409, "deja_validee", "Déjà validée.");
        await avecReglesBase(() => ctx.c.query("UPDATE journal_entries SET status = 'validated', validated_by = $2 WHERE id = $1", [id, ctx.utilisateur.id]));
        const { rows: [v] } = await ctx.c.query("SELECT entry_number FROM journal_entries WHERE id = $1", [id]);
        await ctx.journaliser({ type: "accounting", action: "entry_validate", objetType: "entry", objetId: id, avant: { statut: "brouillard" }, apres: resume({ ...e, statut: "validee", numero: v.entry_number }), details: { lot: true } });
        await ctx.c.query("RELEASE SAVEPOINT validation");
        resultats.push({ id, ok: true, numero: v.entry_number });
      } catch (err) {
        await ctx.c.query("ROLLBACK TO SAVEPOINT validation");
        resultats.push({ id, ok: false, erreur: err instanceof ErreurHttp ? err.message : "Erreur inattendue." });
      }
    }
    return { validees: resultats.filter((r) => r.ok).length, refusees: resultats.filter((r) => !r.ok).length, resultats };
  }));

  // Extourne : écriture inverse, validée, liée à l'originale, avec motif. L'originale reste intacte.
  app.post("/api/comptabilite/ecritures/:id/extourne", proteger(deps, { permission: "accounting.cancel", sensible: true }, async (req, ctx) => {
    const id = idDe(req);
    const d = z.object({ date: z.string().date().optional(), motif: z.string().trim().min(3, "Motif obligatoire (3 caractères minimum).").max(500) }).parse(req.body);
    await ctx.c.query("SELECT 1 FROM journal_entries WHERE id = $1 FOR UPDATE", [id]);
    const o = await chargerEcriture(ctx.c, id, [...ctx.permissions]);
    if (!o) throw nonTrouve("Écriture");
    if (o.statut !== "validee") throw new ErreurHttp(409, "brouillard", "Un brouillard se modifie ou se supprime ; seule une écriture validée s'extourne.");
    if (o.extourneDe) throw new ErreurHttp(409, "extourne_d_extourne", "Une extourne ne s'extourne pas. Saisissez une nouvelle écriture correcte.");
    if (o.extourneePar) throw new ErreurHttp(409, "deja_extournee", `Cette écriture a déjà été extournée (écriture n° ${o.extourneePar.numero}).`);
    const date = d.date ?? new Date().toISOString().slice(0, 10);
    const exercice = await exerciceOuvertPour(ctx.c, date);
    const { rows: [x] } = await avecReglesBase(() => ctx.c.query(
      `INSERT INTO journal_entries (fiscal_year_id, journal_id, entry_date, piece_reference, piece_date, label, created_by, reversal_of, reversal_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [exercice, o.journal.id, date, o.piece, o.datePiece, `Extourne ${o.journal.code} n° ${o.numero} : ${o.libelle}`.slice(0, 200), ctx.utilisateur.id, id, d.motif]));
    await avecReglesBase(() => ecrireLignes(ctx.c, x.id, o.lignes.map((l) => ({ compteId: l.compteId, libelle: l.libelle, debit: l.credit, credit: l.debit }))));
    await avecReglesBase(() => ctx.c.query("UPDATE journal_entries SET status = 'validated', validated_by = $2 WHERE id = $1", [x.id, ctx.utilisateur.id]));
    const ext = (await chargerEcriture(ctx.c, x.id, [...ctx.permissions]))!;
    await ctx.journaliser({ type: "accounting", action: "entry_reverse", objetType: "entry", objetId: id, motif: d.motif,
      avant: resume(o), apres: resume(ext), details: { extourneId: x.id } });
    return ext;
  }));
}
