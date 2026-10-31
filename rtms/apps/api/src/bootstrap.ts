import { Redis } from 'ioredis';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { FieldCipher } from './crypto.js';
import { createPrisma } from './db.js';
import { LicenseGuard } from './licensing/guard.js';
import { SessionStore } from './security/session.js';

export async function createContext(config: Config, overrides: Partial<{ fetchImpl: typeof fetch; deviceId: string }> = {}): Promise<AppContext> {
  const prisma = createPrisma(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, enableAutoPipelining: true, lazyConnect: false });
  const license = await new LicenseGuard(prisma, {
    publicKeyPem: config.LICENSE_PUBLIC_KEY_PEM?.replace(/\\n/g, '\n'),
    issuerUrl: config.LICENSE_ISSUER_URL,
    enforcement: config.LICENSE_ENFORCEMENT,
    graceDays: config.LICENSE_OFFLINE_GRACE_DAYS,
    deviceId: overrides.deviceId ?? config.RTMS_DEVICE_ID,
    fetchImpl: overrides.fetchImpl,
  }).init();
  return {
    config, prisma, redis, license,
    sessions: new SessionStore(redis, config.SESSION_IDLE_MINUTES * 60, config.SESSION_ABSOLUTE_HOURS * 3600),
    cipher: new FieldCipher(config.DATA_ENCRYPTION_KEYS, config.DATA_ENCRYPTION_ACTIVE_KEY),
  };
}

export async function closeContext(ctx: AppContext) {
  ctx.license.stop();
  await ctx.prisma.$disconnect();
  ctx.redis.disconnect();
}
