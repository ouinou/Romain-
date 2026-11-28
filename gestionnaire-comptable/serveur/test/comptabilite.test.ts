import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Agent, entrepriseActive, journal, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/**
 * Comptabilité SYSCOHADA : plan, journaux, écritures, validation, extourne, exercices,
 * comptes protégés, grand livre, balance, isolation et permissions.
 * Jeu d'écritures calculé à la main (montants en FCFA) :
 *   VT : 571 D 500 000 / 701 C 500 000      (vente au comptant)
 *   BQ : 521 D 500 000 / 101 C 500 000      (apport en capital)
 *   AC : 605 D 150 000 / 401 C 150 000      (achat de fournitures à crédit)
 *   CA : 605 D 100 000 / 571 C 100 000      (petite dépense de caisse)
 * Soldes attendus : 521 D 500 000, 571 D 400 000, 605 D 250 000 ; 101 C 500 000, 401 C 150 000, 701 C 500 000.
 * Total mouvements 1 250 000 = 1 250 000 ; total soldes 1 150 000 = 1 150 000 ; résultat 701 − 605 = 250 000.
 */
const AN = new Date().getFullYear();
const J = (mmjj: string) => `${AN}-${mmjj}`;

let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
let daf: Agent, compta: Agent, auditeur: Agent, caissier: Agent;
const comptes: Record<string, string> = {};
const journaux: Record<string, string> = {};

async function idsComptes(agent: Agent) {
  const r = await agent.get("/api/comptabilite/comptes");
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  for (const c of r.corps) comptes[c.numero] = c.id;
  const j = await agent.get("/api/comptabilite/journaux");
  for (const x of j.corps) journaux[x.code] = x.id;
}

const ecriture = (journal: string, date: string, piece: string, libelle: string, lignes: [string, number, number][]) => ({
  journalId: journaux[journal], date: J(date), piece, libelle,
  lignes: lignes.map(([compte, debit, credit]) => ({ compteId: comptes[compte], debit, credit })),
});

/** Saisie par le comptable, validation par le DAF (séparation des tâches). */
async function saisirEtValider(corps: ReturnType<typeof ecriture>, auteur = compta, validateur = daf) {
  const c = await auteur.post("/api/comptabilite/ecritures", corps);
  assert.equal(c.statut, 200, JSON.stringify(c.corps));
  const v = await validateur.post(`/api/comptabilite/ecritures/${c.corps.id}/validation`);
  assert.equal(v.statut, 200, JSON.stringify(v.corps));
  return v.corps;
}

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "COMPTA-01", { mfa: false });
  daf = (await utilisateurAvecRole(env, e, "finance_director", "daf@compta-01.cm")).agent;
  compta = (await utilisateurAvecRole(env, e, "accountant", "compta@compta-01.cm")).agent;
  auditeur = (await utilisateurAvecRole(env, e, "auditor", "audit@compta-01.cm")).agent;
  caissier = (await utilisateurAvecRole(env, e, "cashier", "caisse@compta-01.cm")).agent;
  await idsComptes(daf);
});
after(async () => { await env?.fermer(); });

describe("Initialisation", () => {
  test("Plan de référence, journaux, exercice de l'année et comptes protégés créés avec l'entreprise", async () => {
    const plan = (await daf.get("/api/comptabilite/comptes")).corps;
    assert.ok(plan.length >= 130);
    assert.ok(plan.every((c: { aVerifier: boolean }) => c.aVerifier), "toute la liste de référence est marquée « à vérifier »");
    assert.equal(plan.find((c: { numero: string }) => c.numero === "6").imputable, false, "une classe n'est pas imputable");
    assert.equal(plan.find((c: { numero: string }) => c.numero === "60").imputable, false, "un compte principal n'est pas imputable");
    assert.equal(plan.find((c: { numero: string }) => c.numero === "601").imputable, true);
    assert.deepEqual(Object.keys(journaux).sort(), ["AC", "BQ", "CA", "OD", "VT"]);
    const ex = (await daf.get("/api/comptabilite/exercices")).corps;
    assert.equal(ex.length, 1);
    assert.deepEqual([ex[0].debut, ex[0].fin, ex[0].statut], [`${AN}-01-01`, `${AN}-12-31`, "ouvert"]);
    const p = (await daf.get("/api/comptabilite/parametres")).corps;
    assert.equal(p.separationSaisieValidation, true);
    assert.deepEqual(p.comptesProteges.map((g: { prefixe: string }) => g.prefixe).sort(), ["13", "42", "52", "56", "66"]);
    assert.deepEqual(p.devise, { code: "XAF", decimales: 0 });
  });
});

