// Retour à l'écran de choix : ancien réglage « démo » ignoré, raccourci --choisir-role.
const { _electron: electron } = require('playwright');
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os'); const assert = require('node:assert');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rtms-role-'));
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }; delete env.RTMS_DEMO;
const cfgDir = path.join(home, '.config', 'RAHA TRANSPORT RTMS');
const cfg = (c) => { fs.mkdirSync(cfgDir, { recursive: true }); fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify(c)); };
const read = () => JSON.parse(fs.readFileSync(path.join(cfgDir, 'config.json'), 'utf8'));
const run = async (extra) => {
  const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(__dirname, '..'), ...extra], env });
  const w = await app.firstWindow(); await w.waitForSelector('#main'); const url = w.url(); await app.close(); return url;
};
(async () => {
  cfg({ mode: 'demo' });
  assert.match(await run([]), /launcher\.html/); assert.strictEqual(read().mode, undefined);
  cfg({ mode: 'client', serverUrl: 'https://127.0.0.1:9', fingerprint: 'AA', backupCopyDir: 'X' });
  assert.match(await run(['--choisir-role']), /launcher\.html/);
  const c = read(); assert.strictEqual(c.mode, undefined); assert.strictEqual(c.serverUrl, undefined); assert.strictEqual(c.backupCopyDir, 'X');
  console.log('OK : réglage démo ignoré, --choisir-role ramène au choix du poste');
})().catch((e) => { console.error(e); process.exit(1); });
