import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, entrepriseActive, journal, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/**
 * Avoirs sur factures émises. Montants calculés à la main (TVA 19,25 %) :
 *   facture A, payée comptant : 3 × 15 000 (marchandise) + 1 × 10 000 (service) = 55 000 HT ; TVA 10 588 ; TTC 65 588 ;
 *   avoir 1 : 1 marchandise = 15 000 HT ; TVA 2 887,5 → 2 888 ; TTC 17 888, remboursé en caisse (le client avait tout payé) ;
 *   avoir 2 : le reste (2 marchandises + le service) = 40 000 HT ; TVA restante 10 588 − 2 888 = 7 700 ; TTC 47 700,
 *             sans remboursement → la facture est entièrement annulée et le client a un avoir de 47 700 à faire valoir ;
 *   facture B, à crédit : 3 × 1 001 = 3 003 HT ; TVA 578,08 → 578 ; TTC 3 581 ;
 *   avoirs de 1 unité : 1 001 + 192,69 → 193 = 1 194, deux fois ; le dernier solde : 1 001 + (578 − 386) = 1 193.
 *   Total 1 194 + 1 194 + 1 193 = 3 581 : pas un franc d'écart d'arrondi.
 */
const AUJ = new Date().toISOString().slice(0, 10);
let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
let daf: Agent, caissier: Agent, compta: Agent;
let caisse: string;
let factureA: { id: string; numero: string }, factureB: { id: string; numero: string };
let avoir1: { id: string; numero: string; codeVerification: string; ecriture: { id: string } };

const solde = async (agent: Agent, id: string) => (await agent.get("/api/tresorerie/comptes")).corps.find((c: { id: string }) => c.id === id)?.solde;
const lignes = (ec: { lignes: { compte: string; debit: number; credit: number }[] }) => ec.lignes.map((l) => [l.compte, l.debit, l.credit]);

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "AVOIR-01", { mfa: false });
  daf = (await utilisateurAvecRole(env, e, "finance_director", "daf@avoir-01.cm")).agent;
  compta = (await utilisateurAvecRole(env, e, "accountant", "compta@avoir-01.cm")).agent;
  const c = await utilisateurAvecRole(env, e, "cashier", "caisse@avoir-01.cm");
  caissier = c.agent;
  await daf.patch("/api/ventes/parametres", { tvaApplicable: true, tauxTvaPdm: 1925, mentionsFacture: "" });
  caisse = (await daf.post("/api/tresorerie/comptes", { type: "caisse", nom: "Caisse principale" })).corps.id;
  await daf.patch(`/api/tresorerie/comptes/${caisse}`, { caissiers: [c.id] });
  const a = await caissier.post("/api/ventes/factures", { date: AUJ, client: { nom: "Client fictif Avoir" },
    lignes: [{ designation: "Carton de savon", quantite: 3, prixUnitaire: 15000, nature: "marchandise" },
             { designation: "Livraison", quantite: 1, prixUnitaire: 10000, nature: "service" }],
    paiement: { mode: "comptant", compteTresorerieId: caisse } });
  assert.equal(a.statut, 200, JSON.stringify(a.corps));
  factureA = a.corps;
  const b = await caissier.post("/api/ventes/factures", { date: AUJ, client: { nom: "Client fictif Crédit" },
    lignes: [{ designation: "Pièce détachée", quantite: 3, prixUnitaire: 1001, nature: "marchandise" }], paiement: { mode: "credit" } });
  factureB = b.corps;
});
after(async () => { await env?.fermer(); });