describe("Saisie et validation", () => {
  test("Un brouillard déséquilibré s'enregistre, mais ne se valide pas ; la base refuse, l'échec est tracé", async () => {
    const b = await compta.post("/api/comptabilite/ecritures", ecriture("AC", "02-10", "FAC-001", "Achat de fournitures", [["605", 150000, 0], ["401", 0, 140000]]));
    assert.equal(b.statut, 200);
    assert.equal(b.corps.statut, "brouillard");
    assert.equal(b.corps.equilibree, false);
    assert.equal((await compta.post(`/api/comptabilite/ecritures/${b.corps.id}/validation`)).statut, 403, "le comptable n'a pas le droit de valider");
    const v = await daf.post(`/api/comptabilite/ecritures/${b.corps.id}/validation`);
    assert.equal(v.statut, 409);
    assert.match(v.corps.erreur.message, /déséquilibrée \(débit 150000 ≠ crédit 140000\)/);
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.some((x) => x.action === "entry_validate" && x.outcome === "failure"));
    // Correction du brouillard puis validation.
    const m = await compta.put(`/api/comptabilite/ecritures/${b.corps.id}`, ecriture("AC", "02-10", "FAC-001", "Achat de fournitures", [["605", 150000, 0], ["401", 0, 150000]]));
    assert.equal(m.corps.equilibree, true);
    const ok = await daf.post(`/api/comptabilite/ecritures/${b.corps.id}/validation`);
    assert.equal(ok.statut, 200);
    assert.equal(ok.corps.statut, "validee");
    assert.equal(ok.corps.numero, 1);
    assert.equal(ok.corps.validateur.nom, "Personne Test finance_director");
  });

  test("Contrôles de saisie : une ligne porte soit un débit, soit un crédit, en entier positif", async () => {
    const base = (l: unknown[]) => ({ ...ecriture("OD", "02-11", "OD-1", "Essai", []), lignes: l });
    for (const lignes of [
      [{ compteId: comptes["605"], debit: 100, credit: 100 }],
      [{ compteId: comptes["605"], debit: 0, credit: 0 }],
      [{ compteId: comptes["605"], debit: 10.5, credit: 0 }],
      [{ compteId: comptes["605"], debit: -100, credit: 0 }],
    ]) assert.equal((await compta.post("/api/comptabilite/ecritures", base(lignes))).statut, 400, JSON.stringify(lignes));
    assert.equal((await compta.post("/api/comptabilite/ecritures", { ...ecriture("OD", "02-11", "", "Essai", [["605", 1, 0]]) })).statut, 400, "pièce obligatoire");
    assert.equal((await compta.post("/api/comptabilite/ecritures", ecriture("OD", "02-11", "OD-1", "Essai", [["60", 1, 0]]))).corps.erreur.code, "compte_non_imputable");
    const horsExercice = await compta.post("/api/comptabilite/ecritures", { ...ecriture("OD", "01-01", "OD-1", "Essai", [["605", 1, 0]]), date: `${AN + 5}-01-01` });
    assert.equal(horsExercice.corps.erreur.code, "exercice_absent");
  });

  test("Séparation des tâches : l'auteur ne valide pas sa propre écriture, sauf si l'entreprise la désactive", async () => {
    const c = await daf.post("/api/comptabilite/ecritures", ecriture("OD", "02-12", "OD-2", "Régularisation", [["605", 1000, 0], ["401", 0, 1000]]));
    const v = await daf.post(`/api/comptabilite/ecritures/${c.corps.id}/validation`);
    assert.equal(v.statut, 409);
    assert.match(v.corps.erreur.message, /Séparation des tâches/);
    assert.equal((await daf.req("PATCH", "/api/comptabilite/parametres", { separationSaisieValidation: false })).statut, 200);
    assert.equal((await daf.post(`/api/comptabilite/ecritures/${c.corps.id}/validation`)).statut, 200);
    await daf.req("PATCH", "/api/comptabilite/parametres", { separationSaisieValidation: true });
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.some((x) => x.action === "accounting_settings_change"));
    // Remise à zéro comptable de cette écriture de test par extourne.
    assert.equal((await compta.post(`/api/comptabilite/ecritures/${c.corps.id}/extourne`, { date: J("02-12"), motif: "Écriture de test" })).statut, 200);
  });

  test("Numérotation continue par journal, même avec des validations simultanées", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++)
      ids.push((await compta.post("/api/comptabilite/ecritures", ecriture("VT", "03-01", `VT-${i}`, `Vente ${i}`, [["411", 1000 + i, 0], ["701", 0, 1000 + i]]))).corps.id);
    const r = await Promise.all(ids.map((id) => daf.post(`/api/comptabilite/ecritures/${id}/validation`)));
    assert.ok(r.every((x) => x.statut === 200), JSON.stringify(r.map((x) => x.corps)));
    assert.deepEqual(r.map((x) => x.corps.numero).sort((a: number, b: number) => a - b), [1, 2, 3, 4, 5, 6]);
    // Annulation comptable de ces ventes de test.
    for (const id of ids) assert.equal((await compta.post(`/api/comptabilite/ecritures/${id}/extourne`, { date: J("03-01"), motif: "Ventes de test" })).statut, 200);
  });
});

