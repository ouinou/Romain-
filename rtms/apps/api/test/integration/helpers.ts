import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import { buildApp } from '../../src/app.js';
import { createContext } from '../../src/bootstrap.js';
import type { Config } from '../../src/config.js';
import type { AppContext } from '../../src/context.js';
import { seedCompany } from '../../src/scripts/seed.js';
import { hashPassword } from '../../src/security/password.js';

const PG = process.env.TEST_PG_HOST ?? 'localhost:5432';
export const APP_DB = process.env.TEST_DATABASE_URL ?? `postgresql://rtms_app:devapp@${PG}/rtms_test`;
export const OWNER_DB = process.env.TEST_OWNER_DATABASE_URL ?? `postgresql://rtms_owner:devowner@${PG}/rtms_test`;
export const LICENSE_DB = process.env.TEST_LICENSE_DATABASE_URL ?? `postgresql://rtms_license:devlic@${PG}/rtms_test`;
export const ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'Camion vert sur la route de Moundou 7!';

export const owner = new PrismaClient({ datasources: { db: { url: OWNER_DB } } });

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 0, PUBLIC_ORIGIN: ORIGIN, TRUST_PROXY: 'loopback',
    DATABASE_URL: APP_DB, REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    DATA_ENCRYPTION_KEYS: `v1:${randomBytes(32).toString('base64')}`, DATA_ENCRYPTION_ACTIVE_KEY: 'v1',
    COOKIE_SECURE: false, SESSION_IDLE_MINUTES: 30, SESSION_ABSOLUTE_HOURS: 12,
    MFA_REQUIRED_ROLES: 'admin,direction,finance', RATE_LIMIT_PER_MINUTE: 10_000, LOGIN_RATE_LIMIT_PER_MINUTE: 1000,
    LICENSE_ENFORCEMENT: 'off', LICENSE_OFFLINE_GRACE_DAYS: 7, INSTANCE_NAME: 'RAHA_TEST', LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    ...over,
  } as Config;
}

export async function startApp(over: Partial<Config> = {}, extra: Parameters<typeof createContext>[1] = {}) {
  const ctx = await createContext(testConfig(over), extra);
  const app = await buildApp(ctx, { logger: false });
  await app.ready();
  return { app, ctx };
}

export async function newCompany(name = `Société ${randomUUID().slice(0, 6)}`) {
  const email = `admin-${randomUUID().slice(0, 8)}@test.td`;
  const { company, admin } = await seedCompany(owner, { companyName: name, email, password: PASSWORD });
  return { company, admin, email };
}

export async function addUser(companyId: string, roleKey: string) {
  const email = `${roleKey}-${randomUUID().slice(0, 8)}@test.td`;
  await owner.user.create({ data: { companyId, email, fullName: `Test ${roleKey}`, roleKey, passwordHash: await hashPassword(PASSWORD) } });
  return email;
}

export class Client {
  cookie = '';
  csrf = '';
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: method as 'GET', url, payload: payload as object,
      headers: { origin: ORIGIN, ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}), ...headers },
    });
    const set = res.headers['set-cookie'];
    const c = (Array.isArray(set) ? set : set ? [set] : []).map((s) => s.split(';')[0]!).find((s) => s.startsWith('rtms_sid='));
    if (c) this.cookie = c === 'rtms_sid=' ? '' : c;
    let body: any;
    try { body = res.json(); } catch { body = res.body; }
    if (body?.csrfToken) this.csrf = body.csrfToken;
    return { status: res.statusCode, body, headers: res.headers, raw: res.body };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, p?: unknown) => this.req('POST', u, p ?? {});
  patch = (u: string, p?: unknown) => this.req('PATCH', u, p);
  put = (u: string, p?: unknown) => this.req('PUT', u, p);

  /** Connexion complète, y compris enrôlement MFA si le rôle l'exige. Renvoie le secret TOTP. */
  async login(email: string, password = PASSWORD): Promise<{ secret?: string; recovery?: string[] }> {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login ${r.status} ${JSON.stringify(r.body)}`);
    if (r.body.state === 'mfa_enroll') {
      const s = await this.post('/api/auth/mfa/setup');
      const en = await this.post('/api/auth/mfa/enable', { code: authenticator.generate(s.body.secret) });
      if (en.status !== 200) throw new Error(`mfa enable ${en.status}`);
      return { secret: s.body.secret, recovery: en.body.recoveryCodes };
    }
    return {};
  }
}

export const invoice = (n: string, extra: Record<string, unknown> = {}) => ({
  data: { 'Numéro de facture': n, Client: 'Client SA', Date: '2026-10-31', 'Désignation': 'Transport Ndjamena-Moundou', 'Quantité': '2', 'Prix unitaire (FCFA)': '250000', 'Taxe (%)': '18', Statut: 'Brouillon', ...extra },
});
export const mission = (ref: string, extra: Record<string, unknown> = {}) => ({
  data: { 'Référence mission': ref, Client: 'Client SA', 'Départ': "N'Djamena", Destination: 'Moundou', Marchandise: 'Ciment', Statut: 'En cours', ...extra },
});
