import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { construireApp } from "../src/http/app.js";
import { Agent, MDP, cfgTest, entrepriseActive, journal, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/**
 * Profil d'entreprise centralisé : toutes les informations saisies dans « Entreprise » se retrouvent dans les
 * nouveaux documents (facture, avoir, reçu, en-tête des états), sans nom codé en dur ; les documents déjà émis
 * gardent l'identité du jour de leur émission ; tout est conservé en base (redémarrage du serveur).
 */
const AUJ = new Date().toISOString().slice(0, 10);
let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
let daf: Agent, caissier: Agent;
let caisse: string;
let imagesSansLogo = 0;   // images d'une facture sans logo ni cachet (le code QR seul)

const image = async (texte: string) => (await QRCode.toBuffer(texte, { width: 160 })).toString("base64");   // un PNG valide quelconque
const vente = (agent: Agent, comptant = true) => agent.post("/api/ventes/factures", {
  date: AUJ, client: { nom: "Client fictif Profil" }, lignes: [{ designation: "Sac de ciment", quantite: 2, prixUnitaire: 5000, nature: "marchandise" }],
  paiement: comptant ? { mode: "comptant", compteTresorerieId: caisse } : { mode: "credit" },
});
/** Texte et nombre d'images d'un PDF (pdftotext, pdfimages). */
function lirePdf(octets: Buffer) {
  const dossier = mkdtempSync(join(tmpdir(), "gc-profil-"));
  try {
    writeFileSync(join(dossier, "d.pdf"), octets);
    const texte = execFileSync("pdftotext", ["-layout", join(dossier, "d.pdf"), "-"]).toString();
    execFileSync("pdfimages", ["-png", join(dossier, "d.pdf"), join(dossier, "img")]);
    const formats = execFileSync("pdfinfo", [join(dossier, "d.pdf")]).toString();
    return { texte, images: readdirSync(dossier).filter((f) => f.startsWith("img")).length, taille: /Page size:\s+([\d.]+) x ([\d.]+)/.exec(formats)?.slice(1).map(Number) };
  } finally { rmSync(dossier, { recursive: true, force: true }); }
}

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "PROFIL-C1", { mfa: false });
  daf = (await utilisateurAvecRole(env, e, "finance_director", "daf@profil-c1.cm")).agent;
  const c = await utilisateurAvecRole(env, e, "cashier", "caisse@profil-c1.cm");
  caissier = c.agent;
  await daf.patch("/api/ventes/parametres", { tvaApplicable: true, tauxTvaPdm: 1925, mentionsFacture: "" });
  caisse = (await daf.post("/api/tresorerie/comptes", { type: "caisse", nom: "Caisse siège" })).corps.id;
  await daf.patch(`/api/tresorerie/comptes/${caisse}`, { caissiers: [c.id] });
});
after(async () => { await env?.fermer(); });

