import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, entrepriseActive, journal, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/**
 * Trésorerie, ventes et facturation.
 * Montants calculés à la main :
 *   encaissement 50 000 ; dépense 23 850 dont TVA 3 850 → caisse 26 150 ;
 *   transfert caisse → banque 20 000 → caisse 6 150, banque 20 000 ;
 *   annulation de la dépense → caisse 30 000 ;
 *   facture : 3 × 15 000 (marchandise) + 1 × 10 000 (service) = 55 000 HT ;
 *   TVA 19,25 % (taux saisi par l'entreprise) = 10 587,5 → 10 588 ; TTC 65 588.
 */
const AN = new Date().getFullYear();
const AUJ = new Date().toISOString().slice(0, 10);
let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
let daf: Agent, compta: Agent, caissier: Agent, caissier2: Agent, dg: Agent;
let caisse: string, banque: string;
let idCaissier: string;
let facture: { id: string; numero: string; totalTtc: number };

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "TRESO-01", { mfa: false });
  await env.superu.query("UPDATE companies SET niu = 'M000000000001X', rccm = 'RC/DLA/2026/B/0001', address = 'Akwa, Douala', phone = '+237 600 00 00 00' WHERE id = $1", [e.entrepriseId]);
  daf = (await utilisateurAvecRole(env, e, "finance_director", "daf@treso-01.cm")).agent;
  compta = (await utilisateurAvecRole(env, e, "accountant", "compta@treso-01.cm")).agent;
  const c1 = await utilisateurAvecRole(env, e, "cashier", "caisse1@treso-01.cm");
  caissier = c1.agent; idCaissier = c1.id;
  caissier2 = (await utilisateurAvecRole(env, e, "cashier", "caisse2@treso-01.cm")).agent;
  dg = (await utilisateurAvecRole(env, e, "general_manager", "dg@treso-01.cm")).agent;
});
after(async () => { await env?.fermer(); });

const solde = async (agent: Agent, id: string) => (await agent.get("/api/tresorerie/comptes")).corps.find((c: { id: string }) => c.id === id)?.solde;
const ecritureDe = async (agent: Agent, reference: string) => {
  const l = (await agent.get(`/api/comptabilite/ecritures?recherche=${encodeURIComponent(reference)}&taille=50`)).corps.elements;
  return Promise.all(l.map(async (x: { id: string }) => (await agent.get(`/api/comptabilite/ecritures/${x.id}`)).corps));
};
const lignes = (ec: { lignes: { compte: string; debit: number; credit: number }[] }) => ec.lignes.map((l) => [l.compte, l.debit, l.credit]);

describe("Comptes de trésorerie", () => {
  test("Création d'une caisse et d'une banque avec leurs sous-comptes ; caisse attitrée à un caissier", async () => {
    const c = await daf.post("/api/tresorerie/comptes", { type: "caisse", nom: "Caisse boutique Akwa" });
    assert.equal(c.statut, 200, JSON.stringify(c.corps));
    caisse = c.corps.id;
    banque = (await daf.post("/api/tresorerie/comptes", { type: "banque", nom: "Banque fictive A", banque: "Banque fictive", referenceBancaire: "00000-00000-0000000000-00" })).corps.id;
    const liste = (await daf.get("/api/tresorerie/comptes")).corps;
    assert.deepEqual(liste.map((x: { compte: { numero: string } }) => x.compte.numero).sort(), ["5211", "5711"]);
    assert.equal((await caissier.post("/api/tresorerie/comptes", { type: "caisse", nom: "Pirate" })).statut, 403);
    assert.equal((await daf.patch(`/api/tresorerie/comptes/${caisse}`, { caissiers: [idCaissier] })).statut, 200);
    assert.deepEqual((await caissier.get("/api/tresorerie/comptes")).corps.map((x: { id: string }) => x.id), [caisse], "le caissier ne voit que sa caisse");
    assert.deepEqual((await caissier2.get("/api/tresorerie/comptes")).corps, [], "un caissier non attitré ne voit aucune caisse");
  });
});

