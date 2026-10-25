import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM. Format : base64(iv[12] | tag[16] | texte chiffré). */
export function chiffrer(cle: Buffer, clair: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cle, iv);
  const ct = Buffer.concat([c.update(clair, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function dechiffrer(cle: Buffer, chiffre: string): string {
  const b = Buffer.from(chiffre, "base64");
  const d = createDecipheriv("aes-256-gcm", cle, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
