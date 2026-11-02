// Test de bout en bout de l'application de bureau (Electron) : lanceur, démonstration,
// connexion au serveur, sécurité de la fenêtre. Lancé sous écran virtuel (xvfb-run).
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert');

const OUT = process.argv[2] || os.tmpdir();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rtms-desk-'));
const launch = () => electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(__dirname, '..')], env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') } });

(async () => {
  const log = []; const _push = log.push.bind(log); log.push = (x) => { console.error('…', x); return _push(x); };
  let app = await launch();
  let w = await app.firstWindow();
  w.on('pageerror', (e) => log.push(`ERREUR ${e.message}`));
  await w.waitForSelector('#main');
  assert.strictEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'RAHA TRANSPORT MANAGEMENT SYSTEM (RTMS)');
  // La page n'a pas accès à Node
  assert.strictEqual(await w.evaluate(() => typeof require), 'undefined');
  assert.strictEqual(await w.evaluate(() => typeof window.rtmsDesktop.savePdf), 'function');
  await w.screenshot({ path: path.join(OUT, 'desk-launcher.png') });
  // Adresse saisie à la main qui ne répond pas : message clair, pas de connexion
  await w.click('summary');
  await w.fill('#addr', '127.0.0.1:9');
  await w.click('#manual button');
  await w.waitForSelector('#msg.err');
  log.push(`adresse injoignable : ${await w.textContent('#msg')}`);
  // Démonstration
  await w.click('#demo');
  await w.waitForSelector('#loginform');
  await w.fill('#loginform [name=password]', 'demo');
  await w.click('#loginform button');
  await w.waitForSelector('.stat-tiles');
  await w.click('.tool[data-view=invoices]');
  await w.waitForSelector('.tab-pane:not([hidden]) tbody tr');
  await w.screenshot({ path: path.join(OUT, 'desk-demo.png') });
  // Export PDF natif : la boîte « Enregistrer sous » est simulée, le PDF est réellement produit
  const pdfPath = path.join(home, 'facture-test.pdf');
  await app.evaluate(({ dialog, shell }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); shell.openPath = async () => ''; }, pdfPath);
  await w.locator('.tab-pane:not([hidden]) tbody tr', { hasText: 'F-2026-0101' }).dblclick();
  await w.waitForSelector('.tab-pane:not([hidden]) .record-form.reading');
  await w.evaluate(() => import('./src/core/commands.js').then((m) => m.run('file.pdf')));
  for (let i = 0; i < 50 && !fs.existsSync(pdfPath); i++) await w.waitForTimeout(200);
  assert.ok(fs.existsSync(pdfPath), 'PDF non produit');
  const pdf = fs.readFileSync(pdfPath);
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-', 'fichier non PDF');
  fs.copyFileSync(pdfPath, path.join(OUT, 'desk-facture.pdf'));
  log.push(`PDF natif produit : ${pdf.length} octets`);
  // Export vers le Bureau : un PDF par facture dans « Factures RTMS », sans écraser l'existant
  await app.evaluate(({ shell }) => { shell.openPath = async () => ''; });
  const desk = path.join(home, 'Desktop', 'Factures RTMS');
  await w.evaluate(() => { import('./src/core/commands.js').then((m) => m.run('invoice.export')); });
  await w.waitForSelector('.dlg .dest');
  await w.screenshot({ path: path.join(OUT, 'desk-export.png') });
  await w.locator('.dlg .dest', { hasText: 'Bureau' }).click();
  for (let i = 0; i < 50 && !(fs.existsSync(desk) && fs.readdirSync(desk).length); i++) await w.waitForTimeout(200);
  assert.deepStrictEqual(fs.readdirSync(desk), ['Facture F-2026-0101.pdf']);
  await w.click('.tool[data-view=invoices]');
  await w.waitForSelector('.tab-pane:not([hidden]) tbody tr');
  await w.evaluate(() => import('./src/core/commands.js').then((m) => m.run('edit.selectAll'))); // toutes les factures de la liste
  await w.evaluate(() => { import('./src/core/commands.js').then((m) => m.run('invoice.export')); });
  await w.locator('.dlg .dest', { hasText: 'Bureau' }).click();
  for (let i = 0; i < 50 && fs.readdirSync(desk).length < 4; i++) await w.waitForTimeout(200);
  const files = fs.readdirSync(desk).sort();
  assert.strictEqual(files.length, 4, files.join(', '));
  assert.ok(files.includes('Facture F-2026-0101 (2).pdf'));
  for (const f of files) assert.strictEqual(fs.readFileSync(path.join(desk, f)).subarray(0, 5).toString(), '%PDF-');
  log.push(`export Bureau : ${files.join(', ')}`);
  // Le menu Fichier propose « Changer de serveur » dans l'application de bureau
  await w.locator('.menubar .mb-item', { hasText: 'Fichier' }).click();
  assert.ok(await w.locator('.menu-pop .menu-item', { hasText: 'Changer de serveur' }).count());
  await w.keyboard.press('Escape');
  // Navigation vers un site externe : bloquée dans la fenêtre
  await w.evaluate(() => { location.href = 'https://exemple.com/'; });
  await w.waitForTimeout(800);
  assert.ok(w.url().startsWith('rtms://app/'), `navigation externe non bloquée : ${w.url()}`);
  await app.close();

  // Relance : le choix est mémorisé (démonstration), puis on passe au serveur réel
  app = await launch();
  w = await app.firstWindow();
  await w.waitForSelector('.wtab'); // session de démonstration mémorisée : ouverture directe
  assert.ok(w.url().includes('demo.html'));
  await app.close();

  // Serveur arrêté / injoignable : écran dédié
  const cfgFile = path.join(home, '.config', 'RAHA TRANSPORT RTMS', 'config.json');
  const cfgDir = fs.existsSync(cfgFile) ? cfgFile : fs.readdirSync(path.join(home, '.config')).map((d) => path.join(home, '.config', d, 'config.json')).find((f) => fs.existsSync(f));
  const cfg = JSON.parse(fs.readFileSync(cfgDir, 'utf8'));
  fs.writeFileSync(cfgDir, JSON.stringify({ ...cfg, mode: 'client', serverUrl: 'https://127.0.0.1:9', fingerprint: 'AA:BB' }));
  app = await launch();
  w = await app.firstWindow();
  await w.waitForSelector('#retry', { timeout: 20000 });
  await w.screenshot({ path: path.join(OUT, 'desk-offline.png') });
  log.push('écran « serveur injoignable » affiché');
  await app.close();
  console.log(JSON.stringify(log, null, 1));
  console.log('TOUS LES CONTRÔLES PASSENT');
})().catch((e) => { console.error('ÉCHEC', e.message); process.exit(1); });
