import { spawn } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { creerPool } from "../db.js";

/** Connexion « propriétaire » (gc_owner), réservée aux outils d'exploitation. */
export function poolProprietaire() {
  const url = process.env.GC_BASE_PROPRIETAIRE;
  if (!url) throw new Error("GC_BASE_PROPRIETAIRE manque (ex. postgres://gc_owner:motdepasse@localhost:5432/gestionnaire_comptable).");
  return creerPool(url, 2);
}

export function options<T extends Record<string, { type: "string" | "boolean" }>>(def: T) {
  return parseArgs({ options: def, strict: true }).values;
}

export async function executer(fn: () => Promise<void>) {
  try { await fn(); }
  catch (e) { console.error("Erreur :", e instanceof Error ? e.message : e); process.exitCode = 1; }
}

/** Outils PostgreSQL (pg_dump, pg_restore) : dans le PATH, ou dans GC_PG_BIN sous Windows. */
export const executable = (nom: string) => (process.env.GC_PG_BIN ? join(process.env.GC_PG_BIN, nom) : nom);

export function lancer(cmd: string, args: string[]) {
  return new Promise<void>((ok, ko) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", ko);
    p.on("exit", (code) => (code === 0 ? ok() : ko(new Error(`${cmd} s'est terminé avec le code ${code}.`))));
  });
}
