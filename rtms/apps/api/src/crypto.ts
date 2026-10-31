/**
 * Chiffrement applicatif des données sensibles au repos (AES-256-GCM, clés versionnées).
 * Format : enc:<keyId>:<iv>:<tag>:<ciphertext> (base64url). La rotation consiste à ajouter
 * une clé, la déclarer active, puis ré-chiffrer progressivement (voir docs/SECURITE.md).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export class FieldCipher {
  private keys = new Map<string, Buffer>();

  constructor(spec: string, private activeKey: string) {
    for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [id, b64] = part.split(':');
      if (!id || !b64) throw new Error('DATA_ENCRYPTION_KEYS mal formé');
      const key = Buffer.from(b64, 'base64');
      if (key.length !== 32) throw new Error(`Clé ${id} : 32 octets attendus`);
      this.keys.set(id, key);
    }
    if (!this.keys.has(activeKey)) throw new Error(`Clé active ${activeKey} absente`);
  }

  encrypt(plain: string, aad = ''): string {
    const key = this.keys.get(this.activeKey)!;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['enc', this.activeKey, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }

  decrypt(value: string, aad = ''): string {
    const [p, id, iv, tag, ct] = value.split(':');
    if (p !== 'enc' || !id || !iv || !tag || ct === undefined) throw new Error('Valeur chiffrée invalide');
    const key = this.keys.get(id);
    if (!key) throw new Error(`Clé ${id} inconnue`);
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }

  static isEncrypted(v: unknown): v is string {
    return typeof v === 'string' && v.startsWith('enc:');
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
