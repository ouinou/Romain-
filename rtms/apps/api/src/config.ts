import { z } from 'zod';
import { loadVaultSecrets, resolveFileSecrets } from './vault.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: z.string().default('loopback'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Clés de chiffrement des données sensibles au repos : "v1:<base64 32 octets>,v2:..."
  DATA_ENCRYPTION_KEYS: z.string().min(1),
  DATA_ENCRYPTION_ACTIVE_KEY: z.string().default('v1'),
  COOKIE_SECURE: bool.default(true),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  MFA_REQUIRED_ROLES: z.string().default('admin,direction,finance'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  METRICS_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  // Licences : seule la clé PUBLIQUE est présente côté installation
  LICENSE_PUBLIC_KEY_PEM: z.string().optional(),
  LICENSE_ISSUER_URL: z.string().url().optional(),
  LICENSE_ENFORCEMENT: z.enum(['enforce', 'warn', 'off']).default('warn'),
  LICENSE_OFFLINE_GRACE_DAYS: z.coerce.number().int().nonnegative().default(7),
  WEB_ROOT: z.string().optional(),
  /** Nom de l'instance affiché dans la barre d'état (ex. RAHA_PROD, RAHA_TEST). */
  INSTANCE_NAME: z.string().max(40).default('RAHA_PROD'),
  RTMS_DEVICE_ID: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  let merged: Record<string, string | undefined> = { ...env, ...resolveFileSecrets(env) };
  if (merged.VAULT_ADDR) {
    const secrets = await loadVaultSecrets({
      addr: merged.VAULT_ADDR,
      roleId: required(merged, 'VAULT_ROLE_ID'),
      secretId: required(merged, 'VAULT_SECRET_ID'),
      secretPath: merged.VAULT_SECRET_PATH ?? 'secret/data/rtms',
      namespace: merged.VAULT_NAMESPACE,
    });
    merged = { ...merged, ...secrets };
  }
  const cfg = schema.parse(merged);
  if (cfg.NODE_ENV === 'production') {
    if (!cfg.COOKIE_SECURE) throw new Error('COOKIE_SECURE=false interdit en production');
    if (!cfg.PUBLIC_ORIGIN.startsWith('https://')) throw new Error('PUBLIC_ORIGIN doit être en HTTPS en production');
    if (cfg.LICENSE_ENFORCEMENT === 'off') throw new Error('LICENSE_ENFORCEMENT=off interdit en production');
  }
  return cfg;
}

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} manquant`);
  return v;
}
