// Bout en bout « 100 % hors ligne » : un poste principal (base intégrée) et un poste de travail
// qui le trouve sur le réseau local, vérifie l'empreinte et s'y connecte. Puis empreinte falsifiée.
// À lancer sous xvfb-run, avec un utilisateur non root (PostgreSQL refuse root).
const { _electron: electron } = require(process.env.PW_PATH || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert');

const OUT = process.argv[2] || os.tmpdir();
const mk = (n) => { const h = fs.mkdtempSync(path.join(os.tmpdir(), `rtms-${n}-`)); return h; };
const launch = (home) => electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(__dirname, '..')], env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }, timeout: 60_000 });
const cfgFile = (home) => path.join(home, '.config', 'RAHA TRANSPORT RTMS', 'config.json');
const ADMIN = { email: 'admin@raha-transport.cm', password: 'MotDePasse-Essai-2026' };

let current = null;
// Code TOTP (RFC 6238) calculé comme le ferait l'application d'authentification.
function totp(secret, step = 0) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '')) bits += alpha.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + step));
  const h = require('node:crypto').createHmac('sha1', key).update(ctr).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
(async () => {
  const log = [];
  // ---------- poste principal
  const hA = mk('principal');
  const A = await launch(hA);
  let wa = await A.firstWindow();
  current = wa;
  await wa.waitForSelector('#main');
  await wa.screenshot({ path: path.join(OUT, 'off-launcher.png') });
  await wa.click('#main');
  await wa.waitForURL(/https:\/\/127\.0\.0\.1:8443/, { timeout: 120_000 });
  await wa.waitForSelector('#setupform:not(.hidden)', { timeout: 30_000 });
  await wa.screenshot({ path: path.join(OUT, 'off-setup.png') });
  await wa.fill('#setupform [name=fullName]', 'Administrateur Essai');
  await wa.fill('#setupform [name=email]', ADMIN.email);
  await wa.fill('#setupform [name=password]', ADMIN.password);
  await wa.click('#setupform button');
  await wa.waitForSelector('#loginform:not(.hidden)');
  await wa.fill('#loginform [name=email]', ADMIN.email);
  await wa.fill('#loginform [name=password]', ADMIN.password);
  await wa.click('#loginform button');
  await wa.waitForSelector('#enroll:not(.hidden)');
  const secret = (await wa.textContent('#mfasecret')).trim();
  await wa.fill('#enrollform [name=code]', totp(secret));
  await wa.click('#enrollform button:not(.secondary)');
  await wa.waitForSelector('#recovery:not(.hidden)');
  await wa.click('[data-act=enter-app]');
  await wa.waitForSelector('.stat-tiles', { timeout: 30_000 });
  await wa.screenshot({ path: path.join(OUT, 'off-principal.png') });
  const certPem = fs.readFileSync(path.join(hA, '.config', 'RAHA TRANSPORT RTMS', 'donnees', 'tls-cert.pem'), 'utf8');
  const mainFp = new (require('node:crypto').X509Certificate)(certPem).fingerprint256;
  log.push(`poste principal prêt, empreinte ${mainFp}`);
  assert.strictEqual(JSON.parse(fs.readFileSync(cfgFile(hA), 'utf8')).mode, 'main');

  // ---------- poste de travail
  const hB = mk('poste');
  let B = await launch(hB);
  let wb = await B.firstWindow();
  current = wb;
  current = wb;
  await wb.waitForSelector('#scan');
  await wb.click('#scan');
  await wb.waitForSelector('#servers li', { timeout: 10_000 });
  log.push(`découverte : ${await wb.textContent('#servers li')}`);
  await wb.click('#servers li button');
  await wb.waitForSelector('#confirm:not([hidden])');
  const fp = await wb.textContent('#fp');
  assert.strictEqual(fp, mainFp, 'empreinte affichée différente du certificat réel');
  await wb.screenshot({ path: path.join(OUT, 'off-empreinte.png') });
  await wb.click('#trust');
  await wb.waitForSelector('#loginform:not(.hidden)', { timeout: 20_000 });
  assert.ok(/^https:\/\//.test(wb.url()), wb.url());
  await wb.fill('#loginform [name=email]', ADMIN.email);
  await wb.fill('#loginform [name=password]', ADMIN.password);
  await wb.click('#loginform button');
  await wb.waitForSelector('#mfaform:not(.hidden)');
  await wb.fill('#mfaform [name=code]', totp(secret, 1)); // pas suivant : un code déjà utilisé est refusé
  await wb.click('#mfaform button:not(.secondary)');
  await wb.waitForSelector('.stat-tiles', { timeout: 20_000 });
  await wb.screenshot({ path: path.join(OUT, 'off-poste.png') });
  const cB = JSON.parse(fs.readFileSync(cfgFile(hB), 'utf8'));
  assert.strictEqual(cB.mode, 'client');
  assert.strictEqual(cB.fingerprint, fp);
  log.push(`poste de travail connecté à ${cB.serverUrl}`);
  await B.close();

  // ---------- empreinte falsifiée : la connexion doit être bloquée
  fs.writeFileSync(cfgFile(hB), JSON.stringify({ ...cB, fingerprint: 'AA:'.repeat(31) + 'AA' }));
  B = await launch(hB);
  wb = await B.firstWindow();
  current = wb;
  await wb.waitForSelector('#certwarn:not([hidden])', { timeout: 20_000 });
  await wb.screenshot({ path: path.join(OUT, 'off-empreinte-changee.png') });
  log.push('empreinte falsifiée : connexion bloquée, avertissement affiché');
  await B.close();

  // ---------- arrêt propre du poste principal
  await A.evaluate(({ app }) => app.quit());
  await A.waitForEvent('close', { timeout: 60_000 }).catch(() => {});
  console.log(log.join('\n'));
  console.log('E2E HORS LIGNE OK');
})().catch(async (e) => {
  console.error(e);
  if (current) { try { await current.screenshot({ path: path.join(OUT, 'off-echec.png') }); console.error('URL', current.url(), await current.locator('body').innerText()); } catch { /* fenêtre fermée */ } }
  process.exit(1);
});
