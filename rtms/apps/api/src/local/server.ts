/**
 * RTMS — serveur du POSTE PRINCIPAL, 100 % hors ligne.
 *
 * Lancé par l'application Windows sur le poste choisi comme « poste principal » :
 * - PostgreSQL 16 intégré, joignable uniquement depuis ce poste (127.0.0.1) ;
 * - serveur RTMS en HTTPS sur le réseau local (câble ou wifi de la box, sans Internet) ;
 * - découverte automatique par les autres postes ; sauvegarde quotidienne automatique.
 *
 * Usage :  node dist/local/server.js                 (démarrage normal)
 *          node dist/local/server.js --restore FICHIER (restauration, serveur arrêté)
 * Variables : RTMS_DATA_DIR (obligatoire), RTMS_PORT (8443), RTMS_PG_PORT (54329),
 *   RTMS_BACKUP_COPY_DIR (copie des sauvegardes, ex. clé USB), RTMS_DEVICE_ID,
 *   RTMS_WEB_ROOT, RTMS_MIGRATIONS_DIR, RTMS_LICENSE_ENFORCEMENT (warn), RTMS_LICENSE_PUBLIC_KEY_PEM,
 *   RTMS_TRIAL_DAYS (14).
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { buildApp } from '../app.js';
import { closeContext, createContext } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { createPrisma } from '../db.js';
import { APP_VERSION } from '../version.js';
import { createBackup, listBackups, restoreBackup } from './backup.js';
import { startDiscoveryResponder } from './discovery.js';
import { applyMigrations } from './migrate.js';
import { loadOrCreateSecrets } from './secrets.js';
import { localRoutes } from './setupRoutes.js';
import { loadOrCreateTls } from './tls.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const DATA = env.RTMS_DATA_DIR;
if (!DATA) { console.error('RTMS_DATA_DIR manquant'); process.exit(2); }
const BASE_PORT = Number(env.RTMS_PORT || 8443);
let PORT = BASE_PORT;
const PG_PORT = Number(env.RTMS_PG_PORT || 54329);
const MIGRATIONS = env.RTMS_MIGRATIONS_DIR || path.resolve(here, '../../prisma/migrations');
const WEB_ROOT = env.RTMS_WEB_ROOT || path.resolve(here, '../../../web');
const BACKUP_DIR = path.join(DATA, 'sauvegardes');
const DB = 'rtms';

const emit = (event: string, data: object = {}) => process.stdout.write(`RTMS_EVENT ${JSON.stringify({ event, ...data })}\n`);
const log = (m: string) => emit('log', { message: m });

/** pg_ctl du paquet PostgreSQL intégré (Windows ou Linux). */
async function pgCtl(): Promise<string | null> {
  const pkg = process.platform === 'win32' ? '@embedded-postgres/windows-x64' : process.platform === 'linux' ? '@embedded-postgres/linux-x64' : null;
  if (!pkg) return null;
  try { return ((await import(pkg as string)) as { pg_ctl: string }).pg_ctl; } catch { return null; }
}

/** Le port TCP est-il libre sur toutes les interfaces ? */
function portFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ host: '0.0.0.0', port }, () => srv.close(() => resolve(true)));
  });
}

/** Demande l'arrêt propre d'un ancien serveur RTMS de ce poste (même dossier de données, même jeton). */
function askShutdown(port: number, token: string) {
  return new Promise<boolean>((resolve) => {
    const req = https.request({ host: '127.0.0.1', port, path: '/api/local/shutdown', method: 'POST', rejectUnauthorized: false, timeout: 3000, headers: { 'x-rtms-shutdown': token, 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end('{}');
  });
}

/**
 * Avant de démarrer : un ancien RTMS peut être resté ouvert (application fermée de force,
 * mise à jour par-dessus). On lui demande de s'arrêter proprement ; une base PostgreSQL restée
 * en marche sur notre dossier est arrêtée ; enfin, si le port est pris par un autre logiciel,
 * on prend le suivant (les autres postes retrouvent le poste principal par la découverte).
 */
async function freeTheWay(token: string) {
  let asked = false;
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) if (!(await portFree(p)) && (await askShutdown(p, token))) { asked = true; log(`ancien serveur RTMS arrêté (port ${p})`); }
  const pid = path.join(DATA!, 'pgdata', 'postmaster.pid');
  for (let i = 0; asked && i < 60 && fs.existsSync(pid); i++) await new Promise((r) => setTimeout(r, 500));
  if (fs.existsSync(pid)) {
    const ctl = await pgCtl();
    if (ctl) {
      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync(ctl, ['stop', '-D', path.join(DATA!, 'pgdata'), '-m', 'fast', '-w', '-t', '30'], { stdio: 'ignore', windowsHide: true });
        log('base de données restée ouverte : arrêtée proprement');
      } catch { /* aucune base en marche : fichier de verrou périmé, PostgreSQL le gère */ }
    }
  }
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    if (await portFree(p)) { if (p !== BASE_PORT) log(`port ${BASE_PORT} occupé par un autre logiciel : port ${p} utilisé`); return p; }
  }
  throw new Error(`Ports ${BASE_PORT} à ${BASE_PORT + 9} tous occupés sur ce poste`);
}

