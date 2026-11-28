import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, openSync, readSync, closeSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

/** Format des sauvegardes chiffrées : "GCSV1\n" | iv (12 o) | données AES-256-GCM | tag (16 o). */
const MAGIE = Buffer.from("GCSV1\n");

export async function chiffrerFichier(cle: Buffer, source: string, cible: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cle, iv);
  const sortie = createWriteStream(cible);
  sortie.write(Buffer.concat([MAGIE, iv]));
  await pipeline(createReadStream(source), c, sortie, { end: false });
  await new Promise<void>((ok, ko) => sortie.end(c.getAuthTag(), () => ok()).on("error", ko));
}

export async function dechiffrerFichier(cle: Buffer, source: string, cible: string) {
  const taille = statSync(source).size;
  const fd = openSync(source, "r");
  const entete = Buffer.alloc(MAGIE.length + 12), tag = Buffer.alloc(16);
  readSync(fd, entete, 0, entete.length, 0);
  readSync(fd, tag, 0, 16, taille - 16);
  closeSync(fd);
  if (!entete.subarray(0, MAGIE.length).equals(MAGIE)) throw new Error("Ce fichier n'est pas une sauvegarde FINEXA ERP.");
  const d = createDecipheriv("aes-256-gcm", cle, entete.subarray(MAGIE.length));
  d.setAuthTag(tag);
  // final() échoue si le fichier a été altéré ou si la clé est fausse : la restauration s'arrête.
  try {
    await pipeline(createReadStream(source, { start: entete.length, end: taille - 17 }), d, createWriteStream(cible));
  } catch {
    throw new Error("Déchiffrement impossible : la clé GC_CLE_SAUVEGARDE ne correspond pas, ou le fichier a été altéré.");
  }
}

export async function sha256Fichier(chemin: string) {
  const h = createHash("sha256");
  await pipeline(createReadStream(chemin), new Transform({ transform(b, _e, cb) { h.update(b); cb(); } }));
  return h.digest("hex");
}
