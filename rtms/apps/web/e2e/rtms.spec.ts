import { expect, test, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const account = JSON.parse(readFileSync(join(__dirname, '.e2e-account.json'), 'utf8')) as { email: string; password: string };
let page: Page;
let totpSecret = '';
const pageErrors: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page = await ctx.newPage();
  // Impression interceptée : on vérifie le document préparé sans ouvrir la boîte système
  await page.addInitScript(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed++; }; });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused|Uncaught/.test(m.text())) pageErrors.push(m.text()); });
});

const tool = (key: string) => page.locator(`.tool[data-view="${key}"]`);
const ctxBtn = (cmd: string) => page.locator(`.ctxbar [data-cmd="${cmd}"]`);
const activePane = () => page.locator('.tab-pane:not([hidden])');
const rows = () => activePane().locator('table.grid tbody tr');
async function menu(label: string, item: string) {
  await page.locator('.menubar .mb-item', { hasText: label }).click();
  await page.locator('.menu-pop .menu-item', { hasText: item }).first().click();
}
async function newMission(ref: string, goods: string, extra: Record<string, string> = {}) {
  await ctxBtn('record.new').click();
  const f = activePane();
  await f.locator('[name="Référence mission"]').fill(ref);
  await f.locator('[name="Client"]').fill('SONASUT');
  await f.locator('[name="Départ"]').fill("N'Djamena");
  await f.locator('[name="Destination"]').fill('Moundou');
  await f.locator('[name="Marchandise"]').fill(goods);
  await f.locator('[name="Statut"]').selectOption(extra.Statut ?? 'En cours');
  await page.keyboard.press('Control+s');
  await expect(activePane().locator('.record-form.reading')).toBeVisible();
}

test('connexion + enrôlement MFA obligatoire pour l’administrateur', async () => {
  await page.goto('/');
  await page.fill('#loginform [name=email]', account.email);
  await page.fill('#loginform [name=password]', 'mauvais mot de passe');
  await page.click('#loginform button');
  await expect(page.locator('#loginerr')).toContainText('incorrect');
  await page.fill('#loginform [name=password]', account.password);
  await page.click('#loginform button');
  await expect(page.locator('#enroll')).toBeVisible();
  totpSecret = (await page.locator('#mfasecret').textContent())!.trim();
  await page.fill('#enrollform [name=code]', authenticator.generate(totpSecret));
  await page.click('#enrollform button.btn:not(.secondary)');
  await expect(page.locator('#codes span')).toHaveCount(10);
  await page.click('[data-act=enter-app]');
  await expect(activePane().locator('h1')).toContainText('Tableau de bord');
});

test('structure : barre de menus (13), barre d’outils (17), onglets, panneaux, barre d’état', async () => {
  await expect(page.locator('.menubar .mb-item')).toHaveText(['Fichier', 'Édition', 'Affichage', 'Navigation', 'Transport', 'Transit', 'Import / Export', 'Commerce', 'Finance', 'Fenêtre', 'Rapports', 'Administration', 'Aide']);
  await expect(page.locator('.toolrail .tool')).toHaveCount(17);
  await expect(tool('dashboard')).toHaveClass(/active/);
  await expect(tool('suppliers')).toHaveAttribute('data-tip', 'Fournisseurs');
  await expect(page.locator('.wtab')).toHaveCount(1);
  await expect(page.locator('.rpanel .psec')).toHaveCount(6);
  await expect(page.locator('.statusbar')).toContainText('Connecté au serveur');
});

test('chaque menu s’ouvre et propose des commandes ; navigation au clavier', async () => {
  const n = await page.locator('.menubar .mb-item').count();
  for (let i = 0; i < n; i++) {
    await page.locator('.menubar .mb-item').nth(i).click();
    expect(await page.locator('.menu-pop .menu-item').count()).toBeGreaterThan(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu-pop[role=menu]')).toHaveCount(0);
  }
  await page.keyboard.press('F10');
  await expect(page.locator('.mb-item[data-menu="0"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.mb-item.open')).toHaveText('Fichier');
  await page.keyboard.press('ArrowRight');           // « Nouveau » : ouvre son sous-menu
  await expect(page.locator('.menu-pop.sub')).toContainText('Nouvelle mission');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-pop[role=menu]')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');           // barre : menu suivant
  await expect(page.locator('.mb-item[data-menu="1"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.mb-item.open')).toHaveText('Édition');
  await page.keyboard.press('Escape');
});

