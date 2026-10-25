import { randomBytes } from "node:crypto";

/**
 * Code maître : environ 119 bits aléatoires (24 caractères parmi 31), présentés en 6 groupes de 4 caractères faciles à recopier
 * (alphabet sans 0/O ni 1/I/L). Exemple : GCM-7KQ2-XR9D-…
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";   // 31 caractères non ambigus

/** Un caractère uniforme : les octets ≥ 248 (= 31 × 8) sont rejetés pour éviter un biais. */
function caractere(): string {
  for (;;) { const o = randomBytes(1)[0]; if (o < 248) return ALPHABET[o % 31]; }
}

export function genererCodeMaitre(): string {
  const groupes = Array.from({ length: 6 }, () => Array.from({ length: 4 }, caractere).join(""));
  return "GCM-" + groupes.join("-");
}

/** Forme canonique pour le hachage : majuscules, sans espaces ni tirets, sans le préfixe. */
export const normaliserCodeMaitre = (code: string) => code.toUpperCase().replace(/[\s-]/g, "").replace(/^GCM/, "");
