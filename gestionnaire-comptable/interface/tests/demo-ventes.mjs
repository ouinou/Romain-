// Test de fumée de la DÉMONSTRATION hors serveur (fichier unique) : ventes, facture, caisse, validation par lots.
// Usage : node tests/demo-ventes.mjs <fichier-demo.html> <dossier-captures>
import { chromium } from "playwright";
import assert from "node:assert/strict";
const [fichier, DOSSIER = "/tmp/captures-demo"] = process.argv.slice(2);
const navigateur = await chromium.launch({ executablePath: process.env.GC_CHROMIUM });
const page = await navigateur.newPage({ viewport: { width: 1366, height: 860 } });
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(e.message));
page.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));
const etape = (t) => console.log("✓ " + t);
const menu = (t) => page.getByRole("navigation").getByRole("link", { name: t, exact: true });
async function connexion(email) {
  await page.getByLabel("Code entreprise").fill("GC-DEMO-2026");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("Demonstration-2026!");
  await page.getByRole("button", { name: "Se connecter" }).click();
}
try {
  await page.goto("file://" + fichier);
  await connexion("amina.mahamat@demo.cm");
  await menu("Caisses et banques").click();
  await page.getByText("100 000").first().waitFor();
  assert.equal(await page.getByText("Banque fictive").count(), 0);
  etape("caissière : sa caisse seulement, fonds initial 100 000");
  await menu("Nouvelle vente").click();
  await page.getByLabel("Client").fill("Établissements Fictifs Mbarga");
  await page.getByLabel("Désignation de la ligne 1").fill("Cartouche d'encre");
  await page.getByLabel("Quantité de la ligne 1").fill("3");
  await page.getByLabel("Prix unitaire de la ligne 1").fill("15000");
  await page.getByRole("button", { name: "+ Ajouter une ligne" }).click();
  await page.getByLabel("Désignation de la ligne 2").fill("Installation");
  await page.getByLabel("Nature de la ligne 2").selectOption("service");
  await page.getByLabel("Prix unitaire de la ligne 2").fill("10000");
  await page.getByRole("button", { name: /Émettre la facture/ }).click();
  await page.getByRole("heading", { name: new RegExp(`Facture FAC-${new Date().getFullYear()}-00001`) }).waitFor();
  await page.getByText("Soixante-cinq mille cinq cent quatre-vingt-huit francs CFA").waitFor();
  await page.screenshot({ path: `${DOSSIER}/demo-facture.png` });
  etape("caissière : vente comptant, facture n° 1, 65 588 FCFA en lettres");
  await menu("Caisses et banques").click();
  await page.getByRole("button", { name: "− Dépense" }).click();
  await page.getByLabel("Catégorie").selectOption({ label: "Fournitures et petits achats" });
  await page.getByLabel("Montant").fill("5000");
  await page.getByLabel("Libellé").fill("Ramettes de papier");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.getByText("160 588").first().waitFor();
  await page.getByRole("button", { name: "− Dépense" }).click();
  await page.getByLabel("Montant").fill("999999");
  await page.getByLabel("Libellé").fill("Trop");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.getByText(/Solde de caisse insuffisant/).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  await page.screenshot({ path: `${DOSSIER}/demo-caisse.png` });
  etape("caissière : dépense, solde 160 588 ; caisse jamais négative");
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await connexion("ousmane.djibrine@demo.cm");
  await menu("Écritures").click();
  await page.getByLabel("Origine").selectOption({ label: "Ventes et trésorerie" });
  await page.getByLabel("État").selectOption({ label: "Brouillards" });
  await page.getByRole("button", { name: /Tout sélectionner/ }).click();
  await page.getByRole("button", { name: /Valider la sélection/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Valider" }).click();
  const mdp = page.getByRole("dialog").getByLabel(/Mot de passe/);
  await mdp.waitFor();
  await mdp.fill("Demonstration-2026!");
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer" }).click();
  await page.getByText(/3 écriture\(s\) validée\(s\), 1 refusée\(s\) : Séparation des tâches/).waitFor();
  await page.screenshot({ path: `${DOSSIER}/demo-validation.png` });
  etape("DAF : validation par lots (3 validées), son fonds de caisse refusé");
  assert.deepEqual(erreurs.filter((e) => !/status of 40[0-9]/.test(e)), []);
  etape("aucune erreur JavaScript");
} catch (e) {
  await page.screenshot({ path: `${DOSSIER}/demo-echec.png`, fullPage: true }).catch(() => {});
  console.error("✗ " + e.message.split("\n")[0]); process.exitCode = 1;
} finally { await navigateur.close(); }