test('tous les modules s’ouvrent dans leur propre onglet', async () => {
  for (const key of ['transport', 'transit', 'import', 'export', 'commerce', 'clients', 'suppliers', 'invoices', 'finance', 'fleet', 'staff', 'maintenance', 'documents', 'reports', 'admin', 'settings']) {
    await tool(key).click();
    await expect(tool(key)).toHaveClass(/active/);
    await expect(activePane().locator('h1, h2').first()).toBeVisible();
  }
  await expect(page.locator('.wtab')).toHaveCount(17);
  // Fermer tous les onglets puis rouvrir le tableau de bord
  await menu('Fichier', 'Fermer tous les onglets');
  await expect(page.locator('.wtab')).toHaveCount(0);
  await tool('dashboard').click();
});

test('transport : création par formulaire, recherche et suppression de la bonne ligne', async () => {
  await tool('transport').click();
  await newMission('M-E2E-1', 'Ciment');
  await tool('transport').click();
  await newMission('M-E2E-2', 'Coton');
  await tool('transport').click();
  await newMission('M-E2E-3', 'Riz');
  await tool('transport').click();
  await expect(rows()).toHaveCount(3);
  await activePane().locator('[data-q]').fill('coton');
  await expect(rows()).toHaveCount(1);
  await rows().first().click();
  await ctxBtn('record.cancel').click();
  await page.locator('.dlg [name=reason]').fill('Doublon de saisie');
  await page.locator('.dlg .btn:not(.secondary)').click();
  await activePane().locator('[data-q]').fill('');
  await expect(rows()).toHaveCount(2);
  await expect(activePane().locator('tbody')).not.toContainText('M-E2E-2');
});

test('tri par colonne, filtres multicritères et colonnes personnalisables', async () => {
  await activePane().locator('th[data-sort="Marchandise"]').click();
  await expect(rows().first()).toContainText('Ciment');
  await activePane().locator('th[data-sort="Marchandise"]').click();
  await expect(rows().first()).toContainText('Riz');
  await ctxBtn('view.filters').click();
  await activePane().locator('[data-filters] select[data-f="Statut"]').selectOption('Clôturé');
  await expect(activePane().locator('.empty')).toContainText('Aucun résultat');
  await expect(activePane().locator('.chip')).toContainText('Statut');
  await activePane().locator('[data-act=clearfilters]').click();
  await expect(rows()).toHaveCount(2);
  await ctxBtn('view.columns').click();
  await page.locator('.dlg .col-choice input[value="Chauffeur"]').uncheck();
  await page.locator('.dlg .btn', { hasText: 'Appliquer' }).click();
  await expect(activePane().locator('thead')).not.toContainText('Chauffeur');
});

test('sélection multiple + action groupée (changement de statut)', async () => {
  await activePane().locator('thead [data-all]').check();
  await expect(activePane().locator('[data-bulk]')).toContainText('2 sélectionnés');
  await activePane().locator('[data-bulk] [data-cmd="record.status"]').click();
  await page.locator('.dlg select[name=status]').selectOption('En attente');
  await page.locator('.dlg .btn', { hasText: 'Appliquer' }).click();
  await expect(rows().filter({ hasText: 'En attente' })).toHaveCount(2);
});

