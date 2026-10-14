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
