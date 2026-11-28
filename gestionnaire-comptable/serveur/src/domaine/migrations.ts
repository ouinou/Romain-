import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Pool } from "../db.js";

/**
 * Applique les fichiers migrations/NNN_*.sql non encore appliqués, chacun dans sa transaction.
 * L'empreinte de chaque fichier est conservée : un fichier déjà appliqué puis modifié bloque la migration.
 */
export async function migrer(pool: Pool, dossier: string, log = console.log) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const { rows } = await pool.query("SELECT version, sha256 FROM schema_migrations");
  const faites = new Map(rows.map((r) => [r.version, r.sha256]));
  const fichiers = readdirSync(dossier).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  let n = 0;
  for (const f of fichiers) {
    const sql = readFileSync(join(dossier, f), "utf8");
    const h = createHash("sha256").update(sql).digest("hex");
    if (faites.has(f)) {
      if (faites.get(f) !== h) throw new Error(`La migration ${f} a été modifiée après application. Créez une nouvelle migration au lieu de la changer.`);
      continue;
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(sql);
      await c.query("INSERT INTO schema_migrations (version, sha256) VALUES ($1,$2)", [f, h]);
      const { rows: [j] } = await c.query("SELECT to_regclass('public.system_events') IS NOT NULL AS existe");
      if (j.existe) await c.query("INSERT INTO system_events (event_type, outcome, details) VALUES ('schema.migrate','success',$1)", [JSON.stringify({ version: f })]);
      await c.query("COMMIT");
      log(`Migration appliquée : ${f}`); n++;
    } catch (e) {
      await c.query("ROLLBACK");
      throw new Error(`Échec de ${f} : ${(e as Error).message}`);
    } finally { c.release(); }
  }
  if (!n) log("Base déjà à jour.");
  return n;
}