describe("Écritures validées : intangibles", () => {
  let validee: { id: string; numero: number };
  before(async () => {
    validee = await saisirEtValider(ecriture("CA", "04-01", "CA-001", "Petite dépense de caisse", [["605", 100000, 0], ["571", 0, 100000]]));
  });

  test("Ni modification ni suppression par l'API", async () => {
    assert.equal((await compta.put(`/api/comptabilite/ecritures/${validee.id}`, ecriture("CA", "04-01", "CA-001", "Modification", [["605", 1, 0], ["571", 0, 1]]))).corps.erreur.code, "ecriture_validee");
    assert.equal((await compta.del(`/api/comptabilite/ecritures/${validee.id}`)).corps.erreur.code, "ecriture_validee");
  });

  test("Ni modification ni suppression par SQL direct, même pour le propriétaire des tables", async () => {
    const c = await env.proprio.connect();
    try {
      for (const sql of [
        "UPDATE journal_entries SET label = 'falsifié' WHERE id = $1",
        "DELETE FROM journal_entries WHERE id = $1",
        "DELETE FROM entry_lines WHERE entry_id = $1",
        "UPDATE entry_lines SET debit = debit + 1 WHERE entry_id = $1 AND debit > 0",
        "INSERT INTO entry_lines (entry_id, line_no, account_id, debit) SELECT $1, 99, account_id, 5 FROM entry_lines WHERE entry_id = $1 LIMIT 1",
      ]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
        await assert.rejects(c.query(sql, [validee.id]), /validée/, sql);
        await c.query("ROLLBACK");
      }
      // Une écriture déséquilibrée insérée en SQL ne peut pas être validée non plus.
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
      const { rows: [u] } = await c.query("SELECT id FROM app_users WHERE email = 'compta@compta-01.cm'");
      const { rows: [v] } = await c.query("SELECT id FROM app_users WHERE email = 'daf@compta-01.cm'");
      const { rows: [f] } = await c.query("SELECT id FROM fiscal_years LIMIT 1");
      const { rows: [x] } = await c.query(
        "INSERT INTO journal_entries (fiscal_year_id, journal_id, entry_date, piece_reference, label, created_by) VALUES ($1,$2,$3,'SQL','Direct',$4) RETURNING id",
        [f.id, journaux.OD, J("04-02"), u.id]);
      await c.query("INSERT INTO entry_lines (entry_id, line_no, account_id, debit) VALUES ($1, 1, $2, 10)", [x.id, comptes["605"]]);
      await c.query("INSERT INTO entry_lines (entry_id, line_no, account_id, credit) VALUES ($1, 2, $2, 9)", [x.id, comptes["401"]]);
      await assert.rejects(c.query("UPDATE journal_entries SET status = 'validated', validated_by = $2 WHERE id = $1", [x.id, v.id]), /déséquilibrée/);
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
      await assert.rejects(c.query("INSERT INTO entry_lines (entry_id, line_no, account_id, debit, credit) SELECT $1, 98, account_id, 5, 5 FROM entry_lines LIMIT 1", [validee.id]));
      await c.query("ROLLBACK");
    } finally { c.release(); }
  });

  test("Extourne : écriture inverse validée, liée, avec motif ; une seule fois ; pas d'extourne d'extourne", async () => {
    const sans = await compta.post(`/api/comptabilite/ecritures/${validee.id}/extourne`, {});
    assert.equal(sans.statut, 400, "motif obligatoire");
    const x = await compta.post(`/api/comptabilite/ecritures/${validee.id}/extourne`, { date: J("04-03"), motif: "Montant erroné" });
    assert.equal(x.statut, 200, JSON.stringify(x.corps));
    assert.equal(x.corps.statut, "validee");
    assert.deepEqual(x.corps.lignes.map((l: { compte: string; debit: number; credit: number }) => [l.compte, l.debit, l.credit]), [["605", 0, 100000], ["571", 100000, 0]]);
    assert.equal(x.corps.extourneDe.id, validee.id);
    const o = (await compta.get(`/api/comptabilite/ecritures/${validee.id}`)).corps;
    assert.equal(o.extourneePar.id, x.corps.id);
    assert.equal(o.libelle, "Petite dépense de caisse", "l'originale est intacte");
    assert.equal((await compta.post(`/api/comptabilite/ecritures/${validee.id}/extourne`, { motif: "Encore" })).corps.erreur.code, "deja_extournee");
    assert.equal((await compta.post(`/api/comptabilite/ecritures/${x.corps.id}/extourne`, { motif: "Encore" })).corps.erreur.code, "extourne_d_extourne");
    const ev = await journal(env, e.entrepriseId);
    const t = ev.find((y) => y.action === "entry_reverse" && y.object_id === validee.id);
    assert.equal(t.reason, "Montant erroné");
  });
});

