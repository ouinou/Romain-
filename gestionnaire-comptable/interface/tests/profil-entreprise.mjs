/**
 * Profil d'entreprise centralisé, dans un vrai navigateur, contre un vrai serveur (base de démonstration).
 *
 *   Phase 1 : GC_URL=… node tests/profil-entreprise.mjs modifier [dossier]
 *     facture émise AVANT le changement, modification du profil (nom, nom commercial, coordonnées, site web, logo,
 *     pied de page), nouvelle facture, reçu de caisse, en-tête des états imprimés (balance, grand livre, écritures).
 *   Redémarrer le serveur SANS réinitialiser la base (fermeture du logiciel).
 *   Phase 2 : GC_URL=… node tests/profil-entreprise.mjs verifier [dossier]
 *     le profil, le logo et les identités figées des factures sont toujours là.
 *
 * Données fictives uniquement. Échoue au premier écart ; enregistre des captures.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const URL_BASE = process.env.GC_URL ?? "http://localhost:8443";
const MDP = process.env.GC_DEMO_MOT_DE_PASSE ?? "Demonstration-2026!";
const PHASE = process.argv[2];
const DOSSIER = process.argv[3] ?? "captures";
mkdirSync(DOSSIER, { recursive: true });
const ETAT = `${DOSSIER}/profil-etat.json`;
const NOUVEAU = "Boulangerie Fictive de Bonapriso SARL", ANCIEN = "Entreprise Démo SARL";

const navigateur = await chromium.launch(process.env.GC_CHROMIUM ? { executablePath: process.env.GC_CHROMIUM } : {});
const erreursConsole = [];
const etape = (t) => console.log(`✓ ${t}`);
const capture = async (page, nom, pleine = true) => page.screenshot({ path: `${DOSSIER}/profil-${PHASE}-${nom}.png`, fullPage: pleine });

async function session(email) {
  const ctx = await navigateur.newContext({ viewport: { width: 1366, height: 860 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[0-9]/.test(m.text())) erreursConsole.push(m.text()); });
  page.on("pageerror", (e) => erreursConsole.push(String(e)));
  await page.goto(URL_BASE + "/");
  await page.getByLabel("Code entreprise").fill("GC-DEMO-2026");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(MDP);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("heading", { name: /Bonjour/ }).waitFor();
  return page;
}
/** Appel de l'API avec la session du navigateur (comme l'interface). */
const appel = (page, methode, url, corps) => page.evaluate(async ([m, u, c]) => {
  const r = await fetch(u, { method: m, credentials: "same-origin", headers: { "content-type": "application/json", "x-gc-requete": "1" }, body: c ? JSON.stringify(c) : undefined });
  return { statut: r.status, corps: await r.json() };
}, [methode, url, corps]);
/** Texte d'un PDF servi par le serveur (pdftotext) ; la première page est aussi enregistrée en image. */
async function textePdf(page, url, nom) {
  const b64 = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "same-origin" });
    if (!r.ok || r.headers.get("content-type") !== "application/pdf") throw new Error(`PDF ${u} : ${r.status}`);
    const o = new Uint8Array(await r.arrayBuffer()); let s = ""; for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000));
    return btoa(s);
  }, url);
  const f = `${DOSSIER}/profil-${PHASE}-${nom}.pdf`;
  writeFileSync(f, Buffer.from(b64, "base64"));
  try { execFileSync("pdftoppm", ["-png", "-r", "70", "-f", "1", "-l", "1", f, f.replace(/\.pdf$/, "")]); } catch { /* image facultative */ }
  return execFileSync("pdftotext", ["-layout", f, "-"]).toString();
}
const vente = (page, client) => appel(page, "POST", "/api/ventes/factures", {
  date: new Date().toISOString().slice(0, 10), client: { nom: client }, lignes: [{ designation: "Pain de mie (fictif)", quantite: 10, prixUnitaire: 500, nature: "marchandise" }], paiement: { mode: "credit" } });

