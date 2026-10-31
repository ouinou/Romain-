/**
 * Sessions serveur opaques stockées dans Redis.
 * - Le cookie ne contient qu'un jeton aléatoire (256 bits) ; Redis ne stocke que son empreinte.
 * - Expiration d'inactivité + expiration absolue.
 * - Nouveau jeton à chaque élévation (MFA) : pas de fixation de session.
 */
import type { Redis } from 'ioredis';
import { randomToken, sha256 } from '../crypto.js';

export type SessionState = 'active' | 'mfa_pending' | 'mfa_enroll';

export interface SessionData {
  userId: string;
  companyId: string;
  roleKey: string;
  fullName: string;
  state: SessionState;
  csrf: string;
  createdAt: number;
  absoluteExp: number;
  ip?: string;
  ua?: string;
  mfaAttempts?: number;
  pendingMfaSecretEnc?: string;
}

export class SessionStore {
  constructor(private redis: Redis, private idleSeconds: number, private absoluteSeconds: number) {}

  private key = (token: string) => `sess:${sha256(token)}`;
  private userKey = (userId: string) => `usess:${userId}`;

  async create(data: Omit<SessionData, 'csrf' | 'createdAt' | 'absoluteExp'>): Promise<{ token: string; session: SessionData }> {
    const token = randomToken(32);
    const now = Date.now();
    const session: SessionData = { ...data, csrf: randomToken(24), createdAt: now, absoluteExp: now + this.absoluteSeconds * 1000 };
    const k = this.key(token);
    await this.redis.multi()
      .set(k, JSON.stringify(session), 'EX', this.idleSeconds)
      .sadd(this.userKey(data.userId), k)
      .expire(this.userKey(data.userId), this.absoluteSeconds)
      .exec();
    return { token, session };
  }

  async get(token: string | undefined): Promise<SessionData | null> {
    if (!token || token.length > 100) return null;
    const k = this.key(token);
    const raw = await this.redis.get(k);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionData;
    if (Date.now() > s.absoluteExp) {
      await this.redis.del(k);
      return null;
    }
    await this.redis.expire(k, this.idleSeconds); // glissement de l'inactivité
    return s;
  }

  async save(token: string, s: SessionData) {
    const ttl = Math.min(this.idleSeconds, Math.ceil((s.absoluteExp - Date.now()) / 1000));
    if (ttl <= 0) return this.destroy(token, s.userId);
    await this.redis.set(this.key(token), JSON.stringify(s), 'EX', ttl);
  }

  /** Remplace le jeton (après MFA) en conservant les données. */
  async rotate(oldToken: string, s: SessionData, patch: Partial<SessionData>) {
    await this.destroy(oldToken, s.userId);
    const { csrf: _c, createdAt: _cr, absoluteExp: _a, ...rest } = { ...s, ...patch };
    return this.create(rest);
  }

  async destroy(token: string, userId?: string) {
    const k = this.key(token);
    await this.redis.del(k);
    if (userId) await this.redis.srem(this.userKey(userId), k);
  }

  /** Révocation de toutes les sessions d'un utilisateur (mot de passe changé, compte désactivé). */
  async destroyAllForUser(userId: string, exceptToken?: string) {
    const keys = await this.redis.smembers(this.userKey(userId));
    const keep = exceptToken ? this.key(exceptToken) : undefined;
    const toDelete = keys.filter((k) => k !== keep);
    if (toDelete.length) await this.redis.del(...toDelete);
    await this.redis.del(this.userKey(userId));
    if (keep) await this.redis.sadd(this.userKey(userId), keep);
  }
}
