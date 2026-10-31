// Construit l'installateur Windows (NSIS) et l'archive portable sous Linux, sans Wine.
// Prérequis : `npx electron-builder --win dir --x64` a produit dist/win-unpacked.
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const appDir = path.join(root, 'dist', 'win-unpacked');
if (!fs.existsSync(path.join(appDir, 'RAHA TRANSPORT RTMS.exe'))) throw new Error('dist/win-unpacked absent : lancer d’abord electron-builder --win dir');

const cache = path.join(os.homedir(), '.cache', 'electron-builder');
const nsisRoot = fs.readdirSync(cache).filter((d) => d.startsWith('nsis-3')).map((d) => path.join(cache, d))
  .flatMap((d) => fs.readdirSync(d).map((x) => path.join(d, x))).find((d) => fs.existsSync(path.join(d, 'linux', 'makensis')));
if (!nsisRoot) throw new Error('NSIS introuvable dans le cache electron-builder');

const out = path.join(root, 'dist', `RTMS-Setup-${version}.exe`);
execFileSync(path.join(nsisRoot, 'linux', 'makensis'), [
  '-V2', `-DVERSION=${version}`, `-DOUTFILE=${out}`, `-DAPPDIR=${appDir}`,
  `-DBUILDDIR=${path.join(root, 'build')}`, `-DINSTDIR_RES=${path.join(root, 'installer')}`,
  path.join(root, 'installer', 'rtms.nsi'),
], { stdio: 'inherit', env: { ...process.env, NSISDIR: nsisRoot } });
console.log(`Installateur : ${out}`);

const zip = path.join(root, 'dist', `RTMS-Portable-${version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('python3', ['-c', `import shutil; shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))}, 'zip', ${JSON.stringify(path.dirname(appDir))}, 'win-unpacked')`], { stdio: 'inherit' });
console.log(`Version portable : ${zip}`);
