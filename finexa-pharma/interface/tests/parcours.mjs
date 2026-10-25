/**
 * Parcours de bout en bout de FINEXA PHARMA dans un vrai navigateur, contre un vrai serveur et une base de démonstration.
 *
 *   1. Dans serveur/ : GC_MODE_DEMO=oui npm run demo:initialiser   (base neuve, données fictives)
 *   2. Lancer le serveur (npm run demarrer)
 *   3. Ici : GC_URL=http://localhost:8444 node tests/parcours.mjs [dossier-captures]
 *
 * Échoue au premier écart ; enregistre des captures d'écran de chaque étape.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const URL_BASE = process.env.GC_URL ?? "http://localhost:8444";
const MDP = process.env.GC_DEMO_MOT_DE_PASSE ?? "Demonstration-2026!";
const CODE = "PH-DEMO-2026";
const DOSSIER = process.argv[2] ?? "captures";
mkdirSync(DOSSIER, { recursive: true });

const navigateur = await chromium.launch(process.env.GC_CHROMIUM ? { executablePath: process.env.GC_CHROMIUM } : {});
const erreursConsole = [];
let n = 0;
const etape = (t) => console.log(`✓ ${t}`);
const capture = async (page, nom) => page.screenshot({ path: `${DOSSIER}/${String(++n).padStart(2, "0")}-${nom}.png`, fullPage: true });
const jour = (decalage) => new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);

async function nouvellePage(largeur = 1366, hauteur = 860) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") erreursConsole.push(m.text()); });
  page.on("pageerror", (e) => erreursConsole.push(String(e)));
  return page;
}

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
  await page.getByLabel("Code entreprise").fill(CODE);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(mdp);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

/** Opération sensible : le serveur peut demander de retaper son mot de passe. */
async function confirmerSiDemande(page, attendu) {
  const dialogue = page.getByRole("dialog", { name: "Confirmez votre identité" });
  const r = await Promise.race([dialogue.waitFor().then(() => "dialogue"), attendu.waitFor().then(() => "fini")]);
  if (r === "dialogue") {
    await dialogue.getByLabel("Mot de passe").fill(MDP);
    await dialogue.getByRole("button", { name: "Confirmer" }).click();
    await attendu.waitFor();
  }
}

