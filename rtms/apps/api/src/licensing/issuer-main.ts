import { createPrisma } from '../db.js';
import { loadPrivateKey } from './token.js';
import { buildIssuerApp } from './issuer.js';
import { resolveFileSecrets } from '../vault.js';
import { loadVaultSecrets } from '../vault.js';

async function main() {
  let env: Record<string, string | undefined> = { ...process.env, ...resolveFileSecrets(process.env) };
  if (env.VAULT_ADDR) {
    env = { ...env, ...(await loadVaultSecrets({
      addr: env.VAULT_ADDR, roleId: env.VAULT_ROLE_ID ?? '', secretId: env.VAULT_SECRET_ID ?? '',
      secretPath: env.VAULT_SECRET_PATH ?? 'secret/data/rtms-license',
    })) };
  }
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`${k} manquant`); return v; };
  const app = await buildIssuerApp({
    prisma: createPrisma(need('ISSUER_DATABASE_URL')),
    privateKey: loadPrivateKey(need('LICENSE_SIGNING_KEY_PEM')),
    adminTokenSha256: need('ISSUER_ADMIN_TOKEN_SHA256'),
    logger: true,
  });
  await app.listen({ host: env.HOST ?? '0.0.0.0', port: Number(env.PORT ?? 4000) });
}

main().catch((e) => { console.error(e); process.exit(1); });