describe("Avoirs", () => {
  test("Le caissier ne peut pas émettre d'avoir (sales.cancel)", async () => {
    const r = await caissier.post(`/api/ventes/factures/${factureA.id}/avoirs`, { date: AUJ, motif: "Retour", lignes: [{ ordre: 1, quantite: 1 }] });
    assert.equal(r.statut, 403);
  });

  test("Avoir partiel avec remboursement en caisse : montants, écriture inverse, facture mise à jour", async () => {
    const avant = await solde(daf, caisse);
    const r = await daf.post(`/api/ventes/factures/${factureA.id}/avoirs`, { date: AUJ, motif: "Retour d'un carton abîmé",
      lignes: [{ ordre: 1, quantite: 1 }], rembourser: { compteTresorerieId: caisse } });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    avoir1 = r.corps;
    assert.match(r.corps.numero, /^AV-\d{4}-00001$/);
    assert.deepEqual([r.corps.totalHt, r.corps.totalTva, r.corps.totalTtc], [15000, 2888, 17888]);
    assert.deepEqual([r.corps.remboursement.montant, r.corps.facture.numero], [17888, factureA.numero]);
    assert.equal(await solde(daf, caisse), avant - 17888);
    const ec = (await compta.get(`/api/comptabilite/ecritures/${r.corps.ecriture.id}`)).corps;
    assert.deepEqual([ec.statut, ec.origine.type, ec.origine.reference], ["brouillard", "avoir", r.corps.numero]);
    assert.deepEqual(lignes(ec), [["701", 15000, 0], ["443", 2888, 0], ["411", 0, 17888]]);
    const f = (await daf.get(`/api/ventes/factures/${factureA.id}`)).corps;
    assert.deepEqual([f.totalAvoirs, f.paye, f.reste, f.statutPaiement], [17888, 65588 - 17888, 0, "payee"]);
    assert.deepEqual(f.lignes.map((l: { quantiteCreditee: number }) => l.quantiteCreditee), [1, 0]);
    assert.equal(f.avoirs[0].numero, r.corps.numero);
    // L'écriture générée par l'avoir ne se supprime pas depuis la comptabilité.
    assert.equal((await compta.del(`/api/comptabilite/ecritures/${ec.id}`)).corps.erreur.code, "ecriture_generee");
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "credit_note_issue" && x.object_id === r.corps.id));
  });

  test("On ne crédite jamais plus que ce qui a été facturé", async () => {
    const r = await daf.post(`/api/ventes/factures/${factureA.id}/avoirs`, { date: AUJ, motif: "Erreur", lignes: [{ ordre: 1, quantite: 3 }] });
    assert.deepEqual([r.statut, r.corps.erreur.code], [409, "trop_credite"]);
    assert.equal((await daf.post(`/api/ventes/factures/${factureA.id}/avoirs`, { date: AUJ, motif: "Erreur", lignes: [{ ordre: 9, quantite: 1 }] })).statut, 400);
    assert.equal((await daf.post(`/api/ventes/factures/${factureA.id}/avoirs`, { date: "2000-01-01", motif: "Erreur", lignes: [{ ordre: 2, quantite: 1 }] })).statut, 400);
    assert.equal((await daf.post(`/api/ventes/factures/${factureA.id}/avoirs`, { date: AUJ, motif: "", lignes: [{ ordre: 2, quantite: 1 }] })).statut, 400);
  });

  test("Avoir qui solde la facture : TVA restante exacte, facture annulée, client créditeur", async () => {
    const r = await daf.post(`/api/ventes/factures/${factureA.id}/avoirs`, { date: AUJ, motif: "Annulation de la commande",
      lignes: [{ ordre: 1, quantite: 2 }, { ordre: 2, quantite: 1 }] });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.deepEqual([r.corps.totalHt, r.corps.totalTva, r.corps.totalTtc, r.corps.remboursement], [40000, 7700, 47700, null]);
    const f = (await daf.get(`/api/ventes/factures/${factureA.id}`)).corps;
    assert.deepEqual([f.totalAvoirs, f.reste, f.statutPaiement], [65588, -47700, "annulee"]);
    const encore = await daf.post(`/api/ventes/factures/${factureA.id}/avoirs`, { date: AUJ, motif: "Encore", lignes: [{ ordre: 2, quantite: 1 }] });
    assert.equal(encore.corps.erreur.code, "trop_credite");
  });

  test("Facture à crédit : avoirs successifs sans écart d'arrondi ; pas de remboursement sans trop-perçu", async () => {
    const rembourse = await daf.post(`/api/ventes/factures/${factureB.id}/avoirs`, { date: AUJ, motif: "Pièce non conforme",
      lignes: [{ ordre: 1, quantite: 1 }], rembourser: { compteTresorerieId: caisse } });
    assert.equal(rembourse.corps.erreur.code, "rien_a_rembourser");
    const ttc: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await daf.post(`/api/ventes/factures/${factureB.id}/avoirs`, { date: AUJ, motif: "Pièce non conforme", lignes: [{ ordre: 1, quantite: 1 }] });
      assert.equal(r.statut, 200, JSON.stringify(r.corps));
      ttc.push(r.corps.totalTtc);
    }
    assert.deepEqual(ttc, [1194, 1194, 1193]);
    const f = (await daf.get(`/api/ventes/factures/${factureB.id}`)).corps;
    assert.deepEqual([f.totalAvoirs, f.reste, f.statutPaiement], [3581, 0, "annulee"]);
    // Plus rien à encaisser sur cette facture.
    const enc = await daf.post("/api/tresorerie/mouvements", { compteTresorerieId: caisse, sens: "entree", montant: 1, date: AUJ, libelle: "Règlement", factureId: factureB.id });
    assert.equal(enc.corps.erreur.code, "trop_percu");
  });

  test("Liste des avoirs, PDF et vérification par le code QR", async () => {
    const l = (await compta.get("/api/ventes/avoirs")).corps;
    assert.equal(l.total, 5);
    assert.equal(l.totalTtc, 17888 + 47700 + 3581);
    assert.equal(l.elements.at(-1).numero, avoir1.numero);
    assert.equal(l.elements.at(-1).rembourse, 17888);

    const pdf = await daf.req("GET", `/api/ventes/avoirs/${avoir1.id}/pdf`);
    assert.equal(pdf.brut.headers["content-type"], "application/pdf");
    const dir = mkdtempSync(join(tmpdir(), "gc-avoir-"));
    try {
      writeFileSync(join(dir, "a.pdf"), pdf.brut.rawPayload);
      const texte = execFileSync("pdftotext", ["-layout", join(dir, "a.pdf"), "-"]).toString();
      for (const attendu of ["AVOIR", avoir1.numero, `Sur la facture ${factureA.numero}`, "Motif : Retour d'un carton abîmé", "Montant de l'avoir", "17 888", "remboursé au client"])
        assert.ok(texte.includes(attendu), `« ${attendu} » absent du PDF :\n${texte}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }

    const v = await caissier.post("/api/ventes/verification", { contenu: avoir1.codeVerification });
    assert.deepEqual([v.corps.authentique, v.corps.avoir?.numero, v.corps.avoir?.facture, v.corps.avoir?.totalTtc], [true, avoir1.numero, factureA.numero, 17888]);
    const faux = avoir1.codeVerification.replace(";17888;", ";1788;");
    assert.equal((await caissier.post("/api/ventes/verification", { contenu: faux })).corps.authentique, false);
  });

  test("La base refuse elle-même un avoir excessif ou incohérent (hors application)", async () => {
    const { rows: [u] } = await env.superu.query("SELECT id FROM app_users WHERE company_id = $1 LIMIT 1", [e.entrepriseId]);
    const essai = async (ht: number, tva: number, ligne: { no: number; q: number; m: number }, facture = factureB.id) => {
      const c = await env.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
        const { rows: [a] } = await c.query(
          `INSERT INTO credit_notes (invoice_id, credit_date, reason, seller, currency, tax_rate_bp, total_ht, total_tax, total_ttc, created_by)
           SELECT id, invoice_date, 'Essai direct', seller, currency, tax_rate_bp, $2, $3, $2::bigint + $3::bigint, $4 FROM invoices WHERE id = $1 RETURNING id`, [facture, ht, tva, u.id]);
        await c.query("INSERT INTO credit_note_lines (credit_note_id, line_no, invoice_id, invoice_line_no, quantity, amount) VALUES ($1, 1, $2, $3, $4, $5)", [a.id, facture, ligne.no, ligne.q, ligne.m]);
        await c.query("COMMIT");
      } catch (err) { await c.query("ROLLBACK"); throw err; } finally { c.release(); }
    };
    // Facture B déjà entièrement créditée : une unité de plus est refusée.
    await assert.rejects(essai(1001, 193, { no: 1, q: 1, m: 1001 }), /au-delà/);
    // Nouvelle facture : TVA fantaisiste ou montant de ligne faux, refusés.
    const fx = await caissier.post("/api/ventes/factures", { date: AUJ, client: { nom: "Client fictif Base" },
      lignes: [{ designation: "Sac de riz", quantite: 2, prixUnitaire: 20000, nature: "marchandise" }], paiement: { mode: "credit" } });
    await assert.rejects(essai(20000, 1, { no: 1, q: 1, m: 20000 }, fx.corps.id), /TVA/);
    await assert.rejects(essai(19000, 3658, { no: 1, q: 1, m: 19000 }, fx.corps.id), /quantité × prix/);
  });

  test("Un avoir est intangible", async () => {
    await assert.rejects(env.pool.query("UPDATE credit_notes SET reason = 'x'"), /interdit|not allowed|forbid|permission/i);
    await assert.rejects(env.pool.query("DELETE FROM credit_note_lines"), /interdit|not allowed|forbid|permission/i);
  });

  test("Tableau de bord : ventes nettes des avoirs, encaissements nets des remboursements", async () => {
    const r = (await daf.get("/api/tableau-de-bord/evolution?mois=2")).corps;
    // Factures A et B entièrement créditées ; reste la facture « Client fictif Base » : 40 000 HT + 7 700 TVA.
    assert.equal(r.ventes.at(-1), 65588 + 3581 + 47700 - 65588 - 3581);
    assert.equal(r.encaissements.at(-1), 65588 - 17888);
  });
});
