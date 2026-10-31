import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Config } from './config.js';
import type { FieldCipher } from './crypto.js';
import type { SessionStore } from './security/session.js';
import type { LicenseGuard } from './licensing/guard.js';

export interface AppContext {
  config: Config;
  prisma: PrismaClient;
  redis: Redis;
  sessions: SessionStore;
  cipher: FieldCipher;
  license: LicenseGuard;
}
