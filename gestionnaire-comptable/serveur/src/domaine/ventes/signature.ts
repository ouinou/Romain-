import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type { Client } from "../../db.js";
import { chiffrer, dechiffrer } from "../../securite/chiffrement.js";

/**
 * Code de vérification imprimé (en QR) sur chaque facture :
 *   GC1;<code entreprise>;<numéro>;<date>;<TTC>;<devise>;<signature Ed25519 en base64url>
 * La signature porte sur tout ce qui la précède. Ed25519 est déterministe : la même facture donne
 * toujours le même code, sans rien stocker de plus. Vérifier demande la clé publique de l'entreprise
 * ET la présence de la facture, identique, dans la base (voir verifierCode).
 */
export interface DonneesCode { codeEntreprise: string; numero: string; date: string; totalTtc: number; devise: string }

const message = (d: DonneesCode) => ["GC1", d.codeEntreprise, d.numero, d.date, String(d.totalTtc), d.devise].join(";");

async function cles(c: Client, cleChiffrement: Buffer) {
  let { rows: [k] } = await c.query("SELECT public_key, private_key_enc FROM company_signing_keys");
  if (!k) {
    // Création au premier besoin. Verrou pour éviter deux créations simultanées dans la même entreprise.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('cle-signature:' || current_company_id()::text, 0))");
    ({ rows: [k] } = await c.query("SELECT public_key, private_key_enc FROM company_signing_keys"));
    if (!k) {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const pub = publicKey.export({ type: "spki", format: "der" });
      const priv = chiffrer(cleChiffrement, privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"));
      await c.query("INSERT INTO company_signing_keys (public_key, private_key_enc) VALUES ($1, $2)", [pub, priv]);
      k = { public_key: pub, private_key_enc: priv };
    }
  }
  return k as { public_key: Buffer; private_key_enc: string };
}

export async function codeVerification(c: Client, cleChiffrement: Buffer, d: DonneesCode): Promise<string> {
  const k = await cles(c, cleChiffrement);
  const prive = createPrivateKey({ key: Buffer.from(dechiffrer(cleChiffrement, k.private_key_enc), "base64"), format: "der", type: "pkcs8" });
  const m = message(d);
  return `${m};${sign(null, Buffer.from(m), prive).toString("base64url")}`;
}

export type ResultatVerification =
  | { authentique: true; numero: string }
  | { authentique: false; raison: string };

/** Contrôle de forme et de signature ; la présence en base est vérifiée par l'appelant. */
export async function verifierSignature(c: Client, cleChiffrement: Buffer, codeEntreprise: string, contenu: string): Promise<ResultatVerification & { donnees?: DonneesCode }> {
  const p = contenu.trim().split(";");
  if (p.length !== 7 || p[0] !== "GC1") return { authentique: false, raison: "Ce code n'est pas un code de facture FINEXA ERP." };
  const [, ent, numero, date, ttc, devise, sig] = p;
  if (ent.toUpperCase() !== codeEntreprise.toUpperCase()) return { authentique: false, raison: `Cette facture a été émise par une autre entreprise (code ${ent}). Elle ne peut être vérifiée que par celle-ci.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,15}$/.test(ttc) || !/^[A-Za-z0-9_-]{80,90}$/.test(sig)) return { authentique: false, raison: "Code incomplet ou altéré." };
  const k = await cles(c, cleChiffrement);
  const d: DonneesCode = { codeEntreprise: ent, numero, date, totalTtc: Number(ttc), devise };
  const ok = verify(null, Buffer.from(message(d)), createPublicKey({ key: k.public_key, format: "der", type: "spki" }), Buffer.from(sig, "base64url"));
  return ok ? { authentique: true, numero, donnees: d } : { authentique: false, raison: "Signature invalide : le numéro, la date ou le montant ont été modifiés, ou le code est un faux." };
}
