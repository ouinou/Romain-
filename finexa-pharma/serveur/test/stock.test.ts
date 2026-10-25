import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Agent, MDP, entrepriseActive, journal, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/**
 * Lots, stock et mouvements, inventaires. Quantités calculées à la main dans chaque test :
 * le stock d'un lot est toujours la somme de ses mouvements.
 */
const jour = (decalage: number) => { const d = new Date(); d.setDate(d.getDate() + decalage); return d.toISOString().slice(0, 10); };
let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
let stock: Agent, vendeur: Agent;
let produit: { id: string }, autre: { id: string };
let lotA: { id: string }, lotB: { id: string };

const confirmer = (a: Agent) => a.post("/api/auth/confirmation", { motDePasse: MDP });
/** Nouvelle session sans confirmation récente (le compte de test est confirmé à sa création). */
const sessionNeuve = async (email: string) => {
  const a = new Agent(env.app, "10.0.0.31");
  await a.post("/api/auth/connexion", { codeEntreprise: "STK-01", email, motDePasse: MDP });
  return a;
};
const quantite = async (lotId: string) => (await stock.get(`/api/lots/${lotId}`)).corps.quantite;

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "STK-01", { mfa: false });
  stock = (await utilisateurAvecRole(env, e, "stock_manager", "stock@stk-01.cm")).agent;
  vendeur = (await utilisateurAvecRole(env, e, "seller", "vente@stk-01.cm")).agent;
  produit = (await stock.post("/api/produits", { nom: "Amoxicilline 500 mg (test)", prixAchat: 1100, prixVente: 1600, seuil: 30 })).corps;
  autre = (await stock.post("/api/produits", { nom: "Sirop fictif (test)", prixVente: 1300, seuil: 5 })).corps;
});
after(async () => { await env?.fermer(); });