test('menu contextuel et ouverture de la fiche au double-clic ; modification avec historique', async () => {
  await rows().first().click({ button: 'right' });
  await expect(page.locator('.ctx-menu')).toContainText('Affecter un véhicule');
  await page.keyboard.press('Escape');
  await rows().filter({ hasText: 'M-E2E-1' }).dblclick();
  await expect(activePane().locator('.record-form.reading')).toBeVisible();
  await page.keyboard.press('F2');
  await activePane().locator('[name="Marchandise"]').fill('Ciment gris');
  await expect(page.locator('.wtab.active')).toHaveClass(/dirty/);
  await page.keyboard.press('Control+s');
  await expect(activePane().locator('.record-form.reading')).toContainText('Ciment gris');
  await expect(page.locator('.rpanel [data-sec-body=history]')).toContainText('Marchandise');
  await expect(page.locator('.rpanel [data-sec-body=history]')).toContainText('Modification');
});

test('la saisie en cours est conservée quand on change d’onglet', async () => {
  await tool('transit').click();
  await ctxBtn('record.new').click();
  await activePane().locator('[name="Référence dossier"]').fill('TR-BROUILLON');
  await tool('dashboard').click();
  await page.locator('.wtab', { hasText: 'Nouveau dossier' }).click();
  await expect(activePane().locator('[name="Référence dossier"]')).toHaveValue('TR-BROUILLON');
  await expect(page.locator('.wtab.active')).toHaveClass(/dirty/);
  // Après rechargement de la page, onglets et brouillon reviennent (session du navigateur)
  await page.reload();
  await expect(page.locator('.wtab').first()).toBeVisible();
  await expect(page.locator('.wtab', { hasText: 'Nouveau dossier' })).toBeVisible();
  await page.locator('.wtab', { hasText: 'Nouveau dossier' }).click();
  await expect(activePane().locator('[name="Référence dossier"]')).toHaveValue('TR-BROUILLON');
  // Fermeture d'un onglet modifié : confirmation
  await page.locator('.wtab.active .wtab-x').click();
  await expect(page.locator('.dlg')).toContainText('sans enregistrer');
  await page.locator('.dlg .btn', { hasText: 'Fermer sans enregistrer' }).click();
  await expect(page.locator('.wtab', { hasText: 'Nouveau dossier' })).toHaveCount(0);
});

test('erreur serveur explicite sur le champ concerné : référence en double', async () => {
  await tool('transport').click();
  await ctxBtn('record.new').click();
  const f = activePane();
  await f.locator('[name="Référence mission"]').fill('m-e2e-1');
  await f.locator('[name="Client"]').fill('X');
  await f.locator('[name="Départ"]').fill('A');
  await f.locator('[name="Destination"]').fill('B');
  await f.locator('button[type=submit]').click();
  await expect(f.locator('.err')).toContainText('déjà utilisée');
  await page.locator('.wtab.active .wtab-x').click();
  await page.locator('.dlg .btn', { hasText: 'Fermer sans enregistrer' }).click();
});

test('affectation d’un véhicule depuis le référentiel + ordre de mission imprimé', async () => {
  await tool('fleet').click();
  await ctxBtn('record.new').click();
  await activePane().locator('[name="Immatriculation"]').fill('TD-4521-A');
  await activePane().locator('[name="Marque / modèle"]').fill('Renault Kerax');
  await activePane().locator('[name="Assurance valide jusqu’au"]').fill('2020-01-01');
  await page.keyboard.press('Control+s');
  await expect(activePane().locator('.record-form.reading')).toBeVisible();
  await tool('transport').click();
  await rows().filter({ hasText: 'M-E2E-3' }).click();
  await ctxBtn('transport.vehicle').click();
  await page.locator('.dlg select[name=v]').selectOption('TD-4521-A');
  await page.locator('.dlg .btn', { hasText: 'Affecter' }).click();
  await expect(rows().filter({ hasText: 'M-E2E-3' })).toContainText('TD-4521-A');
  await rows().filter({ hasText: 'M-E2E-3' }).click();
  await ctxBtn('transport.order').click();
  await expect(page.locator('#print-root')).toContainText('ORDRE DE MISSION');
  await expect(page.locator('#print-root')).toContainText('TD-4521-A');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBeGreaterThan(0);
});

