import { ErreurHttp } from "../../http/erreurs.js";

/**
 * Traduit les refus de PostgreSQL (déclencheurs et contraintes de la migration 004) en erreurs lisibles.
 * Les messages des déclencheurs sont déjà en français ; ceux des contraintes sont remplacés.
 */
export function traduireErreurBase(e: unknown): never {
  const err = e as { code?: string; message?: string; constraint?: string };
  const francais = err.message && !/violates|duplicate key|conflicting key/i.test(err.message);
  switch (err.code) {
    case "42501":
      if (francais) throw new ErreurHttp(409, "regle_comptable", err.message!);
      break;
    case "23514":
      if (francais) throw new ErreurHttp(409, "regle_comptable", err.message!);
      throw new ErreurHttp(400, "donnees_invalides", `Données refusées par la base (contrôle ${err.constraint ?? "inconnu"}).`);
    case "23505":
      throw new ErreurHttp(409, "doublon", "Cet élément existe déjà (numéro ou code déjà utilisé).");
    case "23P01":
      throw new ErreurHttp(409, "chevauchement", "Cet exercice chevauche un exercice existant.");
    case "23503":
      throw new ErreurHttp(400, "reference_invalide", "Un élément référencé (compte, journal, exercice) n'existe pas dans cette entreprise.");
  }
  throw e;
}

/** Exécute une opération et traduit les refus de la base. */
export async function avecReglesBase<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) { if (e instanceof ErreurHttp) throw e; return traduireErreurBase(e); }
}
