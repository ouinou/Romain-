/**
 * Application des migrations SQL versionnées (prisma/migrations) sans la CLI Prisma,
 * pour que le poste principal fonctionne hors ligne. Tenue du registre _prisma_migrations
 * au même format que Prisma : une base locale peut ensuite être gérée par `prisma migrate`.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';

export async function applyMigrations(client: pg.Client, migrationsDir: string, log: (m: string) => void = () => {}) {
  await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
  const done = new Map((await client.query<{ migration_name: string; checksum: string }>(
    'SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map((r) => [r.migration_name, r.checksum]));
  const names = fs.readdirSync(migrationsDir).filter((d) => fs.existsSync(path.join(migrationsDir, d, 'migration.sql'))).sort();
  const applied: string[] = [];
  for (const name of names) {
    const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (done.has(name)) {
      if (done.get(name) !== checksum) throw new Error(`Migration ${name} modifiée après application : arrêt par sécurité.`);
      continue;
    }
    log(`migration ${name}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)', [randomUUID(), checksum, name]);
      await client.query('COMMIT');
      applied.push(name);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Échec de la migration ${name} : ${(e as Error).message}`);
    }
  }
  return applied;
}
