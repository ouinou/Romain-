import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Agent, entrepriseActive, journal, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/** Catalogue : référentiels sur deux niveaux, fiches produits, TVA paramétrée, historique des prix, archivage, import et export CSV. */
let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
let stock: Agent, vendeur: Agent;
let categorie: string, famille: string, forme: string;

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "CAT-01", { mfa: false });
  stock = (await utilisateurAvecRole(env, e, "stock_manager", "stock@cat-01.cm")).agent;
  vendeur = (await utilisateurAvecRole(env, e, "seller", "vente@cat-01.cm")).agent;
});
after(async () => { await env?.fermer(); });

describe("Référentiels", () => {
  test("Référentiels de départ ; catégories et familles sur deux niveaux, sans doublon", async () => {
    const formes = (await stock.get("/api/referentiels/formes")).corps;
    assert.ok(formes.some((f: { nom: string }) => f.nom === "Comprimé"));
    assert.ok((await stock.get("/api/referentiels/emplacements")).corps.some((x: { natureLibelle: string }) => x.natureLibelle === "Réfrigérateur"));
    forme = formes.find((f: { nom: string }) => f.nom === "Comprimé").id;
    // Créer une catégorie demande catalog.admin (titulaire, ici le premier compte).
    assert.equal((await stock.post("/api/referentiels/categories", { nom: "Antalgiques" })).statut, 403);
    categorie = (await e.admin.get("/api/referentiels/categories")).corps.find((c: { nom: string }) => c.nom === "Médicaments").id;
    famille = (await e.admin.post("/api/referentiels/categories", { nom: "Antalgiques", parentId: categorie })).corps.id;
    const sousFamille = await e.admin.post("/api/referentiels/categories", { nom: "Trop profond", parentId: famille });
    assert.equal(sousFamille.statut, 409);
    assert.match(sousFamille.corps.erreur.message, /famille se range sous une catégorie/);
    assert.equal((await e.admin.post("/api/referentiels/categories", { nom: " antalgiques ", parentId: categorie })).corps.erreur.code, "doublon");
    const arbre = (await stock.get("/api/referentiels/categories")).corps;
    assert.equal(arbre.find((c: { id: string }) => c.id === categorie).familles[0].nom, "Antalgiques");
  });
});