test('notifications : assurance expirée signalée (cloche + pastille du module)', async () => {
  await expect(page.locator('[data-bell-count]')).toBeVisible();
  await expect(tool('fleet').locator('.badge')).toHaveText('1');
  await page.locator('[data-bell]').click();
  await expect(page.locator('.dlg')).toContainText('Assurance expirée');
  await page.keyboard.press('Escape');
});

test('facturation : calcul automatique, validation confirmée, impression et export', async () => {
  await tool('invoices').click();
  await ctxBtn('record.new').click();
  const f = activePane();
  await f.locator('[name="Numéro de facture"]').fill('F-E2E-001');
  await f.locator('[name="Client"]').fill('SONASUT');
  await f.locator('[name="Date"]').fill('2026-10-31');
  await f.locator('[name="Désignation"]').fill('Transport conteneur');
  await f.locator('[name="Quantité"]').fill('2');
  await f.locator('[name="Prix unitaire (FCFA)"]').fill('250000');
  await f.locator('[name="Taxe (%)"]').fill('18');
  await expect(f.locator('[data-computed]')).toContainText(/590\s000/);
  await ctxBtn('record.validate').click();
  await expect(page.locator('.dlg')).toContainText('Validée');
  await page.locator('.dlg .btn', { hasText: 'Valider' }).click();
  await expect(activePane().locator('.view-head .pill')).toHaveText('Validée');
  await ctxBtn('invoice.print').click();
  await expect(page.locator('#print-root')).toContainText('FACTURE');
  await expect(page.locator('#print-root')).toContainText(/590\s000/);
  await ctxBtn('file.pdf').click();
  await expect(page.locator('.toast', { hasText: 'Enregistrer au format PDF' })).toBeVisible();
  await tool('invoices').click();
  await expect(rows().first()).toContainText(/590\s000/);
  const [dl] = await Promise.all([page.waitForEvent('download'), ctxBtn('file.csv').click()]);
  expect(dl.suggestedFilename()).toBe('raha_invoices.csv');
});

test('recherche globale (Ctrl+K) groupée par catégorie, ouverture de la fiche', async () => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('sonasut');
  await expect(page.locator('.gs-results')).toContainText('Missions');
  await expect(page.locator('.gs-results')).toContainText('Factures');
  await page.locator('.gs-item', { hasText: 'F-E2E-001' }).click();
  await expect(page.locator('.wtab.active')).toContainText('F-E2E-001');
  await expect(activePane().locator('.record-form.reading')).toContainText('SONASUT');
});

