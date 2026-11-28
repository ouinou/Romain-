/**
 * Calculs de facture en entiers exacts (BigInt) :
 *   montant de ligne = quantité × prix unitaire, arrondi à l'unité (demi vers le haut) ;
 *   TVA = total HT × taux (en pour dix mille), arrondie à l'unité (demi vers le haut).
 * Les mêmes formules sont contrôlées par PostgreSQL (migration 005).
 */
export function quantiteEnMilliemes(q: number): bigint {
  const m = Math.round(q * 1000);
  if (!Number.isFinite(q) || q <= 0 || Math.abs(m - q * 1000) > 1e-6 || m > 1e12) throw new Error("Quantité invalide (3 décimales au plus).");
  return BigInt(m);
}

export const montantLigne = (quantiteMilliemes: bigint, prixUnitaire: number) =>
  Number((quantiteMilliemes * BigInt(prixUnitaire) + 500n) / 1000n);

export const montantTva = (totalHt: number, tauxPdm: number) =>
  Number((BigInt(totalHt) * BigInt(tauxPdm) + 5000n) / 10000n);
