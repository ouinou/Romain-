/**
 * Montants comptables : entiers dans la plus petite unité de la devise (FCFA : 0 décimale).
 * PostgreSQL renvoie bigint et numeric sous forme de texte ; on les convertit en vérifiant
 * qu'ils restent exactement représentables en JavaScript (jusqu'à 9 007 199 254 740 991).
 */
export const MONTANT_MAX = 999_999_999_999_999; // 10^15 - 1, bien en deçà de la limite des entiers exacts

export function versEntier(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Montant hors limites : ${v}`);
  return n;
}
