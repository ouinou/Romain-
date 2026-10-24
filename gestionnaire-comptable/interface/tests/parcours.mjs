/**
 * Parcours de bout en bout dans un vrai navigateur, contre un vrai serveur et une base de démonstration.
 *
 *   1. Dans serveur/ : GC_MODE_DEMO=oui npm run demo:initialiser   (base neuve)
 *   2. Lancer le serveur (npm run demarrer)
 *   3. Ici : GC_URL=http://localhost:8443 node tests/parcours.mjs [dossier-captures]
 *
 * Échoue au premier écart ; enregistre des captures d'écran de chaque étape.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const URL_BASE = process.env.GC_URL ?? "http://localhost:8443";
const MDP = process.env.GC_DEMO_MOT_DE_PASSE ?? "Demonstration-2026!";
const DOSSIER = process.argv[2] ?? "captures";
mkdirSync(DOSSIER, { recursive: true });

const navigateur = await chromium.launch(process.env.GC_CHROMIUM ? { executablePath: process.env.GC_CHROMIUM } : {});
const erreursConsole = [];
let n = 0;
const etape = (t) => console.log(`✓ ${t}`);
const capture = async (page, nom) => page.screenshot({ path: `${DOSSIER}/${String(++n).padStart(2, "0")}-${nom}.png`, fullPage: true });

async function nouvellePage(largeur = 1366, hauteur = 860) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") erreursConsole.push(m.text()); });
  page.on("pageerror", (e) => erreursConsole.push(String(e)));
  return page;
}

/** Lien du menu principal (évite les liens homonymes dans la page). */
// Les groupes du menu latéral se replient : includeHidden permet de vérifier qu'une entrée existe (droits),
// et ouvrir() déplie son groupe si besoin avant de cliquer.
const nav = (page) => page.getByRole("navigation", { name: "Navigation principale" });
const menu = (page, nom) => nav(page).getByRole("link", { name: nom, exact: true, includeHidden: true });
async function ouvrir(page, nom) {
  const lien = menu(page, nom);
  if (!(await lien.isVisible())) await nav(page).getByRole("button", { name: await lien.getAttribute("data-groupe"), exact: true }).click();
  await lien.click();
}

