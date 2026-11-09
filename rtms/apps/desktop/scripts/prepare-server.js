// Prépare le serveur RTMS embarqué dans l'installateur Windows (rôle « poste principal ») :
// API compilée, migrations, application web, dépendances de production pour Windows x64
// (PostgreSQL intégré, moteur Prisma Windows, argon2 précompilé).
// Lancé sur Linux ou Windows : les paquets sont choisis pour la cible, pas pour la machine de build.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PLATFORM = process.env.RTMS_TARGET_OS || 'win32';
const api = path.join(__dirname, '..', '..', 'api');
const web = path.join(__dirname, '..', '..', 'web');
const out = path.join(__dirname, '..', 'build-server', 'server');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });

fs.rmSync(path.dirname(out), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. API compilée (tsc) + migrations
run(npm, ['run', 'build'], { cwd: api });
fs.cpSync(path.join(api, 'dist'), path.join(out, 'dist'), { recursive: true, filter: (f) => !f.endsWith('.map') });
fs.mkdirSync(path.join(out, 'prisma'));
fs.cpSync(path.join(api, 'prisma', 'migrations'), path.join(out, 'prisma', 'migrations'), { recursive: true });
// Moteur Prisma : celui de Windows (et celui de la machine de build, pour générer le client)
const schema = fs.readFileSync(path.join(api, 'prisma', 'schema.prisma'), 'utf8')
  .replace(/provider\s*=\s*"prisma-client-js"/, 'provider = "prisma-client-js"\n  binaryTargets = ["native", "windows"]');
fs.writeFileSync(path.join(out, 'prisma', 'schema.prisma'), schema);
for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(api, f), path.join(out, f));

// 2. Dépendances de production pour la cible (paquets optionnels Windows : PostgreSQL, etc.)
run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${PLATFORM}`, '--cpu=x64'], { cwd: out });

// 2 bis. PostgreSQL intégré : les liens symboliques (bibliothèques Linux) sont recréés en copies,
// car l'installation (--ignore-scripts) ne lance pas leur script et un installateur ne les conserve pas.
const pgDir = path.join(out, 'node_modules', '@embedded-postgres');
for (const pkg of fs.readdirSync(pgDir)) {
  const list = path.join(pgDir, pkg, 'native', 'pg-symlinks.json');
  if (!fs.existsSync(list)) continue;
  for (const { source, target } of JSON.parse(fs.readFileSync(list, 'utf8'))) {
    const src = path.join(pgDir, pkg, source), dst = path.join(pgDir, pkg, target); // chemins relatifs au paquet
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }
}

// 3. Client Prisma (contient le moteur Windows)
run(path.join(api, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma'), ['generate', '--schema', path.join(out, 'prisma', 'schema.prisma')], { cwd: out });

// 4. Nettoyage : moteurs et binaires inutiles sur la cible, fichiers de développement
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const clientDir = path.join(out, 'node_modules', '.prisma', 'client');
if (PLATFORM === 'win32') for (const f of fs.readdirSync(clientDir)) if (/^libquery_engine-.*\.so\.node$/.test(f)) rm(path.join(clientDir, f));
// Le client généré n'utilise que runtime/library.js (moteur natif) : variantes wasm/edge inutiles
const runtime = path.join(out, 'node_modules', '@prisma', 'client', 'runtime');
for (const f of fs.readdirSync(runtime)) if (/wasm|edge|react-native|^binary\./.test(f)) rm(path.join(runtime, f));
for (const f of fs.readdirSync(clientDir)) if (/wasm|^edge\.|query_engine_bg/.test(f)) rm(path.join(clientDir, f));
rm(path.join(out, 'node_modules', '@prisma', 'engines')); // moteurs du CLI (migrations : faites par notre propre migrateur)
rm(path.join(out, 'node_modules', 'prisma'));
rm(path.join(out, 'node_modules', '.bin'));
// Allègement de l'installateur : paquets inutiles au poste principal hors ligne.
// - supervision (Sentry, OpenTelemetry) : chargée seulement si configurée (serveur hébergé) ;
// - outillage du CLI Prisma (TypeScript, Babel, analyseurs…) : le client n'en a pas besoin.
const NM = path.join(out, 'node_modules');
// @opentelemetry/api reste : prom-client (métriques) en dépend
if (fs.existsSync(path.join(NM, '@opentelemetry'))) for (const d of fs.readdirSync(path.join(NM, '@opentelemetry'))) if (d !== 'api') rm(path.join(NM, '@opentelemetry', d));
for (const d of ['@sentry', '@sentry-internal', 'sentry', '@grpc', '@protobufjs', 'protobufjs', 'import-in-the-middle', 'require-in-the-middle',
  'typescript', '@babel', 'oxc-parser', '@oxc-parser', 'effect', 'fast-check', '@prisma/config', '@prisma/fetch-engine', '@prisma/get-platform', '@prisma/debug', '@types']) rm(path.join(NM, d));
// PostgreSQL : outils graphiques et traductions des messages (le français est gardé)
const pgNative = path.join(NM, '@embedded-postgres', `${PLATFORM === 'win32' ? 'windows' : PLATFORM}-x64`, 'native');
if (fs.existsSync(path.join(pgNative, 'bin'))) for (const f of fs.readdirSync(path.join(pgNative, 'bin'))) if (/^wx.*\.dll$|^testplug\.dll$/i.test(f)) rm(path.join(pgNative, 'bin', f));
const pgLocale = path.join(pgNative, 'share', 'locale');
if (fs.existsSync(pgLocale)) for (const d of fs.readdirSync(pgLocale)) if (d !== 'fr') rm(path.join(pgLocale, d));
const argonPrebuilds = path.join(out, 'node_modules', 'argon2', 'prebuilds');
if (fs.existsSync(argonPrebuilds)) for (const d of fs.readdirSync(argonPrebuilds)) if (!d.startsWith(`${PLATFORM}-x64`)) rm(path.join(argonPrebuilds, d));
(function prune(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (['test', 'tests', '__tests__', 'docs', 'example', 'examples'].includes(e.name) && !dir.endsWith('node_modules')) rm(p); else prune(p); }
    else if (/\.(md|markdown|map|ts)$/i.test(e.name) && !e.name.endsWith('.d.ts') && e.name !== 'LICENSE.md') rm(p);
  }
})(path.join(out, 'node_modules'));

// 5. Application web servie aux postes du réseau
fs.mkdirSync(path.join(out, 'web'));
for (const f of ['index.html', 'app.css']) fs.copyFileSync(path.join(web, f), path.join(out, 'web', f));
for (const d of ['src', 'assets']) fs.cpSync(path.join(web, d), path.join(out, 'web', d), { recursive: true, filter: (f) => !f.includes(`${path.sep}demo`) });

// Contrôles : les éléments Windows indispensables sont présents
const must = [
  ['node_modules', '@embedded-postgres', `${PLATFORM === 'win32' ? 'windows' : PLATFORM}-x64`],
  ['node_modules', '.prisma', 'client', 'index.js'],
  ['dist', 'local', 'server.js'],
  ['prisma', 'migrations', '0005_document_numbers', 'migration.sql'],
];
if (PLATFORM === 'win32') must.push(['node_modules', '.prisma', 'client', 'query_engine-windows.dll.node']);
for (const m of must) if (!fs.existsSync(path.join(out, ...m))) throw new Error(`Manquant dans le serveur embarqué : ${m.join('/')}`);
console.log(`Serveur embarqué prêt (${PLATFORM}) : ${out}`);
