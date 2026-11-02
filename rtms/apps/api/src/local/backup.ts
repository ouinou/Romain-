/**
 * Sauvegarde logique du poste principal, sans pg_dump (absent de PostgreSQL intégré).
 * - Lecture cohérente (transaction REPEATABLE READ en lecture seule) de toutes les tables.
 * - Fichier .rtmsbak : JSON ligne par ligne, compressé gzip, avec empreinte SHA-256.
 * - Restauration dans une base neuve (migrations puis données, déclencheurs suspendus pour
 *   garder le journal d'audit à l'identique), contrôle de la chaîne d'audit, puis bascule.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';
import { applyMigrations } from './migrate.js';

const TABLES = ['companies', 'users', 'role_permissions', 'records', 'audit_log', 'installation', 'licenses', 'license_activations', 'license_events', 'document_counters'];
const SEQUENCES: [string, string][] = [['audit_log', 'audit_log_id_seq'], ['license_events', 'license_events_id_seq']];

async function columns(c: pg.Client, table: string) {
  const r = await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`, [table]);
  return r.rows.map((x) => x.column_name);
}

export interface BackupResult { file: string; size: number; rows: number; sha256: string; at: string }

export async function createBackup(conn: pg.ClientConfig, dir: string, opts: { keep?: number; copyTo?: string; version?: string } = {}): Promise<BackupResult> {
  fs.mkdirSync(dir, { recursive: true });
  const at = new Date();
  const name = `rtms-${at.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.rtmsbak`;
  const tmp = path.join(dir, `${name}.part`);
  const c = new pg.Client(conn);
  await c.connect();
  let rows = 0;
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const migrations = (await c.query<{ migration_name: string }>('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows.map((r) => r.migration_name);
    const gz = zlib.createGzip({ level: 6 });
    const out = fs.createWriteStream(tmp, { mode: 0o600 });
    gz.pipe(out);
    const write = (o: unknown) => gz.write(`${JSON.stringify(o)}\n`);
    write({ format: 'rtms-backup', formatVersion: 1, appVersion: opts.version, createdAt: at.toISOString(), migrations, tables: TABLES });
    for (const t of TABLES) {
      const cols = await columns(c, t);
      const res = await c.query<{ j: string }>(`SELECT json_build_object(${cols.map((x) => `'${x}', "${x}"`).join(', ')})::text AS j FROM "${t}"`);
      for (const r of res.rows) { gz.write(`{"t":"${t}","r":${r.j}}\n`); rows++; }
    }
    await c.query('COMMIT');
    await new Promise<void>((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); gz.end(); });
  } finally {
    await c.end();
  }
  const file = path.join(dir, name);
  fs.renameSync(tmp, file);
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(`${file}.sha256`, `${sha256}  ${name}\n`);
  if (opts.copyTo) {
    try { fs.mkdirSync(opts.copyTo, { recursive: true }); fs.copyFileSync(file, path.join(opts.copyTo, name)); fs.copyFileSync(`${file}.sha256`, path.join(opts.copyTo, `${name}.sha256`)); } catch { /* clé USB absente : la copie locale reste */ }
  }
  // Rotation : on garde les N plus récentes
  const keep = opts.keep ?? 30;
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.rtmsbak')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) { fs.rmSync(path.join(dir, old), { force: true }); fs.rmSync(path.join(dir, `${old}.sha256`), { force: true }); }
  return { file, size: fs.statSync(file).size, rows, sha256, at: at.toISOString() };
}

export function listBackups(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.rtmsbak')).sort().reverse()
    .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtime.toISOString() }));
}

/**
 * Restaure une sauvegarde dans la base `target` (créée à neuf). Le serveur applicatif doit être
 * arrêté pendant la bascule. Renvoie le nombre de lignes et le résultat du contrôle d'audit.
 */
export async function restoreBackup(superConn: pg.ClientConfig, ownerConn: (db: string) => pg.ClientConfig, file: string, migrationsDir: string, target: string) {
  const expected = fs.existsSync(`${file}.sha256`) ? fs.readFileSync(`${file}.sha256`, 'utf8').split(/\s+/)[0] : null;
  const buf = fs.readFileSync(file);
  if (expected && createHash('sha256').update(buf).digest('hex') !== expected) throw new Error('Empreinte invalide : fichier de sauvegarde altéré ou incomplet.');
  const lines = zlib.gunzipSync(buf).toString('utf8').split('\n').filter(Boolean);
  const head = JSON.parse(lines[0]!);
  if (head.format !== 'rtms-backup') throw new Error('Ce fichier n’est pas une sauvegarde RTMS.');

  const admin = new pg.Client(superConn);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${target}"`);
  await admin.query(`CREATE DATABASE "${target}" OWNER rtms_owner`);
  await admin.end();

  // 1. Structure : mêmes migrations que la sauvegarde (les plus récentes seront appliquées au démarrage)
  const own = new pg.Client(ownerConn(target));
  await own.connect();
  await applyMigrations(own, migrationsDir);
  await own.end();

  // 2. Données, déclencheurs suspendus (journal d'audit restauré à l'identique)
  const su = new pg.Client({ ...superConn, database: target });
  await su.connect();
  let rows = 0;
  try {
    await su.query('BEGIN');
    await su.query('SET LOCAL session_replication_role = replica');
    const colCache = new Map<string, string[]>();
    for (const line of lines.slice(1)) {
      const { t, r } = JSON.parse(line) as { t: string; r: Record<string, unknown> };
      if (!TABLES.includes(t)) continue;
      if (!colCache.has(t)) colCache.set(t, await columns(su, t));
      const cols = colCache.get(t)!.filter((c) => c in r);
      await su.query(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM json_populate_record(null::"${t}", $1::json)`, [JSON.stringify(r)]);
      rows++;
    }
    for (const [t, seq] of SEQUENCES) await su.query(`SELECT setval('${seq}', GREATEST((SELECT COALESCE(max(id), 0) FROM "${t}"), 1))`);
    await su.query('COMMIT');
    const broken = await su.query<{ n: string }>('SELECT count(*) AS n FROM companies c WHERE audit_verify(c.id) IS NOT NULL');
    return { rows, auditIntact: broken.rows[0]!.n === '0', createdAt: head.createdAt as string };
  } catch (e) {
    await su.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await su.end();
  }
}