describe("Grand livre et balance", () => {
  before(async () => {
    // Jeu de référence. Des tests précédents restent FAC-001 (605/401, 150 000) ; les autres sont extournés.
    await saisirEtValider(ecriture("VT", "05-02", "VT-100", "Vente au comptant", [["571", 500000, 0], ["701", 0, 500000]]));
    // Écriture bancaire : saisie par le DAF (droit sur la trésorerie), validée par le DG.
    const dg = (await utilisateurAvecRole(env, e, "general_manager", "dg@compta-01.cm")).agent;
    await saisirEtValider(ecriture("BQ", "05-01", "BQ-100", "Apport en capital", [["521", 500000, 0], ["101", 0, 500000]]), daf, dg);
    await saisirEtValider(ecriture("CA", "05-03", "CA-100", "Petite dépense de caisse", [["605", 100000, 0], ["571", 0, 100000]]));
  });

  test("Balance complète (DAF) : soldes et totaux calculés à la main, résultat", async () => {
    const b = (await daf.get("/api/comptabilite/balance")).corps;
    const s = Object.fromEntries(b.lignes.map((l: { compte: string; soldeDebiteur: number; soldeCrediteur: number }) => [l.compte, [l.soldeDebiteur, l.soldeCrediteur]]));
    assert.deepEqual(s["521"], [500000, 0]);
    assert.deepEqual(s["571"], [400000, 0]);
    assert.deepEqual(s["605"], [250000, 0], "150 000 (février) + 100 000 (mai) ; les écritures extournées s'annulent");
    assert.deepEqual(s["101"], [0, 500000]);
    assert.deepEqual(s["401"], [0, 150000]);
    assert.deepEqual(s["701"], [0, 500000]);
    assert.equal(b.equilibree, true);
    assert.equal(b.totaux.soldeDebiteur, 1150000);
    assert.equal(b.totaux.soldeCrediteur, 1150000);
    assert.equal(b.totaux.mouvementDebit, b.totaux.mouvementCredit);
    assert.equal(b.comptesMasques, 0);
    assert.equal(b.complete, true);
    assert.equal(b.resultat, 250000);
  });

  test("Grand livre : solde d'ouverture de période, mouvements et solde progressif", async () => {
    const gl = (await daf.get(`/api/comptabilite/grand-livre?compte=605&du=${J("05-01")}`)).corps;
    assert.equal(gl.comptes.length, 1);
    const c605 = gl.comptes[0];
    assert.equal(c605.soldeOuverture, 150000, "les mouvements avant le 1er mai forment le solde d'ouverture");
    assert.deepEqual(c605.mouvements.map((m: { debit: number; solde: number }) => [m.debit, m.solde]), [[100000, 250000]]);
    assert.equal(c605.soldeCloture, 250000);
    const tous = (await daf.get("/api/comptabilite/grand-livre")).corps;
    assert.equal(tous.totaux.debit, tous.totaux.credit, "tous comptes : débit = crédit");
  });

  test("Comptes protégés : le comptable ne voit ni la banque, ni le résultat ; il ne peut pas y imputer", async () => {
    const b = (await compta.get("/api/comptabilite/balance")).corps;
    assert.ok(!b.lignes.some((l: { compte: string }) => l.compte.startsWith("52")), "banque masquée");
    assert.ok(b.comptesMasques >= 1);
    assert.equal(b.complete, false);
    assert.equal(b.resultat, null);
    const gl = (await compta.get("/api/comptabilite/grand-livre?compte=52")).corps;
    assert.equal(gl.comptes.length, 0);
    const liste = (await compta.get("/api/comptabilite/ecritures?taille=100")).corps.elements;
    assert.ok(!liste.some((x: { piece: string }) => x.piece === "BQ-100"), "écriture bancaire absente de la liste");
    const bq = (await daf.get("/api/comptabilite/ecritures?recherche=BQ-100")).corps.elements[0];
    assert.equal((await compta.get(`/api/comptabilite/ecritures/${bq.id}`)).statut, 404);
    const r = await compta.post("/api/comptabilite/ecritures", ecriture("BQ", "05-04", "BQ-101", "Frais", [["631", 5000, 0], ["521", 0, 5000]]));
    assert.equal(r.statut, 403);
    assert.equal(r.corps.erreur.code, "compte_protege");
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.some((x) => x.action === "access_denied" && x.event_details.compteProtege === "521"));
  });

  test("Exports : permission requise et trace dans le journal", async () => {
    const r = await compta.get("/api/comptabilite/balance/export");
    assert.equal(r.statut, 200);
    assert.ok(String(r.corps).startsWith("﻿\"Compte\";"));
    assert.match(String(r.corps), /Balance partielle/);
    assert.equal((await compta.get("/api/comptabilite/grand-livre/export")).statut, 200);
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.filter((x) => x.action === "export" && x.event_type === "accounting").length >= 2);
    assert.equal((await caissier.get("/api/comptabilite/balance/export")).statut, 403);
  });
});

