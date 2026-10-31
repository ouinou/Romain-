/**
 * Jetons de licence signés Ed25519.
 * Format : RTMS1.<payload base64url>.<signature base64url>
 * La signature couvre "RTMS-LICENSE-v1." + payload encodé : modifier un seul octet
 * (date, plan, appareil...) invalide le jeton. Seul le serveur de l'éditeur détient
 * la clé privée ; l'installation ne possède que la clé publique.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

const PREFIX = 'RTMS1';
const DOMAIN = Buffer.from('RTMS-LICENSE-v1.');

export interface LicensePayload {
  v: 1;
  lid: string;          // identifiant de licence
  iid: string;          // identifiant unique d'installation
  dev: string;          // empreinte de l'appareil autorisé
  customer: string;
  plan: string;
  features: string[];
  maxUsers: number;
  iat: number;          // émis le (s)
  exp: number;          // fin d'abonnement (s)
  refreshBy: number;    // date limite de renouvellement en ligne (s)
}

export function generateLicenseKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export const loadPrivateKey = (pem: string) => {
  const k = createPrivateKey(pem);
  if (k.asymmetricKeyType !== 'ed25519') throw new Error('Clé privée Ed25519 attendue');
  return k;
};
export const loadPublicKey = (pem: string) => {
  const k = createPublicKey(pem);
  if (k.asymmetricKeyType !== 'ed25519') throw new Error('Clé publique Ed25519 attendue');
  return k;
};

export function signLicense(payload: LicensePayload, privateKey: KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(null, Buffer.concat([DOMAIN, Buffer.from(body)]), privateKey).toString('base64url');
  return `${PREFIX}.${body}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: 'format' | 'signature' | 'installation' | 'device' | 'expired' | 'refresh_overdue' | 'not_yet_valid'; payload?: LicensePayload };

export function verifyLicense(
  token: string,
  publicKey: KeyObject,
  expect: { installationId: string; deviceHash: string; now?: number; graceSeconds?: number },
): VerifyResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'format' };
  const [, body, sig] = parts as [string, string, string];
  let valid = false;
  try {
    valid = verify(null, Buffer.concat([DOMAIN, Buffer.from(body)]), publicKey, Buffer.from(sig, 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'signature' };
  let payload: LicensePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (payload.v !== 1) return { ok: false, reason: 'format' };
  const now = expect.now ?? Math.floor(Date.now() / 1000);
  if (payload.iid !== expect.installationId) return { ok: false, reason: 'installation', payload };
  if (payload.dev !== expect.deviceHash) return { ok: false, reason: 'device', payload };
  if (payload.iat > now + 300) return { ok: false, reason: 'not_yet_valid', payload };
  if (now >= payload.exp) return { ok: false, reason: 'expired', payload };
  if (now >= payload.refreshBy + (expect.graceSeconds ?? 0)) return { ok: false, reason: 'refresh_overdue', payload };
  return { ok: true, payload };
}

/** Liste de révocation signée, publiée par le serveur de licences. */
export function signRevocationList(revoked: string[], privateKey: KeyObject, iat = Math.floor(Date.now() / 1000)) {
  return signLicense({ v: 1, lid: 'CRL', iid: '*', dev: '*', customer: '', plan: 'crl', features: revoked, maxUsers: 0, iat, exp: iat + 7 * 86400, refreshBy: iat + 7 * 86400 }, privateKey);
}
