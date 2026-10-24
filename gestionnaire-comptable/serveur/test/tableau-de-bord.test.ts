import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Agent, confirmer, entrepriseActive, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/**
 * Graphique du tableau de bord : ventes TTC et encaissements par mois, selon les droits.
 * Calcul attendu (TVA à 19,25 %) : vente comptant 20 000 HT → 23 850 TTC encaissés ; vente à crédit 10 000 HT → 11 925 ;
 * règlement partiel 5 000 ; transfert interne 1 000 (exclu) ; encaissement annulé 2 000 (net 0).
 */
const AUJ = new Date().toISOString().slice(0, 10);
let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
let daf: Agent, caissier: Agent, compta: Agent;
let caisse: string, banque: string;

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "TDB-01", { mfa: false });
  daf = (await utilisateurAvecRole(env, e, "finance_director", "daf@tdb-01.cm")).agent;
  const c = await utilisateurAvecRole(env, e, "cashier", "caisse@tdb-01.cm");
  caissier = c.agent;
  compta = (await utilisateurAvecRole(env, e, "accountant", "compta@tdb-01.cm")).agent;
  await daf.patch("/api/ventes/parametres", { tvaApplicable: true, tauxTvaPdm: 1925, mentionsFacture: "" });
  caisse = (await daf.post("/api/tresorerie/comptes", { type: "caisse", nom: "Caisse" })).corps.id;
  banque = (await daf.post("/api/tresorerie/comptes", { type: "banque", nom: "Banque" })).corps.id;
  await daf.patch(`/api/tresorerie/comptes/${caisse}`, { caissiers: [c.id] });
});
after(async () => { await env?.fermer(); });

const ligne = (prix: number) => [{ designation: "Prestation", quantite: 1, prixUnitaire: prix, nature: "service" }];

test("Ventes et encaissements du mois, nets des annulations, transferts exclus", async () => {
  assert.equal((await caissier.post("/api/ventes/factures", { date: AUJ, client: {}, lignes: ligne(20000), paiement: { mode: "comptant", compteTresorerieId: caisse } })).statut, 200);
  const credit = (await daf.post("/api/ventes/factures", { date: AUJ, client: { nom: "Client fictif" }, lignes: ligne(10000), paiement: { mode: "credit" } })).corps;
  assert.equal((await daf.post("/api/tresorerie/mouvements", { compteTresorerieId: banque, sens: "entree", montant: 5000, date: AUJ, libelle: "Acompte", factureId: credit.id })).statut, 200);
  assert.equal((await daf.post("/api/tresorerie/transferts", { de: caisse, vers: banque, montant: 1000, date: AUJ, libelle: "Dépôt en banque" })).statut, 200);
  const annule = (await daf.post("/api/tresorerie/mouvements", { compteTresorerieId: banque, sens: "entree", montant: 2000, date: AUJ, libelle: "Recette erronée", categorie: "autre_produit" })).corps;
  await confirmer(daf);
  assert.equal((await daf.post(`/api/tresorerie/mouvements/${annule.id}/annulation`, { motif: "Saisie en double" })).statut, 200);

  const r = await daf.get("/api/tableau-de-bord/evolution?mois=6");
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.mois.length, 6);
  assert.equal(r.corps.mois.at(-1), AUJ.slice(0, 7));
  assert.deepEqual(r.corps.ventes.slice(0, 5), [0, 0, 0, 0, 0]);
  assert.equal(r.corps.ventes.at(-1), 23850 + 11925);
  assert.equal(r.corps.encaissements.at(-1), 23850 + 5000);
});

test("Chaque série selon les droits ; aucun accès sans ventes ni trésorerie", async () => {
  const c = (await caissier.get("/api/tableau-de-bord/evolution")).corps;
  assert.equal(c.encaissements.at(-1), 23850, "la caissière ne voit que sa caisse");
  assert.equal(c.ventes.at(-1), 23850 + 11925);
  const k = (await compta.get("/api/tableau-de-bord/evolution")).corps;
  assert.equal(k.encaissements, null, "le comptable n'a pas accès à la trésorerie");
  assert.equal((await e.admin.get("/api/tableau-de-bord/evolution")).statut, 403);
  assert.equal((await daf.get("/api/tableau-de-bord/evolution?mois=99")).statut, 400);
});
