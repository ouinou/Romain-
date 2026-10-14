import { createHash, randomBytes } from "node:crypto";

/** Jeton aléatoire de 256 bits, transmis à l'utilisateur ; seule son empreinte est stockée. */
export const genererJeton = () => randomBytes(32).toString("base64url");
export const empreinteJeton = (jeton: string) => createHash("sha256").update(jeton).digest();
