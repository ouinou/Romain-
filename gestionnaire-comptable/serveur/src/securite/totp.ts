import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** TOTP (RFC 6238) : codes à 6 chiffres, pas de 30 s. Fonctionne sans Internet. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(b: Buffer): string {
  let bits = 0, val = 0, out = "";
  for (const o of b) { val = (val << 8) | o; bits += 8; while (bits >= 5) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(val << (5 - bits)) & 31];
  return out;
}

export function base32Decoder(s: string): Buffer {
  let bits = 0, val = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHABET.indexOf(ch); if (i < 0) throw new Error("Secret base32 invalide.");
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const genererSecretTotp = () => base32(randomBytes(20));

export function codeHotp(secret: Buffer, pas: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(pas));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[19] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

export const pasCourant = (t = Date.now()) => Math.floor(t / 30_000);

/**
 * Vérifie un code en tolérant un pas de décalage d'horloge.
 * Renvoie le pas accepté, ou null. Un pas déjà utilisé (≤ dernierPas) est refusé : pas de rejeu.
 */
export function verifierTotp(secretB32: string, code: string, dernierPas: number, t = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decoder(secretB32), p = pasCourant(t);
  for (const pas of [p - 1, p, p + 1]) {
    if (pas <= dernierPas) continue;
    if (timingSafeEqual(Buffer.from(codeHotp(secret, pas)), Buffer.from(code))) return pas;
  }
  return null;
}

export const uriOtpauth = (secret: string, compte: string, emetteur = "Gestionnaire Comptable") =>
  `otpauth://totp/${encodeURIComponent(emetteur)}:${encodeURIComponent(compte)}?secret=${secret}&issuer=${encodeURIComponent(emetteur)}&digits=6&period=30`;
