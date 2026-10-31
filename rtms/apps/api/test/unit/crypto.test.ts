import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { FieldCipher } from '../../src/crypto.js';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');

describe('FieldCipher (AES-256-GCM)', () => {
  it('chiffre et déchiffre', () => {
    const c = new FieldCipher(`v1:${k1}`, 'v1');
    const enc = c.encrypt('NIF-123456', 'clients:nif');
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(enc).not.toContain('NIF-123456');
    expect(c.decrypt(enc, 'clients:nif')).toBe('NIF-123456');
  });
  it('deux chiffrements du même texte diffèrent (IV aléatoire)', () => {
    const c = new FieldCipher(`v1:${k1}`, 'v1');
    expect(c.encrypt('x')).not.toBe(c.encrypt('x'));
  });
  it('détecte une altération du chiffré', () => {
    const c = new FieldCipher(`v1:${k1}`, 'v1');
    const parts = c.encrypt('secret').split(':');
    parts[4] = Buffer.from('autre-chose').toString('base64url');
    expect(() => c.decrypt(parts.join(':'))).toThrow();
  });
  it('refuse un déchiffrement hors contexte (AAD)', () => {
    const c = new FieldCipher(`v1:${k1}`, 'v1');
    expect(() => c.decrypt(c.encrypt('secret', 'mfa:user-a'), 'mfa:user-b')).toThrow();
  });
  it('rotation : lit les anciennes clés, chiffre avec la nouvelle', () => {
    const old = new FieldCipher(`v1:${k1}`, 'v1').encrypt('ancien');
    const c = new FieldCipher(`v1:${k1},v2:${k2}`, 'v2');
    expect(c.decrypt(old)).toBe('ancien');
    expect(c.encrypt('nouveau').startsWith('enc:v2:')).toBe(true);
  });
  it('refuse une clé de mauvaise taille', () => {
    expect(() => new FieldCipher(`v1:${randomBytes(16).toString('base64')}`, 'v1')).toThrow(/32 octets/);
  });
});
