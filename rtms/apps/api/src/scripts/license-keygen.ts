/**
 * Génère la paire de clés Ed25519 du serveur de licences.
 * La clé PRIVÉE est écrite avec les droits 0600 dans le dossier indiqué (à importer
 * ensuite dans Vault puis à effacer du disque). Elle ne doit jamais entrer dans le dépôt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateLicenseKeyPair } from '../licensing/token.js';

const dir = process.argv[2];
if (!dir) { console.error('Usage : npm run license:keygen -- <dossier hors dépôt>'); process.exit(1); }
mkdirSync(dir, { recursive: true, mode: 0o700 });
const { publicKeyPem, privateKeyPem } = generateLicenseKeyPair();
writeFileSync(join(dir, 'license-signing.key'), privateKeyPem, { mode: 0o600, flag: 'wx' });
writeFileSync(join(dir, 'license-public.pem'), publicKeyPem, { mode: 0o644, flag: 'wx' });
console.log(`Clés écrites dans ${dir}. Importez la clé privée dans Vault :\n  vault kv put secret/rtms-license LICENSE_SIGNING_KEY_PEM=@${join(dir, 'license-signing.key')}\npuis supprimez le fichier (shred -u).`);