async function connexion(page, email, mdp = MDP) {
  await page.goto(URL_BASE + "/");
  await page.getByLabel("Code entreprise").fill("GC-DEMO-2026");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(mdp);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

try {
  // --- Administratrice
  const p = await nouvellePage();
  await page0(p);
  async function page0(page) {
    await page.goto(URL_BASE + "/");
    await page.getByRole("heading", { name: "Connexion" }).waitFor();
    await capture(page, "connexion");
    await connexion(page, "mariam.saleh@demo.cm", "mauvais-mot-de-passe");
    await page.getByRole("alert").filter({ hasText: "incorrect" }).waitFor();
    etape("mauvais mot de passe : message générique affiché");
    await page.getByLabel("Mot de passe").fill(MDP);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.getByRole("heading", { name: /Bonjour Mariam/ }).waitFor();
    await page.locator(".indicateur .val").first().waitFor();
    await capture(page, "tableau-de-bord");
    etape("connexion et tableau de bord");
  }

  await ouvrir(p, "Utilisateurs");
  await p.getByRole("cell", { name: /Paul Ngaro/ }).waitFor();
  await capture(p, "utilisateurs");
  await p.getByPlaceholder("Rechercher un nom ou un e-mail…").fill("amina");
  await p.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  etape("recherche d'utilisateurs");
  await p.getByPlaceholder("Rechercher un nom ou un e-mail…").fill("");
  await p.getByRole("cell", { name: /Jean Bemba/ }).click();
  await p.getByRole("heading", { name: "Jean Bemba" }).waitFor();
  await capture(p, "fiche-utilisateur");

  // Opération sensible : désactivation → motif → confirmation par mot de passe demandée par le serveur
  await p.getByRole("button", { name: "Désactiver" }).click();
  await p.getByLabel("Motif *").fill("Fin de contrat (démonstration)");
  await p.getByRole("button", { name: "Désactiver le compte" }).click();
  await p.getByRole("dialog", { name: "Confirmez votre identité" }).waitFor();
  await capture(p, "confirmation-identite");
  await p.getByRole("dialog", { name: "Confirmez votre identité" }).getByLabel("Mot de passe").fill(MDP);
  await p.getByRole("button", { name: "Confirmer" }).click();
  await p.locator(".badge", { hasText: "Désactivé" }).first().waitFor();
  etape("désactivation avec motif et confirmation par mot de passe");

  // Création d'un compte avec rôle → code d'invitation affiché une fois
  await ouvrir(p, "Utilisateurs");
  await p.getByRole("button", { name: "+ Ajouter un utilisateur" }).click();
  await p.getByLabel("Nom complet").fill("Brigitte Essomba");
  await p.getByLabel("Adresse e-mail professionnelle").fill("brigitte.essomba@demo.cm");
  await p.getByRole("dialog").getByLabel("Caissier").check();
  await p.getByRole("button", { name: "Créer et générer l'invitation" }).click();
  await p.getByRole("dialog", { name: /Code d'invitation de Brigitte/ }).waitFor();
  const codeInvitation = (await p.locator(".secret").innerText()).trim();
  assert.ok(codeInvitation.length > 20);
  await capture(p, "code-invitation");
  await p.getByRole("button", { name: "J'ai remis le code" }).click();
  etape("création d'un compte et code d'invitation");

  // Rôle personnalisé copié du Caissier, puis modification de la grille
  await ouvrir(p, "Rôles et permissions");
  await p.getByRole("cell", { name: /Comptable/ }).first().waitFor();
  await capture(p, "roles");
  await p.getByRole("button", { name: "+ Créer un rôle" }).click();
  await p.getByLabel("Nom du rôle").fill("Caissier principal");
  await p.getByLabel("Partir des permissions de…").selectOption({ label: "Caissier" });
  await p.getByRole("button", { name: "Créer", exact: true }).click();
  await p.getByRole("heading", { name: "Caissier principal" }).waitFor();
  await p.getByLabel("Caisse : Valider").check();
  await p.getByRole("button", { name: /Enregistrer \(1\)/ }).click();
  await p.getByLabel("Motif *").fill("Validation des clôtures de caisse");
  await capture(p, "grille-permissions");
  await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await p.getByText("Permissions enregistrées.").waitFor();
  assert.equal(await p.getByLabel("Caisse : Valider").isChecked(), true);
  etape("rôle personnalisé et grille module × action");

  // Journal : intégrité + détail d'un événement
  await ouvrir(p, "Journal d'audit");
  await p.locator("tbody tr").first().waitFor();
  await p.getByRole("button", { name: "Vérifier l'intégrité" }).click();
  await p.getByText(/Journal intègre/).waitFor();
  await p.getByRole("cell", { name: /Changement de permissions/ }).click();
  await p.getByText("Empreinte :").waitFor();
  await capture(p, "journal");
  etape("journal : intégrité vérifiée, détail avant/après");

  await ouvrir(p, "Entreprise");
  await p.getByLabel("Raison sociale").waitFor();
  await capture(p, "entreprise");
  etape("page entreprise");
  // Profil : régime fiscal, patente, e-mail ; logo (image fictive dessinée pour le test) ; couleurs de l'entreprise.
  await p.getByLabel("Régime fiscal").fill("Régime du réel");
  await p.getByLabel("N° de patente").fill("PAT-2026-DEMO");
  await p.getByLabel("Adresse e-mail").fill("contact@iti-demo.cm");
  await p.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
  await p.getByText(/Informations enregistrées/).waitFor();
  const dessin = await nouvellePage(200, 200);
  await dessin.setContent(`<div id="l" style="width:160px;height:160px;border-radius:24px;background:#0b5d3b;color:#f2c200;font:900 64px sans-serif;display:grid;place-items:center">ITI</div>`);
  const fichierLogo = `${DOSSIER}/logo-test.png`;
  await dessin.locator("#l").screenshot({ path: fichierLogo });
  await dessin.context().close();
  await p.getByLabel("Fichier du logo (PNG ou JPEG)").setInputFiles(fichierLogo);
  await p.getByText(/Logo enregistré/).waitFor();
  await p.locator(".barre-titre img.logo-entreprise").waitFor();
  await p.getByLabel("Couleur principale").fill("#0b5d3b");
  await p.getByLabel("Couleur d'accent").fill("#f2c200");
  await p.getByRole("button", { name: "Enregistrer les couleurs" }).click();
  await p.getByText("Couleurs enregistrées.").waitFor();
  assert.notEqual(await p.evaluate(() => document.documentElement.style.getPropertyValue("--marine")), "", "couleurs appliquées à l'interface");
  await capture(p, "entreprise-profil");
  etape("profil : régime fiscal, patente, logo et couleurs de l'entreprise appliqués à l'écran");

  // --- Téléphone
  const m = await nouvellePage(390, 844);
  await connexion(m, "mariam.saleh@demo.cm");
  await m.getByRole("heading", { name: /Bonjour/ }).waitFor();
  await capture(m, "mobile-tableau-de-bord");
  await m.getByRole("button", { name: "Ouvrir le menu" }).click();
  await nav(m).getByRole("button", { name: "Administration", exact: true }).click();
  await menu(m, "Utilisateurs").waitFor({ state: "visible" });
  await m.screenshot({ path: `${DOSSIER}/${String(++n).padStart(2, "0")}-mobile-menu.png` });
  const debord = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(debord <= 0, `débordement horizontal de ${debord}px sur mobile`);
  etape("affichage téléphone sans débordement, menu");

  // --- Caissière : menus et pages limités à ses droits
  const c = await nouvellePage();
  await connexion(c, "amina.mahamat@demo.cm");
  await c.getByRole("heading", { name: /Bonjour Amina/ }).waitFor();
  assert.equal(await menu(c, "Utilisateurs").count(), 0);
  assert.equal(await menu(c, "Journal d'audit").count(), 0);
  await c.goto(URL_BASE + "/#/utilisateurs");
  await c.getByText("Vous n'avez pas accès à cette page.").waitFor();
  await capture(c, "caissiere-acces-refuse");
  // Contournement de l'interface : appel direct de l'API avec la session de la caissière.
  const statut = await c.evaluate(async () => (await fetch("/api/utilisateurs", { credentials: "same-origin" })).status);
  assert.equal(statut, 403, "le serveur doit refuser, même si l'interface est contournée");
  etape("caissière : menus filtrés, page interdite, API refusée par le serveur (403)");

  // --- Activation du compte invité depuis l'écran d'accueil
  const b = await nouvellePage();
  await b.goto(URL_BASE + "/");
  await b.getByRole("button", { name: "J'ai reçu un code d'invitation" }).click();
  await b.getByLabel("Code entreprise").fill("GC-DEMO-2026");
  await b.getByLabel("Code d'invitation").fill(codeInvitation);
  await b.getByLabel("Nouveau mot de passe").fill("Caisse-Akwa-Lundi-Matin-26");
  await b.getByLabel("Confirmer le mot de passe").fill("Caisse-Akwa-Lundi-Matin-26");
  await b.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await b.getByText("Compte activé.").waitFor();
  await connexion(b, "brigitte.essomba@demo.cm", "Caisse-Akwa-Lundi-Matin-26");
  await b.getByRole("heading", { name: /Bonjour Brigitte/ }).waitFor();
  etape("activation d'un compte par invitation puis connexion");

  // Le refus côté caissière est bien tracé (vu par l'administratrice)
  await ouvrir(p, "Journal d'audit");
  await p.getByLabel("Résultat").selectOption({ label: "Refusé" });
  await p.getByRole("cell", { name: /Accès refusé/ }).first().waitFor();
  etape("le refus d'accès de la caissière apparaît dans le journal");

  // --- Comptabilité ---------------------------------------------------------------
  assert.equal(await menu(p, "Tableau comptable").count(), 0, "l'administratrice n'a aucun accès comptable par défaut");

  // Comptable : saisie d'un brouillard, d'abord déséquilibré, puis corrigé ; pas de bouton Valider.
  const k = await nouvellePage();
  await connexion(k, "paul.ngaro@demo.cm");
  await ouvrir(k, "Tableau comptable");
  await k.getByRole("heading", { name: "Comptabilité générale" }).waitFor();
  await capture(k, "comptabilite-tableau");
  await ouvrir(k, "Balance générale");
  await k.getByText("Balance partielle.").waitFor();
  etape("comptable : balance partielle (banque masquée)");
  await ouvrir(k, "Écritures");
  await k.getByRole("toolbar", { name: "Actions sur les écritures" }).getByRole("button", { name: "Nouvelle écriture" }).click();
  await k.getByLabel("Journal *").selectOption({ label: "AC · Achats" });
  await k.getByLabel("Référence de la pièce").fill("FAC-TEST-001");
  await k.getByLabel("Libellé *", { exact: true }).fill("Achat de cartouches d'encre");
  await k.getByLabel("Compte de la ligne 1").selectOption({ label: "605 · Autres achats" });
  await k.getByLabel("Débit de la ligne 1").fill("45000");
  await k.getByLabel("Compte de la ligne 2").selectOption({ label: "401 · Fournisseurs, dettes en compte" });
  await k.getByLabel("Crédit de la ligne 2").fill("40000");
  await k.getByText("Écart : 5 000").waitFor();
  await k.getByLabel("Crédit de la ligne 2").fill("45 000");
  await k.getByText("Écriture équilibrée").waitFor();
  await capture(k, "comptabilite-saisie");
  await k.getByRole("button", { name: "Enregistrer le brouillard" }).click();
  await k.getByRole("heading", { name: /Brouillard/ }).waitFor();
  assert.equal(await k.getByRole("button", { name: "Valider" }).count(), 0, "le comptable ne valide pas");
  const urlEcriture = k.url();
  etape("comptable : saisie d'un brouillard équilibré, sans droit de validation");

  // DAF : validation (confirmation par mot de passe), puis extourne motivée.
  const f = await nouvellePage();
  await connexion(f, "ousmane.djibrine@demo.cm");
  await f.getByRole("heading", { name: /Bonjour Ousmane/ }).waitFor();
  await f.getByRole("img", { name: /Évolution des ventes/ }).waitFor();
  await f.getByText("Brouillards à valider").first().waitFor();
  await f.goto(urlEcriture);
  await f.getByRole("button", { name: "Valider" }).click();
  await f.getByRole("dialog").getByRole("button", { name: "Valider" }).click();
  await f.getByRole("dialog", { name: "Confirmez votre identité" }).getByLabel("Mot de passe").fill(MDP);
  await f.getByRole("button", { name: "Confirmer" }).click();
  await f.getByRole("heading", { name: /Écriture n° 2/ }).waitFor();
  await capture(f, "comptabilite-ecriture-validee");
  etape("DAF : validation avec confirmation, numéro 2 attribué dans le journal AC");
  await f.getByRole("button", { name: "Extourner" }).click();
  await f.getByLabel("Motif de la correction").fill("Facture saisie en double");
  await f.getByRole("dialog").getByRole("button", { name: "Extourner" }).click();
  await f.getByText(/Extourne de l'écriture/).waitFor();
  etape("DAF : extourne motivée, liée à l'écriture d'origine");

  await ouvrir(f, "Balance générale");
  await f.getByText(/Balance équilibrée/).waitFor();
  await f.getByText(/Résultat de la période/).waitFor();
  await capture(f, "comptabilite-balance");
  await f.getByRole("cell", { name: "605", exact: true }).click();
  await f.getByRole("heading", { name: "Grand livre" }).waitFor();
  await f.getByText(/605 · Autres achats/).waitFor();
  await capture(f, "comptabilite-grand-livre");
  etape("DAF : balance complète équilibrée avec résultat, grand livre du compte 605");
  await ouvrir(f, "Plan comptable");
  await f.getByRole("cell", { name: "Autres achats" }).first().waitFor();
  await capture(f, "comptabilite-plan");
  const debordCompta = await f.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(debordCompta <= 0);
  etape("plan comptable");

  // --- Ventes et trésorerie --------------------------------------------------------
  const v = await nouvellePage();
  await connexion(v, "amina.mahamat@demo.cm");
  await v.getByRole("heading", { name: /Bonjour Amina/ }).waitFor();
  assert.equal(await menu(v, "Tableau comptable").count(), 0, "la caissière n'a pas accès à la comptabilité");
  await ouvrir(v, "Caisses et banques");
  await v.getByText("Caisse principale").first().waitFor();
  assert.equal(await v.getByText("Banque fictive").count(), 0, "la caissière ne voit que sa caisse");
  etape("caissière : seulement sa caisse (fonds initial 100 000)");
  // Ruban : les commandes interdites au profil n'apparaissent pas.
  await v.getByRole("tab", { name: "Comptabilité" }).click();
  await v.getByText("Aucune commande disponible avec vos droits dans cet onglet.").waitFor();
  await v.getByRole("tab", { name: "Ventes" }).click();
  assert.equal(await v.getByRole("toolbar", { name: "Commandes" }).getByRole("link", { name: /Nouvelle facture/ }).count(), 1);
  etape("caissière : ruban limité à ses droits (aucune commande comptable)");
  // Le DAF suit les ventes en direct pendant que la caissière vend.
  await ouvrir(f, "Ventes en direct");
  await f.getByText(/En direct · mis à jour/).waitFor();
  await ouvrir(v, "Nouvelle vente");
  await v.getByLabel("Client").fill("Établissements Fictifs Mbarga");
  await v.getByLabel("Désignation de la ligne 1").fill("Cartouche d'encre");
  await v.getByLabel("Quantité de la ligne 1").fill("3");
  await v.getByLabel("Prix unitaire de la ligne 1").fill("15000");
  await v.getByRole("button", { name: "+ Ajouter une ligne" }).click();
  await v.getByLabel("Désignation de la ligne 2").fill("Installation");
  await v.getByLabel("Nature de la ligne 2").selectOption("service");
  await v.getByLabel("Prix unitaire de la ligne 2").fill("10000");
  await v.getByText("65 588 FCFA").first().waitFor();
  await capture(v, "vente-saisie");
  await v.getByRole("button", { name: /Émettre la facture/ }).click();
  await v.getByRole("heading", { name: new RegExp(`Facture FAC-${new Date().getFullYear()}-00001`) }).waitFor();
  await v.getByText("Soixante-cinq mille cinq cent quatre-vingt-huit francs CFA").waitFor();
  await v.locator(".apercu-facture img").waitFor();
  await v.locator(".apercu-facture svg.qr").waitFor();
  await v.getByText("Patente : PAT-2026-DEMO").waitFor();
  await capture(v, "vente-facture");
  await f.locator("tbody").getByText(new RegExp(`FAC-${new Date().getFullYear()}-00001`)).waitFor({ timeout: 12_000 });
  await capture(f, "ventes-direct");
  etape("DAF : la facture apparaît d'elle-même dans « Ventes en direct »");
  const codeQr = await v.evaluate(async () => (await (await fetch("/api" + location.hash.slice(1).split("?")[0])).json()).codeVerification);
  await ouvrir(f, "Vérifier une facture");
  await f.getByLabel("Code de la facture").fill(codeQr);
  await f.getByRole("button", { name: "Vérifier", exact: true }).click();
  await f.getByText("✓ Facture authentique").waitFor();
  await capture(f, "verification-ok");
  await f.getByLabel("Code de la facture").fill(codeQr.replace(";65588;", ";95588;"));
  await f.getByRole("button", { name: "Vérifier", exact: true }).click();
  await f.getByText("✗ Facture non reconnue").waitFor();
  etape("DAF : code QR vérifié authentique ; montant falsifié détecté");
  const pdf = await v.evaluate(async () => { const r = await fetch(location.hash.replace("#", "/api").replace("/ventes/", "/ventes/").split("?")[0] + "/pdf"); return [r.status, r.headers.get("content-type")]; });
  assert.deepEqual(pdf, [200, "application/pdf"]);
  await v.getByRole("button", { name: /Imprimer la facture/ }).click();
  await v.locator("#cadre-impression").waitFor({ state: "attached" });
  etape("caissière : vente comptant, TVA 19,25 %, facture n° 1 en lettres, PDF imprimable");
  await ouvrir(v, "Caisses et banques");
  await v.getByRole("button", { name: "− Dépense" }).click();
  await v.getByLabel("Catégorie").selectOption({ label: "Fournitures et petits achats" });
  await v.getByLabel("Montant").fill("5000");
  await v.getByLabel("Libellé").fill("Ramettes de papier");
  await v.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await v.getByText("160 588").first().waitFor();
  await capture(v, "tresorerie-caisse");
  etape("caissière : dépense ; solde de caisse 160 588 FCFA");

  // DAF : validation par lots des écritures générées ; la sienne (fonds de caisse) est refusée.
  await ouvrir(f, "Écritures");
  await f.getByLabel("Origine").selectOption({ label: "Ventes et trésorerie" });
  await f.getByLabel("État", { exact: true }).selectOption({ label: "Brouillards" });
  await f.getByRole("button", { name: /Tout sélectionner/ }).click();
  await f.getByRole("button", { name: /Valider la sélection/ }).click();
  await f.getByRole("dialog").getByRole("button", { name: "Valider" }).click();
  await f.getByText(/écriture\(s\) validée\(s\), 1 refusée\(s\) : Séparation des tâches/).waitFor();
  etape("DAF : validation par lots ; son propre fonds de caisse refusé (séparation des tâches)");
  // Ruban, raccourcis clavier, recherche et barre d'état.
  await f.getByRole("tab", { name: "Trésorerie" }).click();
  await f.getByRole("toolbar", { name: "Commandes" }).getByRole("link", { name: /Dépense/ }).click();
  await f.getByRole("dialog").getByLabel("Montant").waitFor();
  await f.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  await f.keyboard.press("Alt+b");
  await f.getByRole("heading", { name: "Balance générale" }).waitFor();
  await f.keyboard.press("Control+f");
  await f.keyboard.type(`FAC-${new Date().getFullYear()}`);
  await f.keyboard.press("Enter");
  await f.getByRole("heading", { name: "Ventes et factures" }).waitFor();
  await f.getByRole("cell", { name: new RegExp(`FAC-${new Date().getFullYear()}-00001`) }).first().waitFor();
  await f.getByRole("contentinfo", { name: "Barre d'état" }).getByText("Connecté au serveur").waitFor();
  await f.getByRole("button", { name: "Fichier" }).click();
  await f.getByRole("dialog", { name: "Menu Fichier" }).getByRole("button", { name: "Raccourcis clavier" }).click();
  await f.getByRole("cell", { name: "Alt+B" }).waitFor();
  await f.keyboard.press("Escape");
  etape("DAF : commande du ruban, raccourci Alt+B, recherche Ctrl+F, menu Fichier, barre d'état");

  // Déconnexion
  await p.getByRole("button", { name: "Déconnexion" }).click();
  await p.getByText("Vous êtes déconnecté.").waitFor();
  etape("déconnexion");

  const csp = erreursConsole.filter((e) => /Content Security Policy|Refused to/.test(e));
  assert.deepEqual(csp, [], "violations de la politique de sécurité du contenu");
  const autres = erreursConsole.filter((e) => !/status of 40[13]/.test(e));
  assert.deepEqual(autres, [], "erreurs JavaScript dans la console");
  etape(`aucune erreur JavaScript ni violation CSP (${n} captures dans ${DOSSIER}/)`);
} catch (e) {
  // Captures de diagnostic de chaque page ouverte, puis échec.
  let i = 0;
  for (const ctx of navigateur.contexts()) for (const pg of ctx.pages()) await pg.screenshot({ path: `${DOSSIER}/echec-${++i}.png`, fullPage: true }).catch(() => {});
  console.error(`✗ ${e.message.split("\n")[0]} (captures echec-*.png dans ${DOSSIER}/)`);
  process.exitCode = 1;
} finally {
  await navigateur.close();
}