async function startPostgres(superPassword: string) {
  const dir = path.join(DATA!, 'pgdata');
  const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
  const pgInst = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password: superPassword, port: PG_PORT, persistent: true,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // La base n'écoute que le poste lui-même : les autres postes passent par le serveur RTMS
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=60'],
    onLog: () => {}, onError: (m: unknown) => log(`postgres : ${String(m).slice(0, 300)}`),
  });
  if (fresh) { log('création de la base de données (premier démarrage)'); await pgInst.initialise(); }
  await pgInst.start();
  return pgInst;
}

/**
 * Arrêt propre de PostgreSQL. Sous Windows, le paquet intégré tue le processus (taskkill /f),
 * ce qui force une récupération au démarrage suivant : on demande d'abord un arrêt « fast »
 * à pg_ctl, qui termine les transactions et écrit un point de contrôle.
 */
async function stopPostgres(pgInst: EmbeddedPostgres) {
  if (process.platform === 'win32') {
    try {
      const ctl = await pgCtl();
      const { execFileSync } = await import('node:child_process');
      if (ctl) execFileSync(ctl, ['stop', '-D', path.join(DATA!, 'pgdata'), '-m', 'fast', '-w', '-t', '30'], { stdio: 'ignore', windowsHide: true });
    } catch { /* déjà arrêté : le repli ci-dessous suffit */ }
  }
  await pgInst.stop().catch(() => {});
}

const superConn = (password: string, database = 'postgres'): pg.ClientConfig => ({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', password, database });
const roleUrl = (user: string, password: string, extra = '') => `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${PG_PORT}/${DB}${extra}`;

async function prepareDatabase(s: ReturnType<typeof loadOrCreateSecrets>) {
  const su = new pg.Client(superConn(s.pgSuperPassword));
  await su.connect();
  await su.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtms_owner') THEN CREATE ROLE rtms_owner LOGIN CREATEROLE; END IF; END $$`);
  await su.query(`ALTER ROLE rtms_owner LOGIN CREATEROLE PASSWORD '${s.ownerPassword.replace(/'/g, "''")}'`);
  const exists = (await su.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB])).rowCount;
  if (!exists) await su.query(`CREATE DATABASE "${DB}" OWNER rtms_owner`);
  await su.end();

  const own = new pg.Client({ host: '127.0.0.1', port: PG_PORT, user: 'rtms_owner', password: s.ownerPassword, database: DB });
  await own.connect();
  const applied = await applyMigrations(own, MIGRATIONS, log);
  // Les rôles créés par la migration 0002 sont sans connexion : on les active avec les secrets locaux
  await own.query(`ALTER ROLE rtms_app LOGIN PASSWORD '${s.appPassword.replace(/'/g, "''")}'`);
  await own.query(`ALTER ROLE rtms_license LOGIN PASSWORD '${s.licensePassword.replace(/'/g, "''")}'`);
  await own.end();
  return applied;
}

async function restoreMode(file: string) {
  const s = loadOrCreateSecrets(DATA!);
  const pgInst = await startPostgres(s.pgSuperPassword);
  try {
    await prepareDatabase(s);
    emit('restore-start', { file });
    const r = await restoreBackup(superConn(s.pgSuperPassword), (db) => ({ host: '127.0.0.1', port: PG_PORT, user: 'rtms_owner', password: s.ownerPassword, database: db }), file, MIGRATIONS, 'rtms_restore');
    if (!r.auditIntact) throw new Error('Contrôle d’intégrité du journal d’audit en échec sur la sauvegarde : restauration annulée.');
    // Bascule : la base actuelle est conservée sous un autre nom (retour arrière possible)
    const su = new pg.Client(superConn(s.pgSuperPassword));
    await su.connect();
    const keep = `rtms_avant_restauration_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
    await su.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${DB}', 'rtms_restore') AND pid <> pg_backend_pid()`);
    await su.query(`ALTER DATABASE "${DB}" RENAME TO "${keep}"`);
    await su.query(`ALTER DATABASE rtms_restore RENAME TO "${DB}"`);
    await su.end();
    emit('restore-done', { rows: r.rows, backupDate: r.createdAt, previousDatabase: keep });
  } finally {
    await stopPostgres(pgInst);
  }
}

