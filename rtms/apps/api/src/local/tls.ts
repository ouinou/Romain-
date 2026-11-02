/**
 * Certificat TLS du poste principal (auto-signé, 10 ans), généré au premier démarrage.
 * Les autres postes l'acceptent en comparant son empreinte (comme une clé SSH) :
 * la connexion reste chiffrée sur le wifi de la box, sans Internet ni autorité extérieure.
 */
import { X509Certificate, createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import selfsigned from 'selfsigned';

export interface LocalTls { key: string; cert: string; fingerprint: string }

export function fingerprintOf(certPem: string): string {
  const der = new X509Certificate(certPem).raw;
  return createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g)!.join(':');
}

export async function loadOrCreateTls(dataDir: string): Promise<LocalTls> {
  const keyFile = path.join(dataDir, 'tls-key.pem');
  const certFile = path.join(dataDir, 'tls-cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    const host = os.hostname();
    const pems = await selfsigned.generate([{ name: 'commonName', value: `RTMS ${host}` }, { name: 'organizationName', value: 'RAHA TRANSPORT' }], {
      keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notAfterDate: new Date(Date.now() + 3650 * 86400_000),
      extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: host }, { type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }],
    });
    fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
    fs.writeFileSync(certFile, pems.cert, { mode: 0o644 });
  }
  const cert = fs.readFileSync(certFile, 'utf8');
  return { key: fs.readFileSync(keyFile, 'utf8'), cert, fingerprint: fingerprintOf(cert) };
}
