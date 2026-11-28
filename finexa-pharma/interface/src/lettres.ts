// Copie de serveur/src/domaine/ventes/lettres.ts (aperçu des factures) : garder les deux fichiers identiques.
/**
 * Montant en toutes lettres (orthographe traditionnelle), pour la mention
 * « Arrêtée la présente facture à la somme de … francs CFA », d'usage courant dans l'espace OHADA.
 * Règles : vingt et un, soixante et onze, quatre-vingts / quatre-vingt-un, deux cents / deux cent un,
 * mille invariable, million et milliard variables.
 */
const UNITES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const DIZAINES = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];

function moinsDeCent(n: number): string {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7 || d === 9) {                          // soixante-dix…, quatre-vingt-dix…
    const reste = 10 + u;
    return DIZAINES[d] + (d === 7 && u === 1 ? " et " : "-") + UNITES[reste];
  }
  if (u === 0) return d === 8 ? "quatre-vingts" : DIZAINES[d];
  if (u === 1 && d !== 8) return DIZAINES[d] + " et un";
  return DIZAINES[d] + "-" + UNITES[u];
}

function moinsDeMille(n: number, finale: boolean): string {
  const c = Math.floor(n / 100), r = n % 100;
  let s = "";
  if (c > 0) s = c === 1 ? "cent" : UNITES[c] + " cent" + (r === 0 && finale ? "s" : "");
  if (r > 0) s += (s ? " " : "") + moinsDeCent(r);
  // « quatre-vingts » et « cents » ne prennent le s qu'en fin de nombre (pas devant « mille »).
  if (!finale) s = s.replace(/quatre-vingts$/, "quatre-vingt");
  return s;
}

export function nombreEnLettres(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Entier positif attendu.");
  if (n === 0) return "zéro";
  const parties: string[] = [];
  const echelles: [number, string, string][] = [[1e12, "billion", "billions"], [1e9, "milliard", "milliards"], [1e6, "million", "millions"]];
  let reste = n;
  for (const [valeur, sing, plur] of echelles) {
    const q = Math.floor(reste / valeur);
    if (q > 0) { parties.push(`${moinsDeMille(q, true)} ${q > 1 ? plur : sing}`); reste %= valeur; }
  }
  const milliers = Math.floor(reste / 1000);
  if (milliers > 0) { parties.push(milliers === 1 ? "mille" : `${moinsDeMille(milliers, false)} mille`); reste %= 1000; }
  if (reste > 0) parties.push(moinsDeMille(reste, true));
  return parties.join(" ");
}

export const montantEnLettres = (n: number, devise = "francs CFA") => {
  const t = nombreEnLettres(n);
  return t.charAt(0).toUpperCase() + t.slice(1) + " " + devise;
};
