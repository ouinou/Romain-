/**
 * Côté installation : vérification de la licence par l'API (jamais par le navigateur).
 * - Identifiant d'installation généré au premier démarrage (table installation).
 * - Empreinte d'appareil = SHA-256(machine-id + identifiant d'installation).
 * - Jeton vérifié avec la clé publique Ed25519 ; renouvellement en ligne périodique,
 *   tolérance hors-ligne configurable, prise en compte de la révocation.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import type { KeyObject } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { sha256 } from '../crypto.js';
import { loadPublicKey, verifyLicense, type LicensePayload } from './token.js';

export type LicenseState = 'valid' | 'grace' | 'missing' | 'invalid' | 'expired' | 'revoked' | 'unconfigured';

export interface LicenseStatus {
  state: LicenseState;
  reason?: string;
  enforcement: 'enforce' | 'warn' | 'off';
  installationId?: string;
  customer?: string;
  plan?: string;
  expiresAt?: string;
  refreshBy?: string;
  maxUsers?: number;
}

export interface LicenseGuardOptions {
  publicKeyPem?: string;
  issuerUrl?: string;
  enforcement: 'enforce' | 'warn' | 'off';
  graceDays: number;
  deviceId?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function machineId(): string {
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const v = readFileSync(p, 'utf8').trim();
      if (v) return v;
    } catch { /* absent */ }
  }
  return hostname();
}

export class LicenseGuard {
  private publicKey?: KeyObject;
  private installationId?: string;
  private deviceHash?: string;
  private current: LicenseStatus;
  private payload?: LicensePayload;
  private revoked = false;
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaClient, private opts: LicenseGuardOptions) {
    this.publicKey = opts.publicKeyPem ? loadPublicKey(opts.publicKeyPem) : undefined;
    this.current = { state: 'unconfigured', enforcement: opts.enforcement };
  }

  private nowSec = () => Math.floor((this.opts.now?.() ?? Date.now()) / 1000);

  async init() {
    let inst = await this.prisma.installation.findUnique({ where: { id: 1 } });
    if (!inst) {
      inst = await this.prisma.installation.upsert({ where: { id: 1 }, update: {}, create: { id: 1, installationId: randomUUID() } });
    }
    this.installationId = inst.installationId;
    this.deviceHash = sha256(`${this.opts.deviceId ?? machineId()}|${inst.installationId}`);
    this.evaluate(inst.licenseToken ?? undefined);
    return this;
  }

  getInstallationId() { return this.installationId; }
  getDeviceHash() { return this.deviceHash; }

  private evaluate(token?: string) {
    const base = { enforcement: this.opts.enforcement, installationId: this.installationId };
    if (!this.publicKey) { this.current = { ...base, state: 'unconfigured', reason: 'Clé publique de licence non configurée' }; return; }
    if (this.revoked) { this.current = { ...base, state: 'revoked', reason: 'Licence révoquée par l’éditeur' }; return; }
    if (!token) { this.current = { ...base, state: 'missing', reason: 'Aucune licence activée' }; return; }
    const r = verifyLicense(token, this.publicKey, {
      installationId: this.installationId!, deviceHash: this.deviceHash!, now: this.nowSec(), graceSeconds: this.opts.graceDays * 86400,
    });
    if (!r.ok) {
      this.payload = undefined;
      this.current = { ...base, state: r.reason === 'expired' ? 'expired' : 'invalid', reason: r.reason };
      return;
    }
    this.payload = r.payload;
    const p = r.payload;
    this.current = {
      ...base,
      state: this.nowSec() >= p.refreshBy ? 'grace' : 'valid',
      customer: p.customer, plan: p.plan, maxUsers: p.maxUsers,
      expiresAt: new Date(p.exp * 1000).toISOString(), refreshBy: new Date(p.refreshBy * 1000).toISOString(),
    };
  }

  status(): LicenseStatus { return { ...this.current }; }
  features(): string[] { return this.payload?.features ?? []; }

  /** Les écritures sont bloquées si la licence n'est pas valide (lecture et export restent possibles). */
  writable(): boolean {
    if (this.opts.enforcement !== 'enforce') return true;
    return this.current.state === 'valid' || this.current.state === 'grace';
  }

  private async store(token: string) {
    await this.prisma.installation.update({ where: { id: 1 }, data: { licenseToken: token, lastCheckAt: new Date() } });
  }

  async installToken(token: string) {
    this.revoked = false;
    const before = this.current;
    this.evaluate(token);
    if (this.current.state !== 'valid') {
      const reason = this.current.reason;
      this.current = before;
      throw new Error(`Licence refusée : ${reason}`);
    }
    await this.store(token);
  }

  async activate(licenseKey: string, appVersion: string) {
    if (!this.opts.issuerUrl) throw new Error('LICENSE_ISSUER_URL non configuré');
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.issuerUrl}/licensing/v1/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey, installationId: this.installationId, deviceHash: this.deviceHash, appVersion }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
    if (!res.ok || !body.token) throw new Error(body.message ?? `Activation refusée (${res.status})`);
    await this.installToken(body.token);
    return this.status();
  }

  async refresh() {
    if (!this.opts.issuerUrl) return this.status();
    const inst = await this.prisma.installation.findUnique({ where: { id: 1 } });
    if (!inst?.licenseToken) return this.status();
    const f = this.opts.fetchImpl ?? fetch;
    try {
      const res = await f(`${this.opts.issuerUrl}/licensing/v1/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: inst.licenseToken }),
      });
      const body = (await res.json().catch(() => ({}))) as { token?: string; revoked?: boolean };
      if (res.status === 403 && body.revoked) {
        this.revoked = true;
        this.evaluate(inst.licenseToken);
      } else if (res.ok && body.token) {
        await this.installToken(body.token);
      }
    } catch {
      // Hors ligne : on garde le jeton courant, la tolérance s'applique
      this.evaluate(inst.licenseToken);
    }
    return this.status();
  }

  startAutoRefresh(hours = 12) {
    this.timer = setInterval(() => void this.refresh(), hours * 3600_000);
    this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}