describe("Validation du profil", () => {
  test("Données invalides refusées avec un message clair ; champs facultatifs vides acceptés", async () => {
    const refus = async (corps: object, motif: RegExp) => {
      const r = await e.admin.patch("/api/entreprise", corps);
      assert.equal(r.statut, 400, JSON.stringify(corps));
      assert.match(JSON.stringify(r.corps), motif);
    };
    await refus({ raisonSociale: " " }, /raison sociale est obligatoire/);
    await refus({ email: "contact@" }, /e-mail invalide/);
    await refus({ telephone: "appelez-moi" }, /téléphone invalide/);
    await refus({ telephone2: "12" }, /téléphone invalide/);
    await refus({ siteWeb: "javascript:alert(1)" }, /site web invalide/);
    await refus({ siteWeb: "pas un site" }, /site web invalide/);
    await refus({ dateCreation: "2999-01-01" }, /futur/);
    await refus({ autresIdentifiants: [{ libelle: "CNPS", valeur: "" }] }, /Valeur de l'identifiant manquante/);
    await refus({ moyensPaiement: ["troc"] }, /.+/);
    // Cohérence fiscale : numéro de TVA sans TVA appliquée.
    await daf.patch("/api/ventes/parametres", { tvaApplicable: false, tauxTvaPdm: 0, mentionsFacture: "" });
    await refus({ numeroTva: "TVA-0001" }, /n'applique pas la TVA/);
    await daf.patch("/api/ventes/parametres", { tvaApplicable: true, tauxTvaPdm: 1925, mentionsFacture: "" });
    // Tout facultatif : on peut vider un champ.
    const ok = await e.admin.patch("/api/entreprise", { nomCommercial: "", siteWeb: null, banque: null, moyensPaiement: [] });
    assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
    assert.deepEqual([ok.corps.nomCommercial, ok.corps.siteWeb, ok.corps.banque], [null, null, null]);
    assert.equal((await caissier.patch("/api/entreprise", { raisonSociale: "Pirate SARL" })).statut, 403);
  });

  test("Une valeur saisie avant les contrôles actuels ne bloque pas l'enregistrement des autres champs", async () => {
    await env.superu.query("UPDATE companies SET phone = '+237 600 00 00 00 (fictif)' WHERE id = $1", [e.entrepriseId]);
    const r = await e.admin.patch("/api/entreprise", { telephone: "+237 600 00 00 00 (fictif)", ville: "Douala" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.deepEqual([r.corps.telephone, r.corps.ville], ["+237 600 00 00 00 (fictif)", "Douala"]);
    // Modifiée, la valeur est contrôlée.
    assert.equal((await e.admin.patch("/api/entreprise", { telephone: "+237 600 (nouveau)" })).statut, 400);
  });

  test("Site web normalisé (https://), aucun identifiant inventé quand rien n'est saisi", async () => {
    const r = await e.admin.patch("/api/entreprise", { siteWeb: "www.profil-c1.cm" });
    assert.equal(r.corps.siteWeb, "https://www.profil-c1.cm");
    const id = r.corps.identiteDocument;
    assert.equal(id.raisonSociale, "PROFIL-C1 SARL");
    for (const k of ["niu", "rccm", "numeroContribuable", "numeroTva", "banque", "logoId", "cachetId"]) assert.equal(id[k] ?? null, null, k);
  });
});

describe("Test 1 et 3 : raison sociale et coordonnées dans les nouveaux documents", () => {
  let profil: Record<string, any>;
  test("Le profil complet est enregistré et relu", async () => {
    const r = await e.admin.patch("/api/entreprise", {
      raisonSociale: "Quincaillerie Fictive du Littoral SARL", nomCommercial: "Quincaillerie du Port", sigle: "QFL", slogan: "Le bon outil, au bon prix",
      formeJuridique: "SARL", capitalSocial: 1000000, adresse: "Rue fictive 12", boitePostale: "1234", quartier: "Bonabéri", commune: "Douala 4e", ville: "Douala",
      region: "Littoral", telephone: "+237 600 10 20 30", telephone2: "+237 699 00 00 01", email: "contact@qfl-fictif.cm", siteWeb: "https://qfl-fictif.cm",
      niu: "M000000000099X", rccm: "RC/DLA/2026/B/0099", numeroContribuable: "P000000099", numeroTva: "TVA-FICTIF-99",
      autresIdentifiants: [{ libelle: "CNPS", valeur: "CNPS-FICTIF-001" }], regimeFiscal: "Régime du réel", patente: "PAT-FICTIF-99", referentiel: "syscohada_normal",
      banque: { nom: "Banque Fictive SA", titulaire: "QFL SARL", references: "10005 00001 00000000001 99" }, moyensPaiement: ["especes", "mobile_money", "virement"],
      enTete: "Agréé fournisseur des marchés publics (mention fictive)", piedDePage: "Marchandises vendues ni reprises ni échangées après 8 jours.",
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    profil = r.corps;
    assert.equal(profil.referentiel, "syscohada_normal");
    assert.equal(profil.exercice?.code?.length > 0, true, "exercice en cours affiché");
    // Le nouveau nom est aussitôt celui de la session et de l'apparence (barre de titre, états imprimés).
    assert.equal((await caissier.get("/api/auth/moi")).corps.entreprise.raisonSociale, "Quincaillerie Fictive du Littoral SARL");
    const ap = (await caissier.get("/api/entreprise/apparence")).corps;
    assert.equal(ap.etat.raisonSociale, "Quincaillerie Fictive du Littoral SARL");
    assert.ok(ap.etat.lignes.some((l: string) => l.includes("NIU : M000000000099X")));
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "update" && x.object_type === "company"));
  });

  test("Nouvelle facture : en-tête complet sur la fiche et dans le PDF, pied de page et banque", async () => {
    const f = (await vente(caissier)).corps;
    const v = f.vendeur;
    assert.deepEqual([v.raisonSociale, v.nomCommercial, v.sigle, v.siteWeb, v.telephone, v.localite, v.pays],
      ["Quincaillerie Fictive du Littoral SARL", "Quincaillerie du Port", "QFL", "https://qfl-fictif.cm", "+237 600 10 20 30 / +237 699 00 00 01", "Bonabéri, Douala 4e, Douala", "Cameroun"]);
    const pdf = lirePdf((await caissier.req("GET", `/api/ventes/factures/${f.id}/pdf`)).brut.rawPayload);
    for (const attendu of ["Quincaillerie Fictive du Littoral SARL", "QFL · Quincaillerie du Port", "Le bon outil, au bon prix", "SARL au capital de 1 000 000 FCFA",
      "Agréé fournisseur", "Rue fictive 12", "BP 1234 · Bonabéri, Douala 4e, Douala", "Littoral, Cameroun", "Tél. : +237 600 10 20 30 / +237 699 00 00 01",
      "contact@qfl-fictif.cm", "qfl-fictif.cm", "NIU : M000000000099X", "RCCM : RC/DLA/2026/B/0099", "N° contribuable : P000000099", "N° TVA : TVA-FICTIF-99",
      "CNPS : CNPS-FICTIF-001", "Patente : PAT-FICTIF-99", "ni reprises ni échangées", "Banque : Banque Fictive SA", "Moyens de paiement acceptés : Espèces, Mobile money, Virement bancaire"])
      assert.ok(pdf.texte.includes(attendu), `« ${attendu} » absent du PDF :\n${pdf.texte}`);
    assert.ok(!/PROFIL-C1 SARL|ITI D[ée]monstration/.test(pdf.texte), "ni l'ancien nom ni un nom fictif codé en dur");
    assert.ok(!pdf.texte.includes("https://"), "site affiché sans le préfixe technique");
    imagesSansLogo = pdf.images;
  });

  test("Reçu de caisse : même identité, montant en chiffres et en lettres", async () => {
    const m = (await caissier.post("/api/tresorerie/mouvements", { compteTresorerieId: caisse, sens: "entree", montant: 7500, date: AUJ,
      libelle: "Vente comptoir (fictive)", categorie: "autre_produit" }));
    assert.equal(m.statut, 200, JSON.stringify(m.corps));
    assert.equal(m.corps.emetteur.raisonSociale, "Quincaillerie Fictive du Littoral SARL");
    const r = await caissier.req("GET", `/api/tresorerie/mouvements/${m.corps.id}/recu`);
    assert.deepEqual([r.statut, r.brut.headers["content-type"]], [200, "application/pdf"]);
    const pdf = lirePdf(r.brut.rawPayload);
    for (const attendu of ["REÇU", m.corps.reference, "Quincaillerie Fictive du Littoral SARL", "qfl-fictif.cm", "7 500 FCFA", "Sept mille cinq cents", "Vente comptoir (fictive)", "Caisse siège"])
      assert.ok(pdf.texte.toLowerCase().includes(attendu.toLowerCase()), `« ${attendu} » absent du reçu :\n${pdf.texte}`);
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "receipt_pdf"));
  });

  test("Options d'affichage : téléphone, site et banque masqués sur les nouveaux documents ; format Lettre", async () => {
    await e.admin.patch("/api/entreprise", { affichage: { telephone: false, siteWeb: false, banque: false }, formatPapier: "LETTER" });
    const f = (await vente(caissier)).corps;
    assert.deepEqual([f.vendeur.telephone, f.vendeur.siteWeb, f.vendeur.banque], [null, null, null]);
    const pdf = lirePdf((await caissier.req("GET", `/api/ventes/factures/${f.id}/pdf`)).brut.rawPayload);
    assert.ok(!pdf.texte.includes("+237 600 10 20 30") && !/^\s*qfl-fictif\.cm\s*$/m.test(pdf.texte) && !pdf.texte.includes("Banque Fictive"), pdf.texte);
    assert.deepEqual(pdf.taille, [612, 792], "format Lettre US");
    await e.admin.patch("/api/entreprise", { affichage: { telephone: true, siteWeb: true, banque: true }, formatPapier: "A4" });
  });
});

describe("Test 2 et 5 : logo, cachet et persistance après redémarrage", () => {
  let logo: string;
  test("Logo et cachet importés, imprimés sur la facture", async () => {
    logo = (await e.admin.post("/api/entreprise/logo", { image: await image("logo QFL") })).corps.logoId;
    const cachet = await e.admin.post("/api/entreprise/cachet", { image: await image("cachet QFL") });
    assert.equal(cachet.statut, 200, JSON.stringify(cachet.corps));
    assert.equal((await e.admin.post("/api/entreprise/cachet", { image: Buffer.from("<svg/>").toString("base64") })).corps.erreur.code, "cachet_format");
    const f = (await vente(caissier)).corps;
    assert.deepEqual([f.vendeur.logoId, f.vendeur.cachetId, !!f.vendeur.logoUrl, !!f.vendeur.cachetUrl], [logo, cachet.corps.cachetId, true, true]);
    const pdf = lirePdf((await caissier.req("GET", `/api/ventes/factures/${f.id}/pdf`)).brut.rawPayload);
    assert.ok(pdf.texte.includes("Cachet et signature"));
    assert.ok(pdf.images >= imagesSansLogo + 2, `logo, QR et cachet : ${pdf.images} image(s) contre ${imagesSansLogo} sans logo`);
  });

  test("Serveur redémarré : profil, logo et cachet toujours là (stockés en base)", async () => {
    // Nouvelle instance du serveur sur la même base, comme après une fermeture du logiciel ou un redémarrage de l'ordinateur.
    const app2 = construireApp({ pool: env.pool, cfg: cfgTest });
    await app2.ready();
    try {
      const admin2 = new Agent(app2);
      assert.equal((await admin2.post("/api/auth/connexion", { codeEntreprise: "PROFIL-C1", email: e.email, motDePasse: MDP })).statut, 200);
      const p = (await admin2.get("/api/entreprise")).corps;
      assert.deepEqual([p.raisonSociale, p.nomCommercial, p.siteWeb, p.ville, p.logoId, !!p.cachetId, p.banque?.nom, p.moyensPaiement.length],
        ["Quincaillerie Fictive du Littoral SARL", "Quincaillerie du Port", "https://qfl-fictif.cm", "Douala", logo, true, "Banque Fictive SA", 3]);
      const img = await admin2.req("GET", p.logoUrl);
      assert.deepEqual([img.statut, img.brut.headers["content-type"]], [200, "image/png"]);
    } finally { await app2.close(); }
  });

  test("Logo et cachet retirés : plus aucune image sur les nouveaux documents (pas de logo fictif)", async () => {
    await e.admin.del("/api/entreprise/logo");
    await e.admin.del("/api/entreprise/cachet");
    const f = (await vente(caissier)).corps;
    assert.deepEqual([f.vendeur.logoId ?? null, f.vendeur.cachetId ?? null, f.vendeur.logoUrl], [null, null, null]);
    const pdf = lirePdf((await caissier.req("GET", `/api/ventes/factures/${f.id}/pdf`)).brut.rawPayload);
    assert.equal(pdf.images, imagesSansLogo, "seul le QR de vérification");
    assert.ok(!pdf.texte.includes("Cachet et signature"));
  });
});

describe("Test 6 : historique des documents émis", () => {
  test("Facture, avoir et reçu émis gardent l'identité du jour ; les nouveaux prennent la nouvelle", async () => {
    const ancienne = (await vente(caissier)).corps;
    const { rows: [mvt] } = await env.superu.query("SELECT id FROM treasury_movements WHERE invoice_id = $1", [ancienne.id]);
    await e.admin.patch("/api/entreprise", { raisonSociale: "Nouvelle Raison Fictive SA", formeJuridique: "SA", adresse: "Avenue fictive 1", siteWeb: "nouveau-fictif.cm" });

    const relue = (await caissier.get(`/api/ventes/factures/${ancienne.id}`)).corps;
    assert.deepEqual([relue.vendeur.raisonSociale, relue.vendeur.adresse], ["Quincaillerie Fictive du Littoral SARL", "Rue fictive 12"]);
    const pdfAncien = lirePdf((await caissier.req("GET", `/api/ventes/factures/${ancienne.id}/pdf`)).brut.rawPayload);
    assert.ok(pdfAncien.texte.includes("Quincaillerie Fictive du Littoral SARL") && !pdfAncien.texte.includes("Nouvelle Raison"));
    const recuAncien = lirePdf((await caissier.req("GET", `/api/tresorerie/mouvements/${mvt.id}/recu`)).brut.rawPayload);
    assert.ok(recuAncien.texte.includes("Quincaillerie Fictive du Littoral SARL"), "le reçu de l'époque garde son identité");

    const nouvelle = (await vente(caissier)).corps;
    assert.deepEqual([nouvelle.vendeur.raisonSociale, nouvelle.vendeur.formeJuridique, nouvelle.vendeur.siteWeb], ["Nouvelle Raison Fictive SA", "SA", "https://nouveau-fictif.cm"]);
    const av = await daf.post(`/api/ventes/factures/${ancienne.id}/avoirs`, { date: AUJ, motif: "Retour fictif", lignes: [{ ordre: 1, quantite: 1 }] });
    assert.equal(av.statut, 200, JSON.stringify(av.corps));
    assert.equal(av.corps.vendeur.raisonSociale, "Nouvelle Raison Fictive SA", "un avoir émis aujourd'hui porte l'identité d'aujourd'hui");
    // Les identités figées ne sont pas modifiables en base.
    await assert.rejects(env.pool.query("UPDATE invoices SET seller = '{}'"), /interdit|not allowed|forbid|permission/i);
    await assert.rejects(env.pool.query("UPDATE treasury_movements SET issuer = '{}'"), /interdit|not allowed|forbid|permission/i);
  });
});

describe("Plusieurs entreprises", () => {
  test("Modifier le profil d'une entreprise ne touche pas celui d'une autre", async () => {
    const b = await entrepriseActive(env, "PROFIL-C2", { mfa: false });
    await b.admin.patch("/api/entreprise", { raisonSociale: "Autre Entreprise Fictive", siteWeb: "autre-fictif.cm" });
    assert.equal((await e.admin.get("/api/entreprise")).corps.raisonSociale, "Nouvelle Raison Fictive SA");
    assert.equal((await b.admin.get("/api/entreprise")).corps.siteWeb, "https://autre-fictif.cm");
    // Le logo d'une entreprise n'est pas lisible par une autre (isolation par la base).
    const l = (await e.admin.post("/api/entreprise/logo", { image: await image("logo A") })).corps.logoId;
    assert.equal((await b.admin.req("GET", `/api/entreprise/logos/${l}`)).statut, 404);
  });
});
