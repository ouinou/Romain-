import { ErreurHttp } from "../../http/erreurs.js";

/**
 * Traduit les refus de PostgreSQL (déclencheurs et contraintes de la migration 005) en erreurs lisibles.
 * Les messages des déclencheurs sont déjà en français (stock insuffisant, inventaire clos…).
 */
export function traduireErreurBase(e: unknown): never {
  const err = e as { code?: string; message?: string; constraint?: string };
  const francais = err.message && !/violates|duplicate key|conflicting key|permission denied/i.test(err.message);
  switch (err.code) {
    case "23514":
    case "P0001":
      if (francais) throw new ErreurHttp(409, "regle_metier", err.message!);
      throw new ErreurHttp(400, "donnees_invalides", `Données refusées par la base (contrôle ${err.constraint ?? "inconnu"}).`);
    case "23505":
      if (err.constraint === "products_barcode_unique") throw new ErreurHttp(409, "doublon", "Ce code-barres est déjà attribué à un autre produit.");
      if (err.constraint === "lots_numero_unique") throw new ErreurHttp(409, "doublon", "Ce numéro de lot existe déjà pour ce produit : complétez le lot existant au lieu d'en créer un second.");
      throw new ErreurHttp(409, "doublon", "Cet élément existe déjà (nom, code ou numéro déjà utilisé).");
    case "23503":
      throw new ErreurHttp(400, "reference_invalide", "Un élément référencé (catégorie, forme, emplacement, produit, lot) n'existe pas dans cette officine.");
  }
  throw e;
}

/** Exécute une opération et traduit les refus de la base. */
export async function avecReglesBase<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) { if (e instanceof ErreurHttp) throw e; return traduireErreurBase(e); }
}
