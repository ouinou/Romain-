import type { FastifyInstance } from "fastify";
import { UUID, type Client } from "../../db.js";
import { compteMasque } from "../../domaine/comptabilite/visibilite.js";
import { versEntier } from "../../domaine/comptabilite/montants.js";
import { proteger, type Ctx, type Dependances } from "../contexte.js";
import { ErreurHttp } from "../erreurs.js";

interface Filtres { exerciceId: string; exercice: { code: string; debut: string; fin: string; ouvert: boolean }; du: string; au: string; compte?: string; journal?: string; brouillons: boolean }

/** Exercice demandé, sinon celui qui contient la date du jour, sinon le plus récent ; période bornée à l'exercice. */
async function lireFiltres(c: Client, q: Record<string, string | undefined>): Promise<Filtres> {
  const { rows: [f] } = q.exercice && UUID.test(q.exercice)
    ? await c.query("SELECT id, code, start_date::text AS debut, end_date::text AS fin, status FROM fiscal_years WHERE id = $1", [q.exercice])
    : await c.query(`SELECT id, code, start_date::text AS debut, end_date::text AS fin, status FROM fiscal_years
                      ORDER BY (current_date BETWEEN start_date AND end_date) DESC, start_date DESC LIMIT 1`);
  if (!f) throw new ErreurHttp(404, "exercice_absent", "Aucun exercice comptable n'est défini.");
  const date = (v: string | undefined, defaut: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : defaut);
  const du = date(q.du, f.debut) < f.debut ? f.debut : date(q.du, f.debut);
  const au = date(q.au, f.fin) > f.fin ? f.fin : date(q.au, f.fin);
  return {
    exerciceId: f.id, exercice: { code: f.code, debut: f.debut, fin: f.fin, ouvert: f.status === "open" }, du, au,
    compte: q.compte && /^[1-9][0-9]{0,11}$/.test(q.compte) ? q.compte : undefined,
    journal: q.journal && UUID.test(q.journal) ? q.journal : undefined,
    brouillons: q.brouillons === "oui",
  };
}

/** Lignes retenues : exercice, statut, journal, préfixe de compte ; comptes masqués exclus. */
function selectionLignes(f: Filtres, ctx: Ctx) {
  const v: unknown[] = [[...ctx.permissions], f.exerciceId];
  const w = [`e.fiscal_year_id = $2`, `NOT ${compteMasque("a", 1)}`];
  if (!f.brouillons) w.push("e.status = 'validated'");
  if (f.journal) { v.push(f.journal); w.push(`e.journal_id = $${v.length}`); }
  if (f.compte) { v.push(f.compte + "%"); w.push(`a.account_number LIKE $${v.length}`); }
  return { v, where: w.join(" AND ") };
}

async function nbComptesMasques(ctx: Ctx, exerciceId: string) {
  const { rows: [r] } = await ctx.c.query(
    `SELECT count(DISTINCT a.id)::int AS n FROM entry_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.fiscal_year_id = $2 AND ${compteMasque("a", 1)}`, [[...ctx.permissions], exerciceId]);
  return r.n as number;
}