describe("Stock initial et lots", () => {
  test("Entrée initiale : lot créé avec son mouvement ; même numéro = même lot complété", async () => {
    const r = await stock.post("/api/lots", { produitId: produit.id, numero: "L-A1", peremption: jour(400), quantite: 50, fournisseur: "Grossiste fictif" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    lotA = r.corps;
    assert.deepEqual([r.corps.quantite, r.corps.prixAchat, r.corps.etat, r.corps.vendable], [50, 1100, "ok", true]);
    const encore = await stock.post("/api/lots", { produitId: produit.id, numero: " l-a1 ", peremption: jour(400), quantite: 10 });
    assert.equal(encore.corps.id, lotA.id, "même lot (numéro sans tenir compte des majuscules ni des espaces)");
    assert.equal(encore.corps.quantite, 60);
    lotB = (await stock.post("/api/lots", { produitId: produit.id, numero: "L-B2", peremption: jour(30), quantite: 20 })).corps;
    const fiche = (await vendeur.get(`/api/produits/${produit.id}`)).corps;
    assert.deepEqual([fiche.stock.vendable, fiche.stock.total, fiche.stock.prochainePeremption, fiche.alerte], [80, 80, jour(30), null]);
  });

  test("Refus : autre péremption pour un numéro existant, lot déjà périmé, réception future, produit archivé, quantité nulle", async () => {
    const autrePeremption = await stock.post("/api/lots", { produitId: produit.id, numero: "L-A1", peremption: jour(500), quantite: 1 });
    assert.match(autrePeremption.corps.erreur.message, /existe déjà avec une autre date de péremption/);
    assert.equal((await stock.post("/api/lots", { produitId: produit.id, numero: "L-OLD", peremption: jour(-1), quantite: 5 })).corps.erreur.code, "lot_perime");
    assert.equal((await stock.post("/api/lots", { produitId: produit.id, numero: "L-FUT", peremption: jour(200), quantite: 5, recuLe: jour(3) })).corps.erreur.code, "date_future");
    assert.equal((await stock.post("/api/lots", { produitId: produit.id, numero: "L-Z", peremption: jour(200), quantite: 0 })).statut, 400);
    assert.equal((await vendeur.post("/api/lots", { produitId: produit.id, numero: "L-V", peremption: jour(200), quantite: 5 })).statut, 403, "le vendeur n'entre pas de stock");
  });

  test("Mouvements et lots intangibles en base ; numérotation continue", async () => {
    await assert.rejects(env.pool.query("UPDATE stock_movements SET quantity = 999"), /interdit|not allowed|forbid|permission/i);
    await assert.rejects(env.pool.query("DELETE FROM stock_movements"), /interdit|not allowed|forbid|permission/i);
    await assert.rejects(env.pool.query("UPDATE lots SET expiry_date = '2099-01-01'"), /permission/i, "péremption non modifiable");
    const h = (await stock.get(`/api/lots/${lotA.id}`)).corps.mouvements;
    assert.deepEqual(h.map((m: { quantite: number; solde: number }) => [m.quantite, m.solde]), [[50, 50], [10, 60]]);
    assert.match(h[0].numero, new RegExp(`^MVT-${new Date().getFullYear()}-0000\\d$`));
  });
});

describe("Ajustements", () => {
  test("Droit, confirmation par mot de passe et motif obligatoires ; sens imposé par le motif", async () => {
    const corps = { lotId: lotA.id, sens: "sortie", quantite: 2, motif: "casse" };
    assert.equal((await vendeur.post("/api/stock/ajustements", corps)).statut, 403);
    assert.equal((await (await sessionNeuve("stock@stk-01.cm")).post("/api/stock/ajustements", corps)).corps.erreur.code, "confirmation_requise");
    assert.equal((await stock.post("/api/stock/ajustements", { ...corps, sens: "entree" })).corps.erreur.code, "sens_motif");
    assert.equal((await stock.post("/api/stock/ajustements", { ...corps, motif: "autre" })).corps.erreur.code, "precision");
    const ok = await stock.post("/api/stock/ajustements", corps);
    assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
    assert.equal(await quantite(lotA.id), 58);
    const corr = await stock.post("/api/stock/ajustements", { lotId: lotA.id, sens: "entree", quantite: 1, motif: "erreur_saisie", precision: "Boîte retrouvée en réserve" });
    assert.equal(corr.statut, 200);
    assert.equal(await quantite(lotA.id), 59);
    const mvt = (await stock.get(`/api/stock/mouvements?lot=${lotA.id}`)).corps.elements;
    assert.deepEqual(mvt.slice(0, 2).map((m: { nature: string; motif: string }) => [m.nature, m.motif]),
      [["adjustment", "Correction d'une erreur de saisie : Boîte retrouvée en réserve"], ["breakage", "Casse ou produit abîmé"]]);
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "adjustment"));
  });

  test("Stock jamais négatif, même avec deux sorties simultanées de la dernière boîte", async () => {
    const trop = await stock.post("/api/stock/ajustements", { lotId: lotB.id, sens: "sortie", quantite: 21, motif: "vol" });
    assert.equal(trop.statut, 409);
    assert.match(trop.corps.erreur.message, /Stock insuffisant pour le lot L-B2 : 20 disponible\(s\), 21 demandé\(s\)/);
    await stock.post("/api/stock/ajustements", { lotId: lotB.id, sens: "sortie", quantite: 19, motif: "vol" });
    const deux = await Promise.all([1, 2].map(() => stock.post("/api/stock/ajustements", { lotId: lotB.id, sens: "sortie", quantite: 1, motif: "casse" })));
    assert.deepEqual(deux.map((r) => r.statut).sort(), [200, 409], "une seule des deux sorties passe");
    assert.equal(await quantite(lotB.id), 0);
  });
});

