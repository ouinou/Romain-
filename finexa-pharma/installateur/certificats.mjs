/**
 * Certificats HTTPS pour le réseau local : une autorité locale propre à CE serveur (clé privée détruite après usage :
 * elle ne peut plus rien signer d'autre) et un certificat serveur valable pour ses noms et adresses IP.
 * node-forge sert uniquement à fabriquer les certificats, une fois, pendant l'installation.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const forge = require("node-forge");

const numeroSerie = () => "01" + forge.util.bytesToHex(forge.random.getBytesSync(15));

export function creerCertificats({ noms, ips, nomAutorite }) {
  const pki = forge.pki;
  const maintenant = new Date();
  const dans = (jours) => new Date(maintenant.getTime() + jours * 86_400_000);

  const cleAc = pki.rsa.generateKeyPair(3072);
  const ac = pki.createCertificate();
  ac.publicKey = cleAc.publicKey;
  ac.serialNumber = numeroSerie();
  ac.validity.notBefore = dans(-1); ac.validity.notAfter = dans(3650);
  const sujetAc = [{ name: "commonName", value: nomAutorite }, { name: "organizationName", value: "FINEXA PHARMA" }];
  ac.setSubject(sujetAc); ac.setIssuer(sujetAc);
  ac.setExtensions([
    { name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  ac.sign(cleAc.privateKey, forge.md.sha256.create());

  const cle = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = cle.publicKey;
  cert.serialNumber = numeroSerie();
  cert.validity.notBefore = dans(-1); cert.validity.notAfter = dans(825);
  cert.setSubject([{ name: "commonName", value: noms[1] ?? noms[0] }, { name: "organizationName", value: "FINEXA PHARMA" }]);
  cert.setIssuer(sujetAc);
  cert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [...new Set(noms)].map((value) => ({ type: 2, value })).concat([...new Set(ips)].map((ip) => ({ type: 7, ip }))) },
    { name: "subjectKeyIdentifier" },
    { name: "authorityKeyIdentifier", keyIdentifier: ac.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(cleAc.privateKey, forge.md.sha256.create());

  return { autorite: pki.certificateToPem(ac), certificat: pki.certificateToPem(cert), cle: pki.privateKeyToPem(cle.privateKey) };
}