describe("Fiches produits", () => {
  let produit: Record<string, any>;
  test("Création : code interne attribué, champs contrôlés, code-barres unique", async () => {
    const r = await stock.post("/api/produits", { nom: "Paracétamol 500 mg (test)", dci: "Paracétamol", categorieId: famille, formeId: forme, dosage: "500 mg",
      presentation: "Boîte de 16", fabricant: "Laboratoire fictif", prixAchat: 350, prixVente: 500, seuil: 10, codeBarres: "3400000000011" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    produit = r.corps;
    assert.match(produit.code, /^P-\d{5}$/);
    assert.equal(produit.categorie, "Médicaments › Antalgiques");
    assert.deepEqual([produit.stock.vendable, produit.alerte], [0, "rupture"]);
    const invalide = await stock.post("/api/produits", { nom: "X", prixVente: -5 });
    assert.equal(invalide.statut, 400);
    assert.ok(invalide.corps.erreur.champs.some((c: { champ: string }) => c.champ === "nom") && invalide.corps.erreur.champs.some((c: { champ: string }) => c.champ === "prixVente"));
    const doublon = await stock.post("/api/produits", { nom: "Autre produit", prixVente: 100, codeBarres: "3400000000011" });
    assert.match(doublon.corps.erreur.message, /code-barres est déjà attribué/);
    assert.equal((await vendeur.post("/api/produits", { nom: "Produit vendeur", prixVente: 100 })).statut, 403, "le vendeur ne crée pas de fiche");
  });

  test("TVA : seulement un taux saisi dans les paramètres de la pharmacie", async () => {
    const refus = await stock.patch(`/api/produits/${produit.id}`, { tauxTvaPdm: 1925 });
    assert.equal(refus.corps.erreur.code, "tva_inconnue");
    assert.equal((await stock.patch("/api/parametres-pharmacie", { tauxTva: [{ libelle: "Taux fictif", tauxPdm: 1925 }] })).statut, 403);
    const p = await e.admin.patch("/api/parametres-pharmacie", { tauxTva: [{ libelle: "Taux fictif", tauxPdm: 1925 }], delaiAlertePeremption: 60 });
    assert.deepEqual([p.statut, p.corps.delaiAlertePeremption], [200, 60]);
    assert.equal((await e.admin.patch("/api/parametres-pharmacie", { tauxTva: [{ libelle: "Taux A", tauxPdm: 1000 }, { libelle: "Taux B", tauxPdm: 1000 }] })).corps.erreur.code, "taux_double");
    assert.equal((await stock.patch(`/api/produits/${produit.id}`, { tauxTvaPdm: 1925 })).statut, 200);
  });

  test("Changement de prix : historique conservé, intangible ; modification tracée", async () => {
    await stock.patch(`/api/produits/${produit.id}`, { prixVente: 550 });
    await stock.patch(`/api/produits/${produit.id}`, { dosage: "500 mg (sécable)" });   // pas de changement de prix
    const fiche = (await vendeur.get(`/api/produits/${produit.id}`)).corps;
    assert.equal(fiche.prixVente, 550);
    assert.deepEqual(fiche.historiquePrix.map((h: { prixVente: number; tauxTvaPdm: number }) => [h.prixVente, h.tauxTvaPdm]), [[550, 1925], [500, 1925], [500, 0]]);
    await assert.rejects(env.pool.query("UPDATE product_price_history SET sale_price = 1"), /interdit|not allowed|forbid|permission/i);
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "product_update"));
  });

  test("Recherche par nom, DCI, code interne ou code-barres", async () => {
    await stock.post("/api/produits", { nom: "Ibuprofène 400 mg (test)", dci: "Ibuprofène", prixVente: 1000, codeBarres: "3400000000028" });
    const cherche = async (q: string) => (await vendeur.get(`/api/produits?recherche=${encodeURIComponent(q)}`)).corps.elements.map((p: { nom: string }) => p.nom);
    assert.deepEqual(await cherche("parac"), ["Paracétamol 500 mg (test)"]);
    assert.deepEqual(await cherche("ibupro"), ["Ibuprofène 400 mg (test)"]);
    assert.deepEqual(await cherche("3400000000028"), ["Ibuprofène 400 mg (test)"]);
    assert.deepEqual(await cherche(produit.code), ["Paracétamol 500 mg (test)"]);
    assert.equal((await vendeur.get(`/api/produits?categorie=${categorie}`)).corps.total, 1, "filtre par catégorie, familles comprises");
  });

  test("Archivage motivé (jamais de suppression) ; un produit archivé sort des listes et ne se modifie plus", async () => {
    assert.equal((await stock.post(`/api/produits/${produit.id}/statut`, { statut: "archived", motif: "Arrêt de commercialisation" })).statut, 403, "archivage réservé");
    assert.equal((await e.admin.post(`/api/produits/${produit.id}/statut`, { statut: "archived", motif: "" })).statut, 400);
    const r = await e.admin.post(`/api/produits/${produit.id}/statut`, { statut: "archived", motif: "Arrêt de commercialisation (test)" });
    assert.equal(r.corps.statut, "archived");
    assert.ok(!(await vendeur.get("/api/produits")).corps.elements.some((p: { id: string }) => p.id === produit.id));
    assert.ok((await vendeur.get("/api/produits?statut=archived")).corps.elements.some((p: { id: string }) => p.id === produit.id));
    assert.equal((await stock.patch(`/api/produits/${produit.id}`, { prixVente: 600 })).corps.erreur.code, "produit_archive");
    await e.admin.post(`/api/produits/${produit.id}/statut`, { statut: "active", motif: "Remis en vente (test)" });
    await assert.rejects(env.pool.query("DELETE FROM products"), /permission|interdit/i, "aucune suppression possible");
  });
});