describe("Blocage, alertes et péremptions", () => {
  test("Lot bloqué : invendable, motif obligatoire ; lever un rappel demande une confirmation", async () => {
    assert.equal((await stock.post(`/api/lots/${lotA.id}/statut`, { statut: "blocked", motif: "" })).statut, 400);
    const b = await stock.post(`/api/lots/${lotA.id}/statut`, { statut: "recalled", motif: "Avis de rappel fictif n° 1" });
    assert.deepEqual([b.corps.statut, b.corps.vendable, b.corps.etat], ["recalled", false, "recalled"]);
    assert.equal((await vendeur.get(`/api/produits/${produit.id}`)).corps.stock.vendable, 0, "un lot rappelé n'est pas vendable");
    assert.equal((await (await sessionNeuve("stock@stk-01.cm")).post(`/api/lots/${lotA.id}/statut`, { statut: "available", motif: "Rappel levé" })).corps.erreur.code, "confirmation_requise");
    await stock.post(`/api/lots/${lotA.id}/statut`, { statut: "available", motif: "Rappel levé par le fabricant (fictif)" });
    assert.equal((await vendeur.get(`/api/produits/${produit.id}`)).corps.stock.vendable, 59);
  });

  test("Alertes : rupture, sous le seuil, péremption proche, lot périmé encore en stock, lot bloqué", async () => {
    // Lot du second produit qui périme dans 10 jours (délai par défaut : 90 jours), puis un lot déjà périmé.
    const proche = (await stock.post("/api/lots", { produitId: autre.id, numero: "S-1", peremption: jour(10), quantite: 3 })).corps;
    const { rows: [l] } = await env.superu.query(
      `INSERT INTO lots (company_id, product_id, lot_number, expiry_date, received_on, purchase_price, created_by)
       SELECT company_id, id, 'S-OLD', current_date - 5, current_date - 100, 0, created_by FROM products WHERE id = $1 RETURNING id, company_id, created_by`, [autre.id]);
    await env.superu.query("INSERT INTO stock_movements (company_id, lot_id, product_id, kind, quantity, reason, created_by) VALUES ($1,$2,$3,'initial',4,'Stock initial',$4)", [l.company_id, l.id, autre.id, l.created_by]);
    const a = (await vendeur.get("/api/stock/alertes")).corps;
    assert.deepEqual(a.sousSeuil.map((p: { id: string; vendable: number }) => [p.id, p.vendable]), [[autre.id, 3]], "3 vendables (le lot périmé ne compte pas), seuil 5");
    assert.ok(a.proches.some((x: { id: string }) => x.id === proche.id));
    assert.ok(a.perimes.some((x: { numero: string; quantite: number }) => x.numero === "S-OLD" && x.quantite === 4));
    const lots = (await vendeur.get(`/api/lots?etat=perime`)).corps.elements;
    assert.deepEqual(lots.map((x: { numero: string; vendable: boolean }) => [x.numero, x.vendable]), [["S-OLD", false]]);
    // Sortie pour péremption : ramène le lot périmé à zéro.
    await confirmer(stock);
    assert.equal((await stock.post("/api/stock/ajustements", { lotId: l.id, sens: "sortie", quantite: 4, motif: "peremption" })).statut, 200);
    assert.equal((await vendeur.get("/api/stock/alertes")).corps.perimes.length, 0);
    const tb = (await vendeur.get("/api/tableau-de-bord")).corps;
    assert.deepEqual([tb.indicateurs.produits, tb.indicateurs.sousSeuil, tb.indicateurs.peremptionsProches, tb.indicateurs.lotsPerimes], [2, 1, 1, 0]);
    assert.equal(tb.indicateurs.valeurStock, null, "le vendeur ne voit pas la valeur du stock");
    assert.equal((await stock.get("/api/tableau-de-bord")).corps.indicateurs.valeurStock, 59 * 1100 + 3 * 0, "valeur d'achat : 59 × 1 100 + 3 × 0");
  });
});