describe("Plan comptable", () => {
  test("Création d'un sous-compte, refus de la classe 9 et des doublons, import CSV", async () => {
    const r = await daf.post("/api/comptabilite/comptes", { numero: "5211", libelle: "Banque fictive A (démonstration)" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(r.corps.parent.numero, "521");
    assert.equal((await daf.post("/api/comptabilite/comptes", { numero: "5211", libelle: "Doublon" })).statut, 409);
    assert.equal((await daf.post("/api/comptabilite/comptes", { numero: "901", libelle: "Analytique" })).statut, 400);
    assert.equal((await compta.post("/api/comptabilite/comptes", { numero: "6058", libelle: "Essai" })).statut, 403, "le comptable n'administre pas le plan");
    const imp = await daf.post("/api/comptabilite/comptes/import", { contenu: "numero;libelle\n6061;Eau (import)\n6062;Électricité (import)\n601;Déjà présent\nabc;Ligne invalide" });
    assert.equal(imp.statut, 200, JSON.stringify(imp.corps));
    assert.deepEqual([imp.corps.ajoutes, imp.corps.existants, imp.corps.erreurs.length], [2, 1, 1]);
    // Archivage : plus d'imputation possible.
    assert.equal((await daf.patch(`/api/comptabilite/comptes/${r.corps.id}`, { actif: false })).statut, 200);
    const plan = (await daf.get("/api/comptabilite/comptes?imputables=oui")).corps;
    assert.ok(!plan.some((c: { numero: string }) => c.numero === "5211"));
  });
});

describe("Exercices", () => {
  test("Clôture refusée avec des brouillards, puis définitive ; plus aucune écriture ensuite", async () => {
    // Exercice suivant, pour ne pas bloquer les autres tests.
    const n = await daf.post("/api/comptabilite/exercices", { code: String(AN + 1), debut: `${AN + 1}-01-01`, fin: `${AN + 1}-12-31` });
    assert.equal(n.statut, 200, JSON.stringify(n.corps));
    assert.equal((await daf.post("/api/comptabilite/exercices", { code: "CHEV", debut: `${AN + 1}-06-01`, fin: `${AN + 2}-05-31` })).corps.erreur.code, "chevauchement");
    const b = await compta.post("/api/comptabilite/ecritures", { ...ecriture("OD", "01-01", "OD-N1", "Brouillard", [["605", 10, 0]]), date: `${AN + 1}-02-01` });
    assert.equal(b.statut, 200);
    const refus = await daf.post(`/api/comptabilite/exercices/${n.corps.id}/cloture`, { motif: "Fin d'exercice" });
    assert.equal(refus.statut, 409);
    assert.match(refus.corps.erreur.message, /brouillards/);
    assert.equal((await compta.del(`/api/comptabilite/ecritures/${b.corps.id}`)).statut, 200);
    assert.equal((await daf.post(`/api/comptabilite/exercices/${n.corps.id}/cloture`, { motif: "Fin d'exercice" })).statut, 200);
    const apres = await compta.post("/api/comptabilite/ecritures", { ...ecriture("OD", "01-01", "OD-N2", "Après clôture", [["605", 10, 0]]), date: `${AN + 1}-03-01` });
    assert.equal(apres.corps.erreur.code, "exercice_absent");
    // Même en SQL direct, l'exercice clôturé ne se rouvre pas.
    const c = await env.proprio.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
      await assert.rejects(c.query("UPDATE fiscal_years SET status = 'open', closed_at = NULL WHERE id = $1", [n.corps.id]), /clôturé/);
      await c.query("ROLLBACK");
    } finally { c.release(); }
  });
});

describe("Isolation et permissions", () => {
  test("Une autre entreprise ne voit pas ces écritures et ne peut pas utiliser ces comptes", async () => {
    const autre = await entrepriseActive(env, "COMPTA-02", { mfa: false });
    const dafB = (await utilisateurAvecRole(env, autre, "finance_director", "daf@compta-02.cm")).agent;
    const ecrA = (await daf.get("/api/comptabilite/ecritures?taille=1")).corps.elements[0];
    assert.equal((await dafB.get(`/api/comptabilite/ecritures/${ecrA.id}`)).statut, 404);
    assert.equal((await dafB.get("/api/comptabilite/ecritures")).corps.total, 0);
    const jB = (await dafB.get("/api/comptabilite/journaux")).corps.find((j: { code: string }) => j.code === "OD");
    const r = await dafB.post("/api/comptabilite/ecritures", { journalId: jB.id, date: J("06-01"), piece: "X", libelle: "Comptes de A",
      lignes: [{ compteId: comptes["605"], debit: 1, credit: 0 }, { compteId: comptes["401"], debit: 0, credit: 1 }] });
    assert.equal(r.corps.erreur.code, "compte_inconnu");
    assert.equal((await dafB.get("/api/comptabilite/balance")).corps.lignes.length, 0);
  });

  test("Caissier : aucun accès ; auditeur : lecture seule", async () => {
    assert.equal((await caissier.get("/api/comptabilite/ecritures")).statut, 403);
    assert.equal((await caissier.get("/api/comptabilite/balance")).statut, 403);
    assert.equal((await auditeur.get("/api/comptabilite/balance")).statut, 200);
    assert.equal((await auditeur.post("/api/comptabilite/ecritures", ecriture("OD", "06-01", "A", "Essai", [["605", 1, 0]]))).statut, 403);
    const x = (await daf.get("/api/comptabilite/ecritures?statut=validee&taille=1")).corps.elements[0];
    assert.equal((await auditeur.post(`/api/comptabilite/ecritures/${x.id}/extourne`, { motif: "Essai" })).statut, 403);
  });
});
