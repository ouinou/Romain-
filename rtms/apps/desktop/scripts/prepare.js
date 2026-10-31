// Prépare le paquet : copie de l'application web (pour le mode démonstration hors ligne)
// et génération de l'icône Windows à partir du logo officiel.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const web = path.join(__dirname, '..', '..', 'web');
const out = path.join(__dirname, '..', 'webapp');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'demo.html', 'app.css']) fs.copyFileSync(path.join(web, f), path.join(out, f));
for (const d of ['src', 'assets']) fs.cpSync(path.join(web, d), path.join(out, d), { recursive: true });
console.log('Application web copiée dans webapp/');

(async () => {
  const pngToIco = (await import('png-to-ico')).default;
  const build = path.join(__dirname, '..', 'build');
  const ico = await pngToIco(path.join(build, 'icon-256.png'));
  fs.writeFileSync(path.join(build, 'icon.ico'), ico);
  console.log('Icône Windows générée : build/icon.ico');
})().catch((e) => { console.error(e); process.exit(1); });