async function main() {
  const restoreIdx = process.argv.indexOf('--restore');
  if (restoreIdx > 0) return restoreMode(process.argv[restoreIdx + 1]!);

  fs.mkdirSync(DATA!, { recursive: true });
  const s = loadOrCreateSecrets(DATA!);
  const tls = await loadOrCreateTls(DATA!);
  PORT = await freeTheWay(s.shutdownToken!);
  let stopping = false;
  let stopImpl: () => Promise<void> = async () => {};
  const stop = () => { if (!stopping) { stopping = true; void stopImpl(); } };
  const pgInst = await startPostgres(s.pgSuperPassword);
  const applied = await prepareDatabase(s);
  if (applied.length) log(`migrations appliquées : ${applied.join(', ')}`);

  const config = await loadConfig({
    ...env,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: String(PORT),
    PUBLIC_ORIGIN: `https://localhost:${PORT}`,
    ORIGIN_MATCH_HOST: 'true',
    DATABASE_URL: roleUrl('rtms_app', s.appPassword, '?connection_limit=15'),
    REDIS_URL: 'memory',
    DATA_ENCRYPTION_KEYS: s.dataKeys,
    COOKIE_SECURE: 'true',
    WEB_ROOT,
    INSTANCE_NAME: `LOCAL · ${os.hostname()}`,
    LICENSE_ENFORCEMENT: env.RTMS_LICENSE_ENFORCEMENT || 'warn',
    // 14 jours d'essai gratuit, puis le logiciel se bloque jusqu'à l'activation d'une licence
    LICENSE_TRIAL_DAYS: env.RTMS_TRIAL_DAYS || '14',
    LICENSE_PUBLIC_KEY_PEM: env.RTMS_LICENSE_PUBLIC_KEY_PEM,
    LICENSE_ISSUER_URL: undefined,
    SENTRY_DSN: undefined,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    LOG_LEVEL: env.LOG_LEVEL || 'warn',
    RTMS_DEVICE_ID: env.RTMS_DEVICE_ID,
  });
  const ctx = await createContext(config);
  ctx.license.startClock();
  log(`licence : ${ctx.license.status().reason ?? ctx.license.status().state}`);
  const owner = createPrisma(roleUrl('rtms_owner', s.ownerPassword, '?connection_limit=3'));

  // ---------- sauvegardes automatiques ----------
  let lastBackup: { at: string; ok: boolean; error?: string } | null = null;
  const backupNow = async () => {
    try {
      const r = await createBackup(superConn(s.pgSuperPassword, DB), BACKUP_DIR, { keep: 30, copyTo: env.RTMS_BACKUP_COPY_DIR || undefined, version: APP_VERSION });
      lastBackup = { at: r.at, ok: true };
      emit('backup', { ...r });
      return r;
    } catch (e) {
      lastBackup = { at: new Date().toISOString(), ok: false, error: (e as Error).message };
      emit('backup-error', { error: (e as Error).message });
      throw e;
    }
  };
  const due = () => {
    const last = listBackups(BACKUP_DIR)[0];
    return !last || Date.now() - Date.parse(last.at) > 20 * 3600_000;
  };
  setTimeout(() => { if (due()) backupNow().catch(() => {}); }, 60_000).unref();
  setInterval(() => { if (due()) backupNow().catch(() => {}); }, 3600_000).unref();

  const app = await buildApp(ctx, {
    https: { key: tls.key, cert: tls.cert },
    logger: false,
    extraRoutes: localRoutes(ctx, owner, {
      list: () => listBackups(BACKUP_DIR),
      now: backupNow,
      info: () => ({ directory: BACKUP_DIR, copyTo: env.RTMS_BACKUP_COPY_DIR || null, last: lastBackup }),
    }, { token: s.shutdownToken!, run: () => void stop() }),
  });
  await app.listen({ host: '0.0.0.0', port: PORT });

  let companyName = '';
  const refreshName = async () => { try { companyName = (await owner.company.findFirst({ select: { name: true } }))?.name ?? ''; } catch { /* base vide */ } };
  await refreshName();
  setInterval(() => void refreshName(), 60_000).unref();
  const disco = startDiscoveryResponder(() => ({ name: os.hostname(), port: PORT, fingerprint: tls.fingerprint, version: APP_VERSION, company: companyName }));
  emit('ready', { port: PORT, fingerprint: tls.fingerprint, dataDir: DATA, backups: BACKUP_DIR });

  // (déclarée plus haut pour la route d'arrêt)
  stopImpl = async () => {
    disco.close();
    await app.close().catch(() => {});
    await closeContext(ctx).catch(() => {});
    await owner.$disconnect().catch(() => {});
    await stopPostgres(pgInst);
    emit('stopped');
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('message', (m) => { if (m === 'stop') stop(); });
  // Lancé par l'application de bureau : si elle disparaît (fermeture forcée), le serveur s'arrête aussi
  if (env.RTMS_STOP_WITH_PARENT === '1') process.stdin.on('end', stop);
  // Commandes de l'application de bureau (icône près de l'horloge)
  process.stdin.on('data', (d) => {
    const cmd = d.toString().trim();
    if (cmd === 'stop') stop();
    if (cmd === 'backup') backupNow().catch(() => {});
  });
}

main().catch((e) => {
  emit('fatal', { error: e instanceof Error ? e.message : String(e) });
  console.error(e);
  process.exit(1);
});
