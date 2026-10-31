import { expect, test, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const account = JSON.parse(readFileSync(join(__dirname, '.e2e-account.json'), 'utf8')) as { email: string; password: string };
let page: Page;
const pageErrors: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) pageErrors.push(m.text()); });
});

test('connexion + enrôlement MFA obligatoire pour l’administrateur', async () => {
  await page.goto('/');
  await expect(page.locator('#loginform')).toBeVisible();
  await page.fill('#loginform [name=email]', account.email);
  await page.fill('#loginform [name=password]', 'mauvais mot de passe');
  await page.click('#loginform button');
  await expect(page.locator('#loginerr')).toContainText('incorrect');

  await page.fill('#loginform [name=password]', account.password);
  await page.click('#loginform button');
  await expect(page.locator('#enroll')).toBeVisible();
  await expect(page.locator('#qrimg')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  const secret = (await page.locator('#mfasecret').textContent())!.trim();
  await page.fill('#enrollform [name=code]', authenticator.generate(secret));
  await page.click('#enrollform button.btn:not(.secondary)');
  await expect(page.locator('#codes span')).toHaveCount(10);
  await page.click('[data-action=enter-app]');
  await expect(page.locator('#view h1')).toHaveText('Tableau de bord');
  await expect(page.locator('#whoami')).toContainText('Administrateur');
});

test('les 14 entrées du menu du prototype sont présentes', async () => {
  await expect(page.locator('.nav button[data-page]:not(.hidden)')).toHaveCount(14);
});

test('transport : création, recherche et suppression de la bonne ligne', async () => {
  await page.click('.nav [data-page=transport]');
  for (const [ref, goods] of [['M-E2E-1', 'Ciment'], ['M-E2E-2', 'Coton'], ['M-E2E-3', 'Riz']]) {
    await page.click('[data-action=new]');
    await page.fill('[name="Référence mission"]', ref);
    await page.fill('[name="Client"]', 'SONASUT');
    await page.fill('[name="Départ"]', "N'Djamena");
    await page.fill('[name="Destination"]', 'Moundou');
    await page.fill('[name="Marchandise"]', goods);
    await page.selectOption('[name="Statut"]', 'En cours');
    await page.click('#savebtn');
    await expect(page.locator('#modalbg')).toBeHidden();
  }
  await expect(page.locator('#tbody tr')).toHaveCount(3);
  await expect(page.locator('#tbody tr').first()).toContainText("N'Djamena → Moundou");

  await page.fill('#search', 'coton');
  await expect(page.locator('#tbody tr')).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await page.click('#tbody [data-action=remove]');
  await page.fill('#search', '');
  await expect(page.locator('#tbody tr')).toHaveCount(2);
  await expect(page.locator('#tbody')).not.toContainText('M-E2E-2');
  await expect(page.locator('#tbody')).toContainText('M-E2E-1');
});

test('erreur serveur lisible : référence en double', async () => {
  await page.click('[data-action=new]');
  await page.fill('[name="Référence mission"]', 'm-e2e-1');
  await page.fill('[name="Client"]', 'X');
  await page.fill('[name="Départ"]', 'A');
  await page.fill('[name="Destination"]', 'B');
  await page.click('#savebtn');
  await expect(page.locator('#moderr')).toContainText('déjà utilisée');
  await page.click('[data-action=close-modal]');
});

test('facturation : la colonne Total TTC affiche le montant calculé', async () => {
  await page.click('.nav [data-page=invoices]');
  await page.click('[data-action=new]');
  await page.fill('[name="Numéro de facture"]', 'F-E2E-001');
  await page.fill('[name="Client"]', 'SONASUT');
  await page.fill('[name="Date"]', '2026-10-31');
  await page.fill('[name="Désignation"]', 'Transport conteneur');
  await page.fill('[name="Quantité"]', '2');
  await page.fill('[name="Prix unitaire (FCFA)"]', '250000');
  await page.fill('[name="Taxe (%)"]', '18');
  await page.click('#savebtn');
  await expect(page.locator('#tbody tr').first()).toContainText(/590\s000/);
});

test('tableau de bord et rapports reflètent les données', async () => {
  await page.click('.nav [data-page=dashboard]');
  await expect(page.locator('.cards .card').first()).toContainText('2');
  await page.click('.nav [data-page=reports]');
  await expect(page.locator('#view h1')).toHaveText('Rapports & statistiques');
});

test('paramètres : enregistrement réel (auparavant factice)', async () => {
  await page.click('.nav [data-page=settings]');
  await page.fill('#setform [name=phone]', '+235 66 00 00 00');
  await page.click('[data-action=save-settings]');
  await expect(page.locator('#seterr')).toContainText('enregistrés');
  await page.reload();
  await expect(page.locator('#view h1')).toHaveText('Tableau de bord');
  await page.click('.nav [data-page=settings]');
  await expect(page.locator('#setform [name=phone]')).toHaveValue('+235 66 00 00 00');
  await page.click('[data-action=verify-audit]');
  await expect(page.locator('#auditmsg')).toContainText('intègre');
});

test('transfert des données du prototype (localStorage)', async () => {
  await page.evaluate(() => localStorage.setItem('rtms_data', JSON.stringify({ fleet: [{ Immatriculation: 'TD-OLD-01', 'Marque / modèle': 'Mercedes Actros', Type: 'Tracteur', Année: '2018', Kilométrage: '420000', Capacité: '40', 'Assurance valide jusqu’au': '2027-01-01', Statut: 'Disponible' }] })));
  await page.click('.nav [data-page=dashboard]');
  await page.click('.nav [data-page=settings]');
  await page.click('[data-action=import-preview]');
  await expect(page.locator('#importmsg')).toContainText('1 à importer');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-action=import-run]');
  await expect(page.locator('#importmsg')).toContainText('1 importé');
  await page.click('.nav [data-page=fleet]');
  await expect(page.locator('#tbody')).toContainText('TD-OLD-01');
});

test('déconnexion : l’API n’est plus accessible', async () => {
  await page.click('[data-action=logout]');
  await expect(page.locator('#loginform')).toBeVisible();
  const status = await page.evaluate(async () => (await fetch('/api/dashboard')).status);
  expect(status).toBe(401);
});

test('aucune erreur JavaScript ni violation CSP', async () => {
  expect(pageErrors).toEqual([]);
});
