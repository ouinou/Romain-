import { describe, expect, it } from 'vitest';
import { createPublicKey } from 'node:crypto';
import { generateLicenseKeyPair, loadPrivateKey, loadPublicKey, signLicense, verifyLicense, type LicensePayload } from '../../src/licensing/token.js';

const { privateKeyPem, publicKeyPem } = generateLicenseKeyPair();
const priv = loadPrivateKey(privateKeyPem);
const pub = loadPublicKey(publicKeyPem);
const now = 1_800_000_000;
const base: LicensePayload = { v: 1, lid: 'L1', iid: 'I1', dev: 'D1', customer: 'RAHA', plan: 'pro', features: [], maxUsers: 10, iat: now, exp: now + 365 * 86400, refreshBy: now + 30 * 86400 };
const expect_ = { installationId: 'I1', deviceHash: 'D1', now: now + 10 };

describe('Jetons de licence Ed25519', () => {
  it('accepte un jeton authentique', () => {
    const r = verifyLicense(signLicense(base, priv), pub, expect_);
    expect(r.ok).toBe(true);
  });
  it('rejette un jeton dont la charge utile a été modifiée', () => {
    const [p, body, sig] = signLicense(base, priv).split('.');
    const forged = Buffer.from(JSON.stringify({ ...base, exp: base.exp + 10 * 365 * 86400, maxUsers: 9999 })).toString('base64url');
    expect(body).not.toBe(forged);
    const r = verifyLicense(`${p}.${forged}.${sig}`, pub, expect_);
    expect(r).toEqual({ ok: false, reason: 'signature' });
  });
  it('rejette une signature produite par une autre clé', () => {
    const other = loadPrivateKey(generateLicenseKeyPair().privateKeyPem);
    expect(verifyLicense(signLicense(base, other), pub, expect_)).toMatchObject({ ok: false, reason: 'signature' });
  });
  it('lie le jeton à l’installation et à l’appareil', () => {
    const t = signLicense(base, priv);
    expect(verifyLicense(t, pub, { ...expect_, installationId: 'I2' })).toMatchObject({ ok: false, reason: 'installation' });
    expect(verifyLicense(t, pub, { ...expect_, deviceHash: 'D2' })).toMatchObject({ ok: false, reason: 'device' });
  });
  it('gère l’expiration et la tolérance hors ligne', () => {
    const t = signLicense(base, priv);
    expect(verifyLicense(t, pub, { ...expect_, now: base.exp + 1 })).toMatchObject({ ok: false, reason: 'expired' });
    const afterRefresh = base.refreshBy + 86400;
    expect(verifyLicense(t, pub, { ...expect_, now: afterRefresh })).toMatchObject({ ok: false, reason: 'refresh_overdue' });
    expect(verifyLicense(t, pub, { ...expect_, now: afterRefresh, graceSeconds: 7 * 86400 }).ok).toBe(true);
  });
  it('rejette les formats invalides sans lever d’exception', () => {
    for (const bad of ['', 'abc', 'RTMS1..', 'RTMS1.x.y', 'RTMS2.a.b']) {
      expect(verifyLicense(bad, pub, expect_).ok).toBe(false);
    }
  });
  it('la clé publique dérivée ne permet pas de signer', () => {
    expect(() => signLicense(base, createPublicKey(priv) as never)).toThrow();
  });
});
