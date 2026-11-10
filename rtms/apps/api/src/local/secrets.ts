/**
 * Secrets du poste principal, générés au premier démarrage et conservés dans le dossier
 * de données (droits restreints). Aucun secret n'est livré avec le logiciel.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface LocalSecrets {
  pgSuperPassword: string;
  ownerPassword: string;
  appPassword: string;
  licensePassword: string;
  dataKeys: string;
  installId: string;
  /** Jeton qui permet à un nouveau démarrage d'arrêter proprement un ancien serveur resté ouvert. */
  shutdownToken?: string;
}

const pw = () => randomBytes(24).toString('base64url');

export function loadOrCreateSecrets(dataDir: string): LocalSecrets {
  const file = path.join(dataDir, 'secrets.json');
  if (fs.existsSync(file)) {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as LocalSecrets;
    if (!s.shutdownToken) { s.shutdownToken = pw(); fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 }); }
    return s;
  }
  const s: LocalSecrets = {
    pgSuperPassword: pw(), ownerPassword: pw(), appPassword: pw(), licensePassword: pw(),
    dataKeys: `v1:${randomBytes(32).toString('base64')}`,
    installId: randomBytes(8).toString('hex'),
    shutdownToken: pw(),
  };
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600, flag: 'wx' });
  return s;
}