describe("Encaissements et dépenses", () => {
  test("Encaissement par le caissier : mouvement numéroté et écriture en brouillard", async () => {
    const r = await caissier.post("/api/tresorerie/mouvements", { compteTresorerieId: caisse, sens: "entree", montant: 50000, date: AUJ, libelle: "Vente de cartons usagés", categorie: "autre_produit" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(r.corps.reference, `MVT-${AN}-00001`);
    assert.equal(r.corps.ecriture.statut, "brouillard");
    const [ec] = await ecritureDe(compta, r.corps.reference);
    assert.deepEqual(lignes(ec), [["5711", 50000, 0], ["707", 0, 50000]]);
    assert.equal(ec.journal.code, "CA");
    assert.equal(ec.origine.type, "mouvement");
  });

  test("Dépense avec TVA récupérable ; le caissier n'utilise ni la banque ni une autre caisse", async () => {
    const r = await caissier.post("/api/tresorerie/mouvements", { compteTresorerieId: caisse, sens: "sortie", montant: 23850, tva: 3850, date: AUJ, libelle: "Ramettes de papier", categorie: "fournitures", reference: "REC-778" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    const [ec] = await ecritureDe(compta, "REC-778");
    assert.deepEqual(lignes(ec), [["605", 20000, 0], ["445", 3850, 0], ["5711", 0, 23850]]);
    assert.equal(await solde(caissier, caisse), 26150);
    assert.equal((await caissier.post("/api/tresorerie/mouvements", { compteTresorerieId: banque, sens: "entree", montant: 1, date: AUJ, libelle: "Essai", categorie: "autre_produit" })).statut, 403);
    assert.equal((await caissier2.post("/api/tresorerie/mouvements", { compteTresorerieId: caisse, sens: "entree", montant: 1, date: AUJ, libelle: "Essai", categorie: "autre_produit" })).statut, 403);
  });

  test("Une caisse ne passe jamais en négatif", async () => {
    const r = await caissier.post("/api/tresorerie/mouvements", { compteTresorerieId: caisse, sens: "sortie", montant: 30000, date: AUJ, libelle: "Trop", categorie: "fournitures" });
    assert.equal(r.statut, 409);
    assert.match(r.corps.erreur.message, /Solde de caisse insuffisant : 26150 FCFA disponibles/);
  });

  test("Les salaires (compte protégé) ne sont pas proposés au caissier", async () => {
    const cats = (await caissier.get("/api/tresorerie/categories")).corps;
    assert.ok(!cats.sorties.some((c: { code: string }) => c.code === "salaires"));
    assert.ok((await daf.get("/api/tresorerie/categories")).corps.sorties.some((c: { code: string }) => c.code === "salaires"));
    const r = await caissier.post("/api/tresorerie/mouvements", { compteTresorerieId: caisse, sens: "sortie", montant: 100, date: AUJ, libelle: "Salaire", categorie: "salaires" });
    assert.equal(r.statut, 403);
  });

  test("Transfert de la caisse vers la banque : deux mouvements, une écriture", async () => {
    const r = await daf.post("/api/tresorerie/transferts", { de: caisse, vers: banque, montant: 20000, date: AUJ, libelle: "Versement en banque" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(await solde(daf, caisse), 6150);
    assert.equal(await solde(daf, banque), 20000);
    assert.equal((await ecritureDe(compta, r.corps.reference)).length, 0, "écriture bancaire masquée au comptable");
    const ecs = await ecritureDe(daf, r.corps.reference);
    assert.equal(ecs.length, 1);
    assert.deepEqual(lignes(ecs[0]), [["5211", 20000, 0], ["5711", 0, 20000]]);
  });

  test("Annulation motivée, réservée au DAF ; refusée si elle viderait la caisse ; mouvements intangibles", async () => {
    const mvts = (await daf.get(`/api/tresorerie/mouvements?compte=${caisse}`)).corps.elements;
    const depense = mvts.find((m: { reference: string }) => m.reference === "REC-778");
    const recette = mvts.find((m: { libelle: string }) => m.libelle === "Vente de cartons usagés");
    assert.equal((await caissier.post(`/api/tresorerie/mouvements/${depense.id}/annulation`, { motif: "Erreur" })).statut, 403);
    const trop = await daf.post(`/api/tresorerie/mouvements/${recette.id}/annulation`, { motif: "Erreur de saisie" });
    assert.equal(trop.statut, 409, "annuler l'encaissement de 50 000 viderait la caisse (6 150)");
    const ok = await daf.post(`/api/tresorerie/mouvements/${depense.id}/annulation`, { motif: "Facture refusée par le fournisseur" });
    assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
    assert.equal(await solde(daf, caisse), 30000);
    const [inv] = await ecritureDe(compta, "ANN-REC-778");
    assert.deepEqual(lignes(inv), [["605", 0, 20000], ["445", 0, 3850], ["5711", 23850, 0]]);
    assert.equal((await daf.post(`/api/tresorerie/mouvements/${depense.id}/annulation`, { motif: "Encore" })).statut, 409);
    const c = await env.proprio.connect();
    try {
      for (const sql of ["UPDATE treasury_movements SET amount = 1", "DELETE FROM treasury_movements"]) {
        await c.query("BEGIN"); await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
        await assert.rejects(c.query(sql), /ajout seul/); await c.query("ROLLBACK");
      }
    } finally { c.release(); }
  });
});

describe("Ventes et factures", () => {

  test("Taux de TVA saisi par l'entreprise (aucun taux codé en dur)", async () => {
    assert.deepEqual((await daf.get("/api/ventes/parametres")).corps, { tvaApplicable: false, tauxTvaPdm: 0, mentionsFacture: "", devise: "XAF" });
    assert.equal((await caissier.req("PATCH", "/api/ventes/parametres", { tvaApplicable: true, tauxTvaPdm: 1925 })).statut, 403);
    const r = await daf.req("PATCH", "/api/ventes/parametres", { tvaApplicable: true, tauxTvaPdm: 1925, mentionsFacture: "Taux de démonstration à vérifier." });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
  });

  test("Vente au comptant par le caissier : facture numérotée, TVA arrondie, écritures de vente et de règlement", async () => {
    const r = await caissier.post("/api/ventes/factures", {
      date: AUJ, client: { nom: "Établissements Fictifs Mbarga", niu: "P000000000009Z", enregistrer: true },
      lignes: [{ designation: "Cartouche d'encre", quantite: 3, prixUnitaire: 15000, nature: "marchandise" }, { designation: "Installation", quantite: 1, prixUnitaire: 10000, nature: "service" }],
      paiement: { mode: "comptant", compteTresorerieId: caisse },
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    facture = r.corps;
    assert.equal(r.corps.numero, `FAC-${AN}-00001`);
    assert.deepEqual([r.corps.totalHt, r.corps.totalTva, r.corps.totalTtc], [55000, 10588, 65588]);
    assert.equal(r.corps.statutPaiement, "payee");
    assert.equal(r.corps.type, "mixed");
    const ecs = await ecritureDe(compta, r.corps.numero);
    const vente = ecs.find((x: { journal: { code: string } }) => x.journal.code === "VT");
    const reglement = ecs.find((x: { journal: { code: string } }) => x.journal.code === "CA");
    assert.deepEqual(lignes(vente), [["411", 65588, 0], ["701", 0, 45000], ["706", 0, 10000], ["443", 0, 10588]]);
    assert.deepEqual(lignes(reglement), [["5711", 65588, 0], ["411", 0, 65588]]);
    assert.equal(await solde(caissier, caisse), 30000 + 65588);
    assert.equal((await daf.get("/api/ventes/clients?recherche=Mbarga")).corps.length, 1, "client enregistré");
  });

  test("Facture PDF : contenu, montant en lettres, impression autorisée dans un cadre, génération tracée", async () => {
    const r = await caissier.req("GET", `/api/ventes/factures/${facture.id}/pdf`);
    assert.equal(r.statut, 200);
    assert.equal(r.brut.headers["content-type"], "application/pdf");
    assert.equal(r.brut.headers["x-frame-options"], "SAMEORIGIN");
    const dossier = mkdtempSync(join(tmpdir(), "gc-pdf-"));
    try {
      writeFileSync(join(dossier, "f.pdf"), r.brut.rawPayload);
      const texte = execFileSync("pdftotext", ["-layout", join(dossier, "f.pdf"), "-"]).toString();
      for (const attendu of ["FACTURE", `FAC-${AN}-00001`, "TRESO-01 SARL", "NIU : M000000000001X", "RCCM : RC/DLA/2026/B/0001", "Établissements Fictifs Mbarga",
        "Cartouche d'encre", "45 000", "55 000", "TVA (19,25 %)", "10 588", "65 588",
        "Soixante-cinq mille cinq cent quatre-vingt-huit francs CFA", "Taux de démonstration à vérifier."])
        assert.ok(texte.includes(attendu), `« ${attendu} » absent du PDF :\n${texte}`);
    } finally { rmSync(dossier, { recursive: true, force: true }); }
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.some((x) => x.action === "invoice_pdf" && x.object_id === facture.id));
  });

  test("Vente à crédit, règlement partiel par la banque, trop-perçu refusé", async () => {
    const r = await daf.post("/api/ventes/factures", { date: AUJ, client: { nom: "Client fictif à crédit" },
      lignes: [{ designation: "Audit de caisse", quantite: 2.5, prixUnitaire: 40000, nature: "service" }], paiement: { mode: "credit" } });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(r.corps.numero, `FAC-${AN}-00002`);
    assert.deepEqual([r.corps.totalHt, r.corps.totalTva, r.corps.totalTtc, r.corps.statutPaiement], [100000, 19250, 119250, "impayee"]);
    const p = await daf.post("/api/tresorerie/mouvements", { compteTresorerieId: banque, sens: "entree", montant: 50000, date: AUJ, libelle: "Acompte client", factureId: r.corps.id });
    assert.equal(p.statut, 200, JSON.stringify(p.corps));
    const f = (await daf.get(`/api/ventes/factures/${r.corps.id}`)).corps;
    assert.deepEqual([f.paye, f.reste, f.statutPaiement], [50000, 69250, "partielle"]);
    const trop = await daf.post("/api/tresorerie/mouvements", { compteTresorerieId: banque, sens: "entree", montant: 70000, date: AUJ, libelle: "Solde", factureId: r.corps.id });
    assert.equal(trop.statut, 409);
  });

  test("Numérotation continue des factures, même en parallèle", async () => {
    const corps = { date: AUJ, client: {}, lignes: [{ designation: "Article", quantite: 1, prixUnitaire: 1000, nature: "marchandise" }], paiement: { mode: "credit" } };
    const r = await Promise.all(Array.from({ length: 5 }, () => daf.post("/api/ventes/factures", corps)));
    assert.ok(r.every((x) => x.statut === 200), JSON.stringify(r.map((x) => x.corps)));
    assert.deepEqual(r.map((x) => x.corps.numero).sort(), [3, 4, 5, 6, 7].map((n) => `FAC-${AN}-0000${n}`));
  });

  test("Facture intangible, même en SQL direct ; totaux incohérents refusés par la base", async () => {
    const c = await env.proprio.connect();
    try {
      for (const sql of ["UPDATE invoices SET total_ttc = 1", "DELETE FROM invoices", "DELETE FROM invoice_lines"]) {
        await c.query("BEGIN"); await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
        await assert.rejects(c.query(sql), /ajout seul/, sql); await c.query("ROLLBACK");
      }
      await c.query("BEGIN"); await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
      const { rows: [compte] } = await c.query("SELECT id FROM accounts WHERE account_number = '701'");
      await assert.rejects(c.query("INSERT INTO invoice_lines (invoice_id, line_no, description, quantity, unit_price, amount, revenue_account_id) VALUES ($1, 9, 'Ajout', 1, 1, 1, $2)", [facture.id, compte.id]), /ne se modifie pas/);
      await c.query("ROLLBACK");
      // Facture insérée avec une TVA fausse : refusée à la fin de la transaction.
      await c.query("BEGIN"); await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
      const { rows: [u] } = await c.query("SELECT id FROM app_users LIMIT 1");
      const { rows: [inv] } = await c.query(
        `INSERT INTO invoices (invoice_date, kind, customer_name, seller, currency, tax_rate_bp, total_ht, total_tax, total_ttc, payment_mode, created_by)
         VALUES (current_date, 'goods', 'Fraude', '{}', 'XAF', 1925, 1000, 1, 1001, 'credit', $1) RETURNING id`, [u.id]);
      await c.query("INSERT INTO invoice_lines (invoice_id, line_no, description, quantity, unit_price, amount, revenue_account_id) VALUES ($1, 1, 'X', 1, 1000, 1000, $2)", [inv.id, compte.id]);
      await assert.rejects(c.query("COMMIT"), /incohérente/);
    } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
  });
});

describe("Lien avec la comptabilité", () => {
  test("Écritures générées : ni modifiables ni supprimables depuis la comptabilité", async () => {
    const [ec] = await ecritureDe(compta, `FAC-${AN}-00001`);
    assert.equal((await compta.del(`/api/comptabilite/ecritures/${ec.id}`)).corps.erreur.code, "ecriture_generee");
    const c = await env.proprio.connect();
    try {
      await c.query("BEGIN"); await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
      await assert.rejects(c.query("DELETE FROM journal_entries WHERE id = $1", [ec.id]), /générée par une opération/);
      await c.query("ROLLBACK");
    } finally { c.release(); }
  });

  test("Validation par lots : le comptable ne peut pas, le DAF valide celles des autres, le DG celles du DAF", async () => {
    const aValider = (await daf.get("/api/comptabilite/ecritures?origine=operations&statut=brouillard&taille=100")).corps.elements;
    assert.ok(aValider.length >= 8);
    const ids = aValider.map((x: { id: string }) => x.id);
    assert.equal((await compta.post("/api/comptabilite/ecritures/validation-groupee", { ids })).statut, 403);
    const r = await daf.post("/api/comptabilite/ecritures/validation-groupee", { ids });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.ok(r.corps.validees > 0 && r.corps.refusees > 0, JSON.stringify(r.corps));
    assert.ok(r.corps.resultats.filter((x: { ok: boolean }) => !x.ok).every((x: { erreur: string }) => /Séparation des tâches/.test(x.erreur)));
    const reste = (await dg.get("/api/comptabilite/ecritures?origine=operations&statut=brouillard&taille=100")).corps.elements.map((x: { id: string }) => x.id);
    const r2 = await dg.post("/api/comptabilite/ecritures/validation-groupee", { ids: reste });
    // Le DG ne voit pas la paie mais toutes ces écritures lui sont visibles : tout doit passer.
    assert.equal(r2.corps.refusees, 0, JSON.stringify(r2.corps));
    // La balance comptable rejoint alors la trésorerie.
    const b = (await daf.get("/api/comptabilite/balance")).corps;
    const s = (n: string) => { const l = b.lignes.find((x: { compte: string }) => x.compte === n); return l ? l.soldeDebiteur - l.soldeCrediteur : 0; };
    assert.equal(s("5711"), await solde(daf, caisse));
    assert.equal(s("5211"), await solde(daf, banque));
    assert.equal(b.equilibree, true);
  });

  test("Isolation : une autre entreprise ne voit ni factures ni caisses, et ne peut pas les utiliser", async () => {
    const autre = await entrepriseActive(env, "TRESO-02", { mfa: false });
    const dafB = (await utilisateurAvecRole(env, autre, "finance_director", "daf@treso-02.cm")).agent;
    assert.equal((await dafB.get(`/api/ventes/factures/${facture.id}`)).statut, 404);
    assert.equal((await dafB.get(`/api/ventes/factures/${facture.id}/pdf`)).statut, 404);
    assert.equal((await dafB.get("/api/ventes/factures")).corps.total, 0);
    assert.deepEqual((await dafB.get("/api/tresorerie/comptes")).corps, []);
    assert.equal((await dafB.post("/api/tresorerie/mouvements", { compteTresorerieId: caisse, sens: "entree", montant: 1, date: AUJ, libelle: "Essai", categorie: "autre_produit" })).statut, 404);
  });
});