test('panneaux : réduction, masquage, détachement, redimensionnement, espace mémorisé', async () => {
  const head = page.locator('.rpanel [data-sec-box=documents] [data-pact=collapse]');
  await head.click();
  await expect(page.locator('.rpanel [data-sec-box=documents]')).toHaveClass(/collapsed/);
  await page.locator('.rpanel [data-sec-box=quick] [data-pact=hide]').click();
  await expect(page.locator('.rpanel [data-sec-box=quick]')).toHaveCount(0);
  await menu('Fenêtre', 'Actions rapides');
  await expect(page.locator('.rpanel [data-sec-box=quick]')).toHaveCount(1);
  await page.locator('.rpanel [data-sec-box=notifications] [data-pact=float]').click();
  await expect(page.locator('.pfloat [data-sec-box=notifications]')).toBeVisible();
  await page.locator('.pfloat [data-pact=dock]').click();
  await expect(page.locator('.pfloat')).toHaveCount(0);
  const box = (await page.locator('.splitter').boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + 200, { steps: 5 });
  await page.mouse.up();
  const w = await page.locator('.rpanel').evaluate((e) => e.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(400);
  await page.keyboard.press('F4');
  await expect(page.locator('.rpanel')).toBeHidden();
  await page.keyboard.press('F4');
  await expect(page.locator('.rpanel')).toBeVisible();
  await menu('Fenêtre', 'Espaces de travail');
  await page.locator('.menu-pop.sub .menu-item', { hasText: 'Saisie' }).click();
  await expect(page.locator('.rpanel')).toBeHidden();
  await menu('Fenêtre', 'Espaces de travail');
  await page.locator('.menu-pop.sub .menu-item', { hasText: 'Essentiel' }).click();
  await expect(page.locator('.rpanel')).toBeVisible();
});

test('rapports, paramètres, administration (utilisateurs, permissions, audit)', async () => {
  await tool('reports').click();
  await expect(activePane()).toContainText('Volumes par activité');
  await ctxBtn('file.print').click();
  await expect(page.locator('#print-root')).toContainText('Rapport d’activité');
  await tool('settings').click();
  await activePane().locator('[name=phone]').fill('+235 66 00 00 00');
  await activePane().locator('[data-act=save-company]').click();
  await expect(activePane().locator('.ok')).toContainText('enregistrés');
  await menu('Administration', 'Utilisateurs');
  await activePane().locator('[data-act=add-user]').click();
  await page.locator('.dlg [name=fullName]').fill('Agent E2E');
  await page.locator('.dlg [name=email]').fill(`agent-${Date.now()}@raha.test`);
  await page.locator('.dlg [name=roleKey]').selectOption('agent');
  await page.locator('.dlg .btn', { hasText: 'Créer' }).click();
  await expect(page.locator('.dlg .secret')).not.toBeEmpty();
  await page.locator('.dlg .btn', { hasText: 'J’ai noté' }).click();
  await expect(activePane().locator('tbody')).toContainText('Agent E2E');
  await activePane().locator('[data-section=permissions]').click();
  await expect(activePane().locator('[data-grant]').first()).toBeVisible();
  await activePane().locator('[data-section=audit]').click();
  await activePane().locator('[data-act=verify-audit]').click();
  await expect(activePane().locator('.ok')).toContainText('intègre');
});

test('transfert des données du prototype (localStorage)', async () => {
  await page.evaluate(() => localStorage.setItem('rtms_data', JSON.stringify({ fleet: [{ Immatriculation: 'TD-OLD-01', 'Marque / modèle': 'Mercedes Actros', Statut: 'Disponible' }] })));
  await page.locator('.wtab', { hasText: 'Paramètres' }).locator('.wtab-x').click();
  await tool('settings').click();
  await activePane().locator('[data-section=legacy]').click();
  await activePane().locator('[data-act=import-preview]').click();
  await expect(activePane().locator('.notice')).toContainText('1 à importer');
  await activePane().locator('[data-act=import-run]').click();
  await page.locator('.dlg .btn', { hasText: 'Transférer' }).click();
  await expect(activePane().locator('.ok')).toContainText('1 importé');
  await tool('fleet').click();
  await expect(activePane().locator('tbody')).toContainText('TD-OLD-01');
});

test('disposition stable en HD, Full HD et écran large (aucun débordement)', async () => {
  for (const [w, hgt] of [[1280, 720], [1366, 768], [1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const m = document.querySelector('.menubar')!;
      const rail = document.querySelector('.toolrail')!.getBoundingClientRect();
      return { menu: m.scrollWidth - m.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, railVisible: rail.width > 40, status: document.querySelector('.statusbar')!.getBoundingClientRect().bottom };
    });
    expect(r.menu, `menus coupés à ${w}px`).toBeLessThanOrEqual(1);
    expect(r.doc).toBeLessThanOrEqual(0);
    expect(r.railVisible).toBe(true);
    expect(Math.round(r.status)).toBe(hgt);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('déconnexion : l’API n’est plus accessible', async () => {
  await menu('Fichier', 'Déconnexion');
  await expect(page.locator('#loginform')).toBeVisible();
  const status = await page.evaluate(async () => (await fetch('/api/dashboard')).status);
  expect(status).toBe(401);
});

test('aucune erreur JavaScript ni violation CSP', async () => {
  expect(pageErrors).toEqual([]);
});
