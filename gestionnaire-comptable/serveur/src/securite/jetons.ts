import { createHash, randomBytes } from "node:crypto";

/** Jeton aléatoire de 256 bits (sessions), transmis à l'utilisateur ; seule son empreinte est stockée. */
export const genererJeton = () => randomBytes(32).toString("base64url");
export const empreinteJeton = (jeton: string) => createHash("sha256").update(jeton).digest();

/**
 * Code d'invitation ou de réinitialisation, remis de la main à la main et souvent recopié d'un écran à l'autre :
 * 20 caractères parmi 31 (environ 99 bits), en 5 groupes de 4, sans 0/O ni 1/I/L. Exemple : K7M2-XR9D-…
 * À usage unique, limité dans le temps et soumis à la limitation des tentatives : 99 bits suffisent largement.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const FORME_CODE = /^[2-9A-HJ-NP-Z]{20}$/;
function caractere(): string {
  for (;;) { const o = randomBytes(1)[0]; if (o < 248) return ALPHABET[o % 31]; }   // 248 = 31 × 8 : pas de biais
}
export const genererCodeAcces = () => Array.from({ length: 5 }, () => Array.from({ length: 4 }, caractere).join("")).join("-");

/** Forme canonique d'un code saisi : majuscules, sans espaces ni tirets (ce qui est haché). */
export const normaliserCodeAcces = (saisie: string) => saisie.toUpperCase().replace(/[\s-]/g, "");
export const empreinteCodeAcces = (code: string) => empreinteJeton(normaliserCodeAcces(code));

/**
 * Empreintes à rechercher pour une saisie : la forme canonique si elle a la forme d'un code lisible, et la saisie
 * brute (codes émis avant la version 0.3, sensibles à la casse).
 */
export function empreintesCandidates(saisie: string): Buffer[] {
  const brut = saisie.trim().replace(/\s/g, "");
  const canon = normaliserCodeAcces(saisie);
  return FORME_CODE.test(canon) && canon !== brut ? [empreinteJeton(canon), empreinteJeton(brut)] : [empreinteJeton(brut)];
}