describe("Inventaire", () => {
  let inv: Record<string, any>;
  test("Ouverture : une ligne par lot en stock ; un seul inventaire ouvert à la fois", async () => {
    const r = await stock.post("/api/inventaires", { libelle: "Inventaire de test" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    inv = r.corps;
    assert.match(inv.numero, /^INV-\d{4}-001$/);
    assert.deepEqual(inv.lignes.map((l: { lot: string; theorique: number }) => [l.lot, l.theorique]).sort(), [["L-A1", 59], ["S-1", 3]]);
    assert.equal((await stock.post("/api/inventaires", { libelle: "Deuxième" })).corps.erreur.code, "inventaire_ouvert");
  });

  test("Comptage : le stock théorique est relu au moment du comptage ; validation = mouvements d'écart", async () => {
    // Une sortie pendant l'inventaire (avant le comptage du lot) ne crée pas de faux écart.
    await confirmer(stock);
    await stock.post("/api/stock/ajustements", { lotId: lotA.id, sens: "sortie", quantite: 4, motif: "casse" });   // 59 → 55
    const c = await stock.put(`/api/inventaires/${inv.id}/comptages`, { lignes: [{ lotId: lotA.id, compte: 53 }, { lotId: inv.lignes.find((l: { lot: string }) => l.lot === "S-1").lotId, compte: 3 }] });
    const a1 = c.corps.lignes.find((l: { lot: string }) => l.lot === "L-A1");
    assert.deepEqual([a1.theorique, a1.compte, a1.ecart], [55, 53, -2]);
    assert.deepEqual([c.corps.resume.comptees, c.corps.resume.ecarts, c.corps.resume.ecartTotal], [2, 1, -2]);
    assert.equal((await vendeur.post(`/api/inventaires/${inv.id}/validation`, {})).statut, 403);
    await confirmer(stock);
    const v = await stock.post(`/api/inventaires/${inv.id}/validation`, {});
    assert.equal(v.statut, 200, JSON.stringify(v.corps));
    assert.equal(v.corps.statut, "validated");
    assert.equal(await quantite(lotA.id), 53);
    const m = (await stock.get(`/api/stock/mouvements?nature=inventory`)).corps.elements;
    assert.deepEqual(m.map((x: { quantite: number; inventaire: string }) => [x.quantite, x.inventaire]), [[-2, inv.numero]]);
    // Inventaire clos : figé, y compris directement en base.
    assert.equal((await stock.put(`/api/inventaires/${inv.id}/comptages`, { lignes: [{ lotId: lotA.id, compte: 1 }] })).corps.erreur.code, "inventaire_clos");
    await assert.rejects(env.superu.query("UPDATE inventory_lines SET counted = 0 WHERE inventory_id = $1", [inv.id]), /clos/);
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "inventory_validate"));
  });

  test("Annulation motivée d'un inventaire en cours : aucun mouvement", async () => {
    const i = (await stock.post("/api/inventaires", { libelle: "À annuler" })).corps;
    assert.equal((await stock.post(`/api/inventaires/${i.id}/annulation`, { motif: "" })).statut, 400);
    const r = await stock.post(`/api/inventaires/${i.id}/annulation`, { motif: "Ouvert par erreur" });
    assert.equal(r.corps.statut, "cancelled");
    assert.equal(await quantite(lotA.id), 53);
  });
});

describe("Exports et isolation", () => {
  test("Export du stock par lot et des mouvements (CSV, tracé) ; une autre officine ne voit rien", async () => {
    const lots = await stock.req("GET", "/api/lots/export");
    assert.equal(lots.statut, 200);
    assert.ok(lots.brut.body.includes('"L-A1"') && lots.brut.body.includes('"53"'));
    const mvts = await stock.req("GET", "/api/stock/mouvements/export");
    assert.ok(mvts.brut.body.includes("Écart d'inventaire"));
    assert.equal((await vendeur.req("GET", "/api/lots/export")).statut, 403);
    const b = await entrepriseActive(env, "STK-02", { mfa: false });
    assert.equal((await b.admin.get(`/api/lots/${lotA.id}`)).statut, 404);
    assert.equal((await b.admin.get("/api/lots")).corps.total, 0);
  });
});