describe("Import et export CSV", () => {
  const csv = [
    "nom;dci;categorie;famille;forme;dosage;presentation;fabricant;code_barres;prix_achat;prix_vente;tva;seuil",
    "Amoxicilline 500 mg (test);Amoxicilline;Médicaments;Anti-infectieux;Gélule;500 mg;Boîte de 12;Labo fictif;3400000000035;1 100;1 600;;10",
    "Crème hydratante (test);;Parapharmacie;Soins;Pommade ou crème;;Tube;Labo fictif;;1500;2200;19,25;3",
  ];
  test("Vérification : une ligne fausse bloque tout l'import, avec le numéro de ligne", async () => {
    const r = await stock.post("/api/produits/import", { contenu: [...csv, "Produit sans prix;;;;;;;;;;;;"].join("\n"), verifier: false });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(r.corps.crees, 0);
    assert.equal(r.corps.erreurs[0].ligne, 4);
    assert.match(r.corps.erreurs[0].message, /prixVente/);
    const tvaInconnue = await stock.post("/api/produits/import", { contenu: [csv[0], csv[2].replace("19,25", "5,5")].join("\n") });
    assert.match(tvaInconnue.corps.erreurs[0].message, /TVA « 5,5 »/);
  });

  test("Import réel : produits créés, référentiels manquants créés, prix « 1 100 » compris", async () => {
    const v = await stock.post("/api/produits/import", { contenu: csv.join("\r\n"), verifier: true });
    assert.deepEqual([v.corps.valides, v.corps.erreurs.length, v.corps.crees], [2, 0, 0]);
    const r = await stock.post("/api/produits/import", { contenu: csv.join("\r\n"), verifier: false });
    assert.equal(r.corps.crees, 2);
    const amox = (await vendeur.get("/api/produits?recherche=Amoxicilline")).corps.elements[0];
    assert.deepEqual([amox.prixAchat, amox.prixVente, amox.forme, amox.categorie], [1100, 1600, "Gélule", "Médicaments › Anti-infectieux"]);
    const creme = (await vendeur.get("/api/produits?recherche=Crème")).corps.elements[0];
    assert.equal(creme.tauxTvaPdm, 1925);
    const encore = await stock.post("/api/produits/import", { contenu: csv.join("\n"), verifier: true });
    assert.ok(encore.corps.erreurs.some((x: { message: string }) => /déjà attribué/.test(x.message)), "code-barres déjà présent signalé");
  });

  test("Export CSV du catalogue (tracé) ; réservé à qui a le droit d'exporter", async () => {
    const r = await stock.req("GET", "/api/produits/export");
    assert.equal(r.statut, 200);
    assert.match(r.brut.headers["content-type"] as string, /text\/csv/);
    assert.ok(r.brut.body.startsWith("﻿\"Code\";\"Nom\""));
    assert.ok(r.brut.body.includes("Amoxicilline 500 mg (test)"));
    assert.equal((await vendeur.req("GET", "/api/produits/export")).statut, 403);
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "export" && x.event_type === "catalog"));
  });
});

describe("Isolation des officines", () => {
  test("Une autre officine ne voit ni les produits ni les catégories", async () => {
    const b = await entrepriseActive(env, "CAT-02", { mfa: false });
    assert.equal((await b.admin.get("/api/produits")).corps.total, 0);
    assert.ok(!(await b.admin.get("/api/referentiels/categories")).corps.some((c: { familles: { nom: string }[] }) => c.familles.some((f) => f.nom === "Antalgiques")));
    const ids = (await e.admin.get("/api/produits")).corps.elements.map((p: { id: string }) => p.id);
    assert.equal((await b.admin.get(`/api/produits/${ids[0]}`)).statut, 404);
  });
});