try {
  // --- Pharmacienne titulaire, administratrice de l'officine
  const p = await nouvellePage();
  await p.goto(URL_BASE + "/");
  await p.getByRole("heading", { name: "Connexion" }).waitFor();
  await capture(p, "connexion");
  await connexion(p, "aissatou.bello@demo.cm", "mauvais-mot-de-passe");
  await p.getByRole("alert").filter({ hasText: "incorrect" }).waitFor();
  etape("mauvais mot de passe : message générique affiché");
  await p.getByLabel("Mot de passe").fill(MDP);
  await p.getByRole("button", { name: "Se connecter" }).click();
  await p.getByRole("heading", { name: /Bonjour Aïssatou/ }).waitFor();
  await p.locator(".indicateur .val").first().waitFor();
  await p.locator(".liste-a-faire").getByText(/périmé/).waitFor();
  await p.getByText("Valeur du stock").waitFor();
  assert.ok(!(await p.locator("body").innerText()).includes("ERP"), "aucune mention de FINEXA ERP à l'écran");
  await p.locator(".barre-etat").getByText(/alerte.* de stock à traiter/).waitFor();
  await capture(p, "tableau-de-bord");
  etape("connexion, tableau de bord (indicateurs, « À traiter », valeur du stock), alertes dans la barre d'état");

  // Paramètres de la pharmacie : délai d'alerte de péremption
  await ouvrir(p, "Pharmacie");
  await p.getByRole("heading", { name: "Pharmacie", exact: true }).waitFor();
  await p.getByRole("tab", { name: "Paramètres de la pharmacie" }).click();
  const delai = p.getByLabel("Alerte de péremption (jours avant la date)");
  assert.equal(await delai.inputValue(), "90");
  await delai.fill("60");
  await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await p.getByText("Paramètres de la pharmacie enregistrés.").waitFor();
  await capture(p, "parametres-pharmacie");
  etape("paramètres : délai d'alerte de péremption modifié (90 → 60 jours), taux de TVA saisis par la pharmacie");

  // Catalogue : recherche puis création d'un produit
  await ouvrir(p, "Produits");
  await p.getByRole("heading", { name: "Produits" }).waitFor();
  await p.locator("tbody tr").first().waitFor();
  await capture(p, "catalogue");
  await p.getByPlaceholder("Nom, DCI, code ou code-barres…").fill("paracétamol");
  await p.waitForFunction(() => document.querySelectorAll("tbody tr").length === 2);
  etape("catalogue : recherche par nom ou DCI (2 produits « paracétamol »)");

  await p.getByRole("button", { name: "+ Nouveau produit" }).click();
  await p.getByLabel("Nom commercial").fill("Amoxicilline 500 mg (test)");
  await p.getByLabel("DCI (dénomination commune)").fill("Amoxicilline");
  await p.getByLabel("Code-barres").fill("2000000000017");
  await p.getByLabel("Catégorie ou famille").selectOption({ label: "Médicaments" });
  await p.getByLabel("Forme").selectOption({ label: "Gélule" }).catch(() => p.getByLabel("Forme").selectOption({ index: 1 }));
  await p.getByLabel("Prix d'achat de référence (FCFA)").fill("1800");
  await p.getByLabel("Prix de vente (FCFA)").fill("2500");
  await p.getByLabel("Seuil d'alerte (boîtes)").fill("10");
  await capture(p, "nouveau-produit");
  await p.getByRole("button", { name: "Créer le produit" }).click();
  await p.getByRole("heading", { name: "Amoxicilline 500 mg (test)" }).waitFor();
  await p.getByText("Rupture").first().waitFor();
  etape("création d'un produit : fiche ouverte, en rupture tant qu'aucun lot n'est entré");

  // Entrée de stock depuis la fiche (produit déjà choisi)
  await p.getByRole("button", { name: "+ Entrée de stock" }).click();
  await p.locator(".produit-choisi").getByText("Amoxicilline 500 mg (test)").waitFor();
  await p.getByLabel("N° de lot").fill("TEST-AMX-01");
  await p.getByLabel("Date de péremption").fill(jour(400));
  await p.getByLabel("Quantité (boîtes)").fill("30");
  await p.getByLabel("Fournisseur").fill("Grossiste fictif");
  await p.getByRole("button", { name: "Enregistrer l'entrée" }).click();
  await p.getByRole("link", { name: "TEST-AMX-01" }).waitFor();
  await capture(p, "entree-stock");
  // Lot déjà périmé : refusé
  await p.getByLabel("N° de lot").fill("TEST-AMX-OLD");
  await p.getByLabel("Date de péremption").fill(jour(-5));
  await p.getByLabel("Quantité (boîtes)").fill("5");
  await p.getByRole("button", { name: "Enregistrer l'entrée" }).click();
  await p.getByRole("alert").filter({ hasText: /périmé/i }).waitFor();
  etape("entrée de stock : lot TEST-AMX-01 de 30 boîtes ; lot déjà périmé refusé");

  // Fiche du lot : ajustement pour casse (opération sensible, motivée)
  await p.getByRole("link", { name: "TEST-AMX-01" }).click();
  await p.getByRole("heading", { name: "Lot TEST-AMX-01" }).waitFor();
  await p.getByRole("button", { name: "Ajuster le stock" }).click();
  await p.getByLabel("Motif").selectOption({ label: "Casse" }).catch(() => p.getByLabel("Motif").selectOption({ index: 0 }));
  await p.getByLabel(/^Quantité retirée/).fill("2");
  await p.getByLabel(/^Précision/).fill("Boîtes tombées du rayon (test)");
  await p.getByRole("button", { name: "Enregistrer l'ajustement" }).click();
  await confirmerSiDemande(p, p.getByText(/Ajustement MVT-\d{4}-\d{5} enregistré/));
  await p.locator("tbody tr").filter({ hasText: "Boîtes tombées du rayon" }).waitFor();
  await p.locator("tbody tr").filter({ hasText: "Boîtes tombées du rayon" }).getByText("28").waitFor();
  await capture(p, "fiche-lot");
  etape("ajustement pour casse : confirmation, mouvement numéroté, solde du lot 28");

  // Inventaire : comptage d'un lot, écart, validation
  await ouvrir(p, "Inventaires");
  await p.getByRole("button", { name: "+ Nouvel inventaire" }).click();
  await p.getByRole("dialog").getByLabel("Libellé").fill("Inventaire tournant (test)");
  await p.getByRole("button", { name: "Ouvrir l'inventaire" }).click();
  await p.getByRole("heading", { name: "Inventaire tournant (test)" }).waitFor();
  await p.getByPlaceholder("Filtrer par produit ou n° de lot…").fill("TEST-AMX");
  await p.getByLabel("Quantité comptée : Amoxicilline 500 mg (test), lot TEST-AMX-01").fill("27");
  await p.getByRole("button", { name: /Enregistrer les comptages \(1\)/ }).click();
  await p.locator("tbody tr").filter({ hasText: "TEST-AMX-01" }).getByText("−1").waitFor();
  await capture(p, "inventaire-comptage");
  await p.getByRole("button", { name: "Valider l'inventaire" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Valider", exact: true }).click();
  await confirmerSiDemande(p, p.getByText("Inventaire validé."));
  await p.locator(".badge", { hasText: /Valid|Clos/ }).first().waitFor();
  etape("inventaire : comptage 27 pour 28 attendus, écart −1, validation confirmée");

  // Mouvements : l'historique contient l'entrée, la casse et l'écart d'inventaire
  await ouvrir(p, "Mouvements");
  await p.getByRole("heading", { name: "Mouvements de stock" }).waitFor();
  const lignes = p.locator("tbody tr").filter({ hasText: "TEST-AMX-01" });
  await lignes.first().waitFor();
  assert.equal(await lignes.count(), 3, "entrée, casse et écart d'inventaire");
  await capture(p, "mouvements");
  etape("historique : 3 mouvements pour le lot (entrée, casse, inventaire)");

  await ouvrir(p, "Alertes");
  await p.getByRole("heading", { name: "Alertes de stock" }).waitFor();
  await p.getByText("DEMO103X").first().waitFor();
  await capture(p, "alertes");
  etape("alertes : lot périmé encore en stock signalé");

  // Recherche globale (Ctrl+F) vers le catalogue
  await p.keyboard.press("Control+f");
  await p.getByRole("combobox", { name: "Rechercher" }).fill("vitamine");
  await p.getByRole("option", { name: /Produits contenant « vitamine »/ }).click();
  await p.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  etape("recherche Ctrl+F : produits trouvés depuis n'importe quel écran");

  // Création d'un compte vendeur → fiche d'accès
  await ouvrir(p, "Utilisateurs");
  await p.getByRole("button", { name: "+ Ajouter un utilisateur" }).click();
  await p.getByLabel("Nom complet").fill("Brigitte Essomba");
  await p.getByLabel("Adresse e-mail professionnelle").fill("brigitte.essomba@demo.cm");
  await p.getByRole("dialog").getByLabel("Préparateur / vendeur").check();
  await p.getByRole("button", { name: "Créer et générer l'invitation" }).click();
  await confirmerSiDemande(p, p.getByRole("dialog", { name: /Fiche d'accès de Brigitte/ }));
  const codeInvitation = (await p.locator(".fiche-acces .code-fiche").innerText()).trim();
  assert.match(codeInvitation, /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){4}$/, "code lisible en 5 groupes de 4");
  const fiche = await p.locator(".fiche-acces").innerText();
  assert.ok(fiche.includes(CODE) && fiche.includes("brigitte.essomba@demo.cm") && fiche.includes("FINEXA PHARMA"), `fiche d'accès incomplète : ${fiche}`);
  await capture(p, "fiche-acces");
  await p.getByRole("button", { name: "J'ai remis le code" }).click();
  etape("création d'un compte vendeur : fiche d'accès FINEXA PHARMA avec code lisible");

  const b = await nouvellePage();
  await b.goto(URL_BASE + `/#/activation?entreprise=${CODE}&code=${encodeURIComponent(codeInvitation)}`);
  await b.getByRole("heading", { name: "Activer mon compte" }).waitFor();
  assert.ok(!b.url().includes(codeInvitation), "code retiré de la barre d'adresse");
  await b.getByLabel("Nouveau mot de passe").fill("Comptoir-Bastos-Mardi-26");
  await b.getByLabel("Confirmer le mot de passe").fill("Comptoir-Bastos-Mardi-26");
  await b.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await b.getByText("Compte activé.").waitFor();
  await connexion(b, "brigitte.essomba@demo.cm", "Comptoir-Bastos-Mardi-26");
  await b.getByRole("heading", { name: /Bonjour Brigitte/ }).waitFor();
  etape("activation du compte invité puis connexion");

  // --- Vendeuse : consultation seulement, ni valeur du stock ni administration
  const v = await nouvellePage();
  await connexion(v, "clarisse.mbarga@demo.cm");
  await v.getByRole("heading", { name: /Bonjour Clarisse/ }).waitFor();
  await v.locator(".indicateur .val").first().waitFor();
  assert.equal(await v.getByText("Valeur du stock").count(), 0, "valeur du stock masquée à la vendeuse");
  assert.equal(await menu(v, "Utilisateurs").count(), 0);
  assert.equal(await menu(v, "Entrée de stock").count(), 0);
  assert.equal(await menu(v, "Nouveau produit").count(), 0);
  await capture(v, "vendeuse-tableau-de-bord");
  await v.goto(URL_BASE + "/#/stock/entree");
  await v.getByText("Vous n'avez pas accès à cette page.").waitFor();
  // Contournement de l'interface : appel direct de l'API avec la session de la vendeuse.
  // L'en-tête anti-falsification est fourni comme le ferait l'interface : c'est bien la permission qui est refusée.
  const refus = await v.evaluate(async () => {
    const r = await fetch("/api/lots", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-gc-requete": "1" }, body: "{}" });
    return { statut: r.status, code: (await r.json()).erreur?.code };
  });
  assert.deepEqual(refus, { statut: 403, code: "acces_refuse" }, "le serveur doit refuser, même si l'interface est contournée");
  etape("vendeuse : menus filtrés, valeur du stock masquée, entrée de stock refusée par le serveur (403)");

  // Journal : intégrité et refus tracé
  await ouvrir(p, "Journal d'audit");
  await p.locator("tbody tr").first().waitFor();
  await p.getByRole("button", { name: "Vérifier l'intégrité" }).click();
  await p.getByText(/Journal intègre/).waitFor();
  await p.getByLabel("Résultat").selectOption({ label: "Refusé" });
  await p.getByRole("cell", { name: /Accès refusé/ }).first().waitFor();
  await capture(p, "journal");
  etape("journal : intégrité vérifiée, refus d'accès de la vendeuse tracé");

  // --- Téléphone
  const m = await nouvellePage(390, 844);
  await connexion(m, "esther.ngobassa@demo.cm");
  await m.getByRole("heading", { name: /Bonjour/ }).waitFor();
  await capture(m, "mobile-tableau-de-bord");
  await m.getByRole("button", { name: "Ouvrir le menu" }).click();
  await nav(m).getByRole("button", { name: "Stock", exact: true }).click();
  await menu(m, "Lots en stock").waitFor({ state: "visible" });
  await menu(m, "Lots en stock").click();
  await m.getByRole("heading", { name: "Lots en stock" }).waitFor();
  await m.waitForTimeout(400);   // fin de l'animation de fermeture du menu avant la capture
  const debord = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(debord <= 0, `débordement horizontal de ${debord}px sur mobile`);
  await capture(m, "mobile-lots");
  etape("téléphone (gestionnaire de stock) : lots consultables, sans débordement");

  await p.getByRole("button", { name: "Déconnexion" }).click();
  await p.getByText("Vous êtes déconnecté.").waitFor();
  etape("déconnexion");

  const csp = erreursConsole.filter((e) => /Content Security Policy|Refused to/.test(e));
  assert.deepEqual(csp, [], "violations de la politique de sécurité du contenu");
  const autres = erreursConsole.filter((e) => !/status of 40[0139]/.test(e));
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
