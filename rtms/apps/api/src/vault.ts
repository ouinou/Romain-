/**
 * Lecture des secrets depuis HashiCorp Vault (KV v2, authentification AppRole).
 * Les secrets ne transitent que par la mémoire du processus : rien n'est écrit sur disque.
 */
import { readFileSync } from 'node:fs';

export interface VaultOptions {
  addr: string;
  roleId: string;
  secretId: string;
  secretPath: string; // ex. "secret/data/rtms/prod"
  namespace?: string;
  fetchImpl?: typeof fetch;
}

export async function loadVaultSecrets(opts: VaultOptions): Promise<Record<string, string>> {
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.namespace) headers['x-vault-namespace'] = opts.namespace;

  const login = await f(`${opts.addr}/v1/auth/approle/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role_id: opts.roleId, secret_id: opts.secretId }),
  });
  if (!login.ok) throw new Error(`Vault: échec AppRole (${login.status})`);
  const token = ((await login.json()) as { auth?: { client_token?: string } }).auth?.client_token;
  if (!token) throw new Error('Vault: jeton absent');

  const res = await f(`${opts.addr}/v1/${opts.secretPath}`, { headers: { ...headers, 'x-vault-token': token } });
  if (!res.ok) throw new Error(`Vault: lecture ${opts.secretPath} refusée (${res.status})`);
  const body = (await res.json()) as { data?: { data?: Record<string, unknown> } };
  const data = body.data?.data ?? {};
  // Révocation immédiate du jeton de courte durée
  await f(`${opts.addr}/v1/auth/token/revoke-self`, { method: 'POST', headers: { ...headers, 'x-vault-token': token } }).catch(() => undefined);
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
}

/** Secrets pouvant être fournis par fichier : `FOO_FILE=/run/secrets/foo` → `FOO`. */
export const FILE_SECRET_KEYS = [
  'DATABASE_URL', 'REDIS_URL', 'DATA_ENCRYPTION_KEYS', 'METRICS_TOKEN', 'SENTRY_DSN', 'LICENSE_PUBLIC_KEY_PEM',
  'VAULT_ROLE_ID', 'VAULT_SECRET_ID', 'RTMS_DEVICE_ID', 'ISSUER_DATABASE_URL', 'LICENSE_SIGNING_KEY_PEM', 'ISSUER_ADMIN_TOKEN_SHA256',
] as const;

/** Secrets Docker / Kubernetes montés en fichiers (liste fermée : pas de lecture arbitraire). */
export function resolveFileSecrets(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FILE_SECRET_KEYS) {
    const path = env[`${k}_FILE`];
    if (path) out[k] = readFileSync(path, 'utf8').trim();
  }
  return out;
}