async function calculerBalance(ctx: Ctx, f: Filtres) {
  const { v, where } = selectionLignes(f, ctx);
  v.push(f.du, f.au);
  const { rows } = await ctx.c.query(
    `SELECT a.account_number, a.label, a.account_class,
            coalesce(sum(l.debit) FILTER (WHERE e.entry_date < $${v.length - 1}::date), 0) AS ouv_d,
            coalesce(sum(l.credit) FILTER (WHERE e.entry_date < $${v.length - 1}::date), 0) AS ouv_c,
            coalesce(sum(l.debit) FILTER (WHERE e.entry_date BETWEEN $${v.length - 1}::date AND $${v.length}::date), 0) AS mvt_d,
            coalesce(sum(l.credit) FILTER (WHERE e.entry_date BETWEEN $${v.length - 1}::date AND $${v.length}::date), 0) AS mvt_c
       FROM entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE ${where} AND e.entry_date <= $${v.length}::date
      GROUP BY a.account_number, a.label, a.account_class ORDER BY a.account_number`, v);
  const lignes = rows.map((r) => {
    const ouverture = versEntier(r.ouv_d) - versEntier(r.ouv_c);
    const mvtD = versEntier(r.mvt_d), mvtC = versEntier(r.mvt_c);
    const solde = ouverture + mvtD - mvtC;
    return { compte: r.account_number, libelle: r.label, classe: r.account_class,
      soldeOuverture: ouverture, mouvementDebit: mvtD, mouvementCredit: mvtC,
      soldeDebiteur: solde > 0 ? solde : 0, soldeCrediteur: solde < 0 ? -solde : 0 };
  });
  const somme = (k: keyof (typeof lignes)[number]) => lignes.reduce((s, l) => s + (l[k] as number), 0);
  const totaux = { mouvementDebit: somme("mouvementDebit"), mouvementCredit: somme("mouvementCredit"), soldeDebiteur: somme("soldeDebiteur"), soldeCrediteur: somme("soldeCrediteur") };
  return { lignes, totaux };
}

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function routesEtatsComptables(app: FastifyInstance, deps: Dependances) {
  /* ------------------------------------------------------------ Tableau de bord comptable */
  app.get("/api/comptabilite/tableau-de-bord", proteger(deps, { permission: "accounting.read" }, async (req, ctx) => {
    const f = await lireFiltres(ctx.c, req.query as Record<string, string>);
    const { rows: [r] } = await ctx.c.query(
      `WITH e AS (
         SELECT e.id, e.status,
                (SELECT coalesce(sum(debit), 0) FROM entry_lines WHERE entry_id = e.id) AS d,
                (SELECT coalesce(sum(credit), 0) FROM entry_lines WHERE entry_id = e.id) AS c,
                (SELECT count(*) FROM entry_lines WHERE entry_id = e.id) AS n
           FROM journal_entries e
          WHERE e.fiscal_year_id = $2
            AND NOT EXISTS (SELECT 1 FROM entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND ${compteMasque("a", 1)}))
       SELECT count(*) FILTER (WHERE status = 'validated')::int AS validees,
              count(*) FILTER (WHERE status = 'draft')::int AS brouillons,
              count(*) FILTER (WHERE status = 'draft' AND (d <> c OR d = 0 OR n < 2))::int AS brouillons_desequilibres,
              coalesce(sum(d) FILTER (WHERE status = 'validated'), 0) AS total_d,
              coalesce(sum(c) FILTER (WHERE status = 'validated'), 0) AS total_c
         FROM e`, [[...ctx.permissions], f.exerciceId]);
    const masques = await nbComptesMasques(ctx, f.exerciceId);
    return {
      exercice: { id: f.exerciceId, ...f.exercice },
      validees: r.validees, brouillons: r.brouillons, brouillonsDesequilibres: r.brouillons_desequilibres,
      totalDebit: versEntier(r.total_d), totalCredit: versEntier(r.total_c), comptesMasques: masques,
    };
  }));

  /* ------------------------------------------------------------ Grand livre */
  app.get("/api/comptabilite/grand-livre", proteger(deps, { permission: "accounting.read" }, async (req, ctx) => {
    const f = await lireFiltres(ctx.c, req.query as Record<string, string>);
    return { ...(await grandLivre(ctx, f)), exercice: { id: f.exerciceId, ...f.exercice }, du: f.du, au: f.au, comptesMasques: await nbComptesMasques(ctx, f.exerciceId) };
  }));

  async function grandLivre(ctx: Ctx, f: Filtres) {
    const { v, where } = selectionLignes(f, ctx);
    v.push(f.du, f.au);
    const { rows } = await ctx.c.query(
      `SELECT a.id AS compte_id, a.account_number, a.label AS compte_libelle,
              e.id AS ecriture_id, e.entry_date::text AS date, e.entry_date < $${v.length - 1}::date AS anterieur, e.entry_number, e.status,
              j.code AS journal, e.piece_reference, e.label AS ecriture_libelle, l.label AS ligne_libelle, l.debit, l.credit
         FROM entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id JOIN journals j ON j.id = e.journal_id
        WHERE ${where} AND e.entry_date <= $${v.length}::date
        ORDER BY a.account_number, e.entry_date, e.entry_number NULLS LAST, e.created_at, l.line_no
        LIMIT 50001`, v);
    if (rows.length > 50000) throw new ErreurHttp(413, "trop_de_lignes", "Plus de 50 000 mouvements : restreignez la période ou le compte.");
    const comptes: { id: string; compte: string; libelle: string; soldeOuverture: number; mouvements: unknown[]; totalDebit: number; totalCredit: number; soldeCloture: number }[] = [];
    let courant: (typeof comptes)[number] | undefined;
    for (const r of rows) {
      if (!courant || courant.id !== r.compte_id) {
        courant = { id: r.compte_id, compte: r.account_number, libelle: r.compte_libelle, soldeOuverture: 0, mouvements: [], totalDebit: 0, totalCredit: 0, soldeCloture: 0 };
        comptes.push(courant);
      }
      const d = versEntier(r.debit), c = versEntier(r.credit);
      if (r.anterieur) { courant.soldeOuverture += d - c; courant.soldeCloture = courant.soldeOuverture; continue; }
      courant.totalDebit += d; courant.totalCredit += c;
      courant.soldeCloture = courant.soldeOuverture + courant.totalDebit - courant.totalCredit;
      courant.mouvements.push({ ecritureId: r.ecriture_id, date: r.date, journal: r.journal, numero: r.entry_number, statut: r.status === "validated" ? "validee" : "brouillard",
        piece: r.piece_reference, libelle: r.ligne_libelle || r.ecriture_libelle, debit: d, credit: c, solde: courant.soldeCloture });
    }
    return { comptes, totaux: { debit: comptes.reduce((s, x) => s + x.totalDebit, 0), credit: comptes.reduce((s, x) => s + x.totalCredit, 0) } };
  }

  /* ------------------------------------------------------------ Balance générale */
  app.get("/api/comptabilite/balance", proteger(deps, { permission: "accounting.read" }, async (req, ctx) => {
    const f = await lireFiltres(ctx.c, req.query as Record<string, string>);
    const { lignes, totaux } = await calculerBalance(ctx, f);
    const masques = await nbComptesMasques(ctx, f.exerciceId);
    // Résultat (produits − charges, classes 6, 7 et 8) : réservé aux personnes ayant le droit aux rapports.
    const resultat = ctx.a("reports.read") && masques === 0
      ? -lignes.filter((l) => l.classe >= 6 && l.classe <= 8).reduce((s, l) => s + l.soldeDebiteur - l.soldeCrediteur, 0)
      : null;
    return {
      exercice: { id: f.exerciceId, ...f.exercice }, du: f.du, au: f.au, brouillonsInclus: f.brouillons,
      lignes, totaux, comptesMasques: masques, complete: masques === 0 && !f.compte && !f.journal,
      equilibree: totaux.mouvementDebit === totaux.mouvementCredit && totaux.soldeDebiteur === totaux.soldeCrediteur,
      resultat,
    };
  }));

  /* ------------------------------------------------------------ Exports (permission dédiée, journalisés) */
  app.get("/api/comptabilite/balance/export", proteger(deps, { permission: "accounting.export" }, async (req, ctx) => {
    const f = await lireFiltres(ctx.c, req.query as Record<string, string>);
    const { lignes, totaux } = await calculerBalance(ctx, f);
    const masques = await nbComptesMasques(ctx, f.exerciceId);
    await ctx.journaliser({ type: "accounting", action: "export", details: { etat: "balance", exercice: f.exercice.code, du: f.du, au: f.au, lignes: lignes.length, comptesMasques: masques } });
    const entete = ["Compte", "Intitulé", "Solde d'ouverture", "Mouvements débit", "Mouvements crédit", "Solde débiteur", "Solde créditeur"];
    const corps = lignes.map((l) => [l.compte, l.libelle, l.soldeOuverture, l.mouvementDebit, l.mouvementCredit, l.soldeDebiteur, l.soldeCrediteur].map(csv).join(";"));
    const pied = ["TOTAL", masques ? `Balance partielle : ${masques} compte(s) masqué(s)` : "", "", totaux.mouvementDebit, totaux.mouvementCredit, totaux.soldeDebiteur, totaux.soldeCrediteur].map(csv).join(";");
    ctx.rep.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="balance-${f.exercice.code}-${f.au}.csv"`);
    return "﻿" + [entete.map(csv).join(";"), ...corps, pied].join("\r\n");
  }));

  app.get("/api/comptabilite/grand-livre/export", proteger(deps, { permission: "accounting.export" }, async (req, ctx) => {
    const f = await lireFiltres(ctx.c, req.query as Record<string, string>);
    const gl = await grandLivre(ctx, f);
    await ctx.journaliser({ type: "accounting", action: "export", details: { etat: "grand-livre", exercice: f.exercice.code, du: f.du, au: f.au, comptes: gl.comptes.length } });
    const l: string[] = [["Compte", "Intitulé", "Date", "Journal", "N°", "Pièce", "Libellé", "Débit", "Crédit", "Solde"].map(csv).join(";")];
    for (const c of gl.comptes) {
      l.push([c.compte, c.libelle, f.du, "", "", "", "Solde d'ouverture", "", "", c.soldeOuverture].map(csv).join(";"));
      for (const m of c.mouvements as { date: string; journal: string; numero: number | null; piece: string; libelle: string; debit: number; credit: number; solde: number }[])
        l.push([c.compte, c.libelle, m.date, m.journal, m.numero ?? "brouillard", m.piece, m.libelle, m.debit, m.credit, m.solde].map(csv).join(";"));
    }
    ctx.rep.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="grand-livre-${f.exercice.code}-${f.au}.csv"`);
    return "﻿" + l.join("\r\n");
  }));
}