try {
  if (PHASE === "modifier") {
    const daf = await session("ousmane.djibrine@demo.cm");
    if (process.env.GC_TRACE) daf.on("request", (r) => r.url().includes("/api/") && console.log("  [daf]", new Date().toISOString().slice(11, 23), r.method(), r.url().replace(URL_BASE, "")));
    if (process.env.GC_TRACE) daf.on("framenavigated", (f) => console.log("  [daf] nav", new Date().toISOString().slice(11, 23), f.url()));
    const ancienne = await vente(daf, "Client fictif avant changement");
    assert.equal(ancienne.statut, 200, JSON.stringify(ancienne.corps));
    assert.equal(ancienne.corps.vendeur.raisonSociale, ANCIEN);
    etape("facture émise avant la modification du profil");

    // --- Administratrice : profil complet
    const adm = await session("mariam.saleh@demo.cm");
    await adm.goto(URL_BASE + "/#/entreprise");
    await adm.getByLabel("Raison sociale").fill(NOUVEAU);
    await adm.getByLabel("Nom commercial").fill("Pain Doré (fictif)");
    await adm.getByLabel("Slogan").fill("Du bon pain chaque matin");
    await capture(adm, "1-identite");
    await adm.getByRole("tab", { name: "Coordonnées" }).click();
    await adm.getByLabel("Quartier").fill("Bonapriso");
    await adm.getByLabel("Téléphone principal").fill("+237 699 11 22 33");
    await adm.getByLabel("Adresse e-mail professionnelle").fill("contact@paindore-fictif.cm");
    await adm.getByLabel("Site web officiel").fill("www.paindore-fictif.cm");
    // Contrôle de format : un e-mail invalide est refusé avec un message clair, sur le bon champ.
    await adm.getByLabel("Adresse e-mail professionnelle").fill("contact@");
    await adm.getByRole("button", { name: "Enregistrer le profil" }).click();
    await adm.getByRole("button", { name: "Enregistrer", exact: true }).click();   // confirmation (raison sociale modifiée)
    await adm.getByText("Adresse e-mail invalide (exemple : contact@monentreprise.cm).").waitFor();
    await capture(adm, "2-erreur-email");
    await adm.getByLabel("Adresse e-mail professionnelle").fill("contact@paindore-fictif.cm");
    await adm.getByRole("tab", { name: "Banque et paiement" }).click();
    await adm.getByLabel("Espèces").check();
    await adm.getByLabel("Mobile money").check();
    await adm.getByRole("tab", { name: "Documents" }).click();
    await adm.getByLabel("Pied de page").fill("Merci de votre confiance (mention fictive).");
    await adm.getByRole("button", { name: "Enregistrer le profil" }).click();
    await adm.getByRole("heading", { name: "Enregistrer ces changements ?" }).waitFor();
    await adm.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await adm.getByText(/Profil enregistré\. Les prochains documents/).waitFor();
    // Logo : image fictive dessinée pour le test.
    const dessin = await (await navigateur.newContext({ viewport: { width: 200, height: 200 } })).newPage();
    await dessin.setContent(`<div id="l" style="width:160px;height:160px;border-radius:80px;background:#8a4b08;color:#fff3c4;font:900 56px sans-serif;display:grid;place-items:center">PD</div>`);
    await dessin.locator("#l").screenshot({ path: `${DOSSIER}/logo-profil.png` });
    await dessin.context().close();
    await adm.getByLabel("Fichier du logo (PNG ou JPEG)").setInputFiles(`${DOSSIER}/logo-profil.png`);
    await adm.getByText(/Logo enregistré/).waitFor();
    await adm.locator(".apercu-entete img.logo-document").waitFor();
    assert.equal(await adm.locator(".barre-titre .nom-entreprise").textContent(), NOUVEAU, "barre de titre mise à jour sans reconnexion");
    const apercu = await adm.locator(".apercu-entete").innerText();
    for (const t of [NOUVEAU, "Pain Doré (fictif)", "Bonapriso, Douala", "Tél. : +237 699 11 22 33", "paindore-fictif.cm", "Merci de votre confiance", "Moyens de paiement acceptés : Espèces, Mobile money"])
      assert.ok(apercu.includes(t), `« ${t} » absent de l'aperçu : ${apercu}`);
    await capture(adm, "3-documents");
    etape("profil modifié (identité, coordonnées, site web, paiement, pied de page, logo) ; contrôle de l'e-mail ; barre de titre à jour");

    // --- Nouvelle facture : nouvelle identité ; l'ancienne garde la sienne
    const nouvelle = await vente(daf, "Client fictif après changement");
    assert.equal(nouvelle.statut, 200);
    await daf.goto(URL_BASE + `/#/ventes/factures/${nouvelle.corps.id}`);
    const fiche = daf.locator(".apercu-facture");
    await fiche.locator("img.logo-document").waitFor();
    // Le DAF était connecté pendant la modification : son écran se met à jour au changement de page, sans reconnexion.
    await daf.waitForFunction((nom) => document.querySelector(".barre-titre .nom-entreprise")?.textContent === nom, NOUVEAU, { timeout: 5000 })
      .catch(() => { throw new Error("barre de titre du DAF non mise à jour après la modification du profil par l'administratrice"); });
    assert.ok(await fiche.locator("img.logo-document").evaluate((i) => i.complete && i.naturalWidth > 0), "logo chargé");
    const texteFiche = await fiche.innerText();
    for (const t of [NOUVEAU, "Pain Doré (fictif)", "paindore-fictif.cm", "+237 699 11 22 33", "Merci de votre confiance"]) assert.ok(texteFiche.includes(t), `« ${t} » absent de la facture`);
    assert.ok(!texteFiche.includes(ANCIEN), "l'ancien nom a disparu de la nouvelle facture");
    await capture(daf, "4-nouvelle-facture");
    const pdf = await textePdf(daf, `/api/ventes/factures/${nouvelle.corps.id}/pdf`, "nouvelle-facture");
    for (const t of [NOUVEAU, "Pain Doré (fictif)", "paindore-fictif.cm", "Merci de votre confiance"]) assert.ok(pdf.includes(t), `« ${t} » absent du PDF`);
    assert.ok(!pdf.includes(ANCIEN));
    await daf.goto(URL_BASE + `/#/ventes/factures/${ancienne.corps.id}`);
    await daf.locator(".apercu-facture").getByText("Client fictif avant changement").waitFor();
    const texteAncienne = await daf.locator(".apercu-facture").innerText();
    assert.ok(texteAncienne.includes(ANCIEN) && !texteAncienne.includes(NOUVEAU), "la facture déjà émise garde l'identité du jour de son émission");
    await daf.getByText(/L'en-tête reprend le profil de l'entreprise au jour de l'émission/).waitFor();
    etape("nouvelle facture (écran et PDF) avec la nouvelle identité et le logo ; facture antérieure inchangée");

    // --- Reçu de caisse
    const comptes = (await appel(daf, "GET", "/api/tresorerie/comptes")).corps;
    const banque = comptes.find((c) => c.type === "banque" || c.type === "bank") ?? comptes[0];
    const mvt = await appel(daf, "POST", "/api/tresorerie/mouvements", { compteTresorerieId: banque.id, sens: "entree", montant: 12500, date: new Date().toISOString().slice(0, 10),
      libelle: "Recette fictive de test", categorie: "autre_produit" });
    assert.equal(mvt.statut, 200, JSON.stringify(mvt.corps));
    await daf.goto(URL_BASE + `/#/tresorerie/mouvements/${mvt.corps.id}`);
    await daf.getByRole("button", { name: /Imprimer le reçu/ }).waitFor();
    await daf.getByText(`${NOUVEAU} · profil de l'entreprise au jour de l'opération`).waitFor();
    const recu = await textePdf(daf, `/api/tresorerie/mouvements/${mvt.corps.id}/recu`, "recu");
    for (const t of ["REÇU", NOUVEAU, "paindore-fictif.cm", "12 500 FCFA", "Recette fictive de test"]) assert.ok(recu.includes(t), `« ${t} » absent du reçu :\n${recu}`);
    etape("reçu de caisse en PDF avec l'identité du profil");

    // --- États imprimés : en-tête de l'entreprise, titre, période, date d'édition
    await daf.emulateMedia({ media: "print" });
    for (const [chemin, titre, periode] of [["/comptabilite/balance", "Balance générale", /Exercice \d{4} · du/], ["/comptabilite/grand-livre", "Grand livre", /Exercice \d{4} · du/],
      ["/comptabilite/ecritures", "Écritures", /Tous les journaux · Tous les exercices/]]) {
      await daf.goto(URL_BASE + "/#" + chemin);
      const entete = daf.locator(".entete-impression");
      await entete.waitFor();
      await daf.waitForFunction((nom) => document.querySelector(".entete-impression .nom")?.textContent === nom, NOUVEAU, { timeout: 5000 })
        .catch(() => { throw new Error(`en-tête de ${chemin} non mis à jour : « ${NOUVEAU} » attendu`); });
      await daf.waitForFunction(() => document.querySelector(".entete-impression .droite")?.textContent?.includes("Exercice") || document.querySelector(".entete-impression .droite")?.textContent?.includes("journaux"));
      const t = await entete.innerText();
      assert.ok(t.includes(NOUVEAU) && t.includes("NIU : ") && t.includes(titre) && periode.test(t) && /Édité le .* par Ousmane Djibrine/.test(t), `en-tête ${chemin} : ${t}`);
      await capture(daf, `5-impression-${chemin.split("/").pop()}`);
    }
    await daf.emulateMedia({ media: "screen" });
    assert.equal(await daf.locator(".entete-impression").isVisible(), false, "en-tête d'impression invisible à l'écran");
    etape("balance, grand livre et écritures imprimés avec l'en-tête de l'entreprise, la période et la date d'édition");

    writeFileSync(ETAT, JSON.stringify({ ancienne: ancienne.corps.id, nouvelle: nouvelle.corps.id }));
  } else if (PHASE === "verifier") {
    const { ancienne, nouvelle } = JSON.parse(readFileSync(ETAT, "utf8"));
    const adm = await session("mariam.saleh@demo.cm");
    assert.equal(await adm.locator(".barre-titre .nom-entreprise").textContent(), NOUVEAU);
    await adm.locator(".barre-titre img.logo-entreprise").waitFor();
    await adm.goto(URL_BASE + "/#/entreprise");
    assert.equal(await adm.getByLabel("Raison sociale").inputValue(), NOUVEAU);
    assert.equal(await adm.getByLabel("Nom commercial").inputValue(), "Pain Doré (fictif)");
    await adm.getByRole("tab", { name: "Coordonnées" }).click();
    assert.equal(await adm.getByLabel("Site web officiel").inputValue(), "https://www.paindore-fictif.cm");
    assert.equal(await adm.getByLabel("Téléphone principal").inputValue(), "+237 699 11 22 33");
    await adm.getByRole("tab", { name: "Documents" }).click();
    const logo = adm.locator(".cadre-logo img").first();
    await logo.waitFor();
    assert.ok(await logo.evaluate((i) => i.complete && i.naturalWidth > 0), "logo toujours présent après redémarrage");
    await capture(adm, "1-profil-apres-redemarrage");
    etape("après redémarrage du serveur : profil, site web, téléphone et logo conservés");

    const daf = await session("ousmane.djibrine@demo.cm");
    assert.equal((await appel(daf, "GET", `/api/ventes/factures/${ancienne}`)).corps.vendeur.raisonSociale, ANCIEN);
    assert.equal((await appel(daf, "GET", `/api/ventes/factures/${nouvelle}`)).corps.vendeur.raisonSociale, NOUVEAU);
    const encore = await vente(daf, "Client fictif après redémarrage");
    assert.equal(encore.corps.vendeur.raisonSociale, NOUVEAU);
    assert.ok(encore.corps.vendeur.logoUrl, "le logo est toujours repris sur les nouvelles factures");
    etape("après redémarrage : identités figées intactes, nouvelle facture avec le profil actuel et le logo");
  } else throw new Error("Phase attendue : modifier ou verifier");
  assert.deepEqual(erreursConsole, [], "erreurs JavaScript");
  etape("aucune erreur JavaScript");
} catch (e) {
  console.error("✗", e.message);
  process.exitCode = 1;
} finally { await navigateur.close(); }
