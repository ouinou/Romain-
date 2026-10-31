/** Crée une société et un administrateur dédiés au test (aucun compte permanent codé en dur). */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function globalSetup() {
  const email = `e2e-${randomUUID().slice(0, 8)}@raha.test`;
  const password = `E2E ${randomUUID()} camion`;
  execFileSync('npx', ['tsx', 'src/scripts/seed.ts'], {
    cwd: join(__dirname, '../../api'),
    env: { ...process.env, RTMS_ADMIN_EMAIL: email, RTMS_ADMIN_PASSWORD: password, RTMS_COMPANY_NAME: 'RAHA TRANSPORT (E2E)' },
    stdio: 'inherit',
  });
  writeFileSync(join(__dirname, '.e2e-account.json'), JSON.stringify({ email, password }));
}
