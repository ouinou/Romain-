import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrer } from "../domaine/migrations.js";
import { executer, poolProprietaire } from "./outils.js";

/** Remonte depuis ce fichier jusqu'au dossier qui contient migrations/ (fonctionne depuis src/ ou dist/). */
function dossierMigrations() {
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, d = dirname(d)) if (existsSync(join(d, "migrations"))) return join(d, "migrations");
  throw new Error("Dossier migrations/ introuvable.");
}

await executer(async () => {
  const pool = poolProprietaire();
  try { await migrer(pool, dossierMigrations()); } finally { await pool.end(); }
});
