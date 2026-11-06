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

export type LicenseState = 'valid' | 'grace' | 'trial' | 'trial_expired' | 'missing' | 'invalid' | 'expired' | 'revoked' | 'unconfigured';

export interface LicenseStatus {
  state: LicenseState;
  reason?: string;
  enforcement: 'enforce' | 'warn' | 'off';
  installationId?: string;
  /** Empreinte du poste, à communiquer à l'éditeur pour une licence hors ligne. */
  deviceHash?: string;
  customer?: string;
  plan?: string;
  expiresAt?: string;
  refreshBy?: string;
  maxUsers?: number;
  /** Période d'essai (installation locale) : fin de l'essai et jours restants. */
  trialEndsAt?: string;
  trialDaysLeft?: number;
  /** Code à transmettre à l'éditeur pour recevoir la licence (identifiant d'installation + empreinte). */
  activationCode?: string;
  /** false : le logiciel est bloqué jusqu'à l'activation d'une licence. */
  usable?: boolean;
}

export interface LicenseGuardOptions {
  publicKeyPem?: string;
  issuerUrl?: string;
  enforcement: 'enforce' | 'warn' | 'off';
  graceDays: number;
  deviceId?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /**
   * Installation locale (poste principal) : jours d'essai gratuit avant que le logiciel ne se
   * bloque, faute de licence activée. Absent (serveur hébergé) : comportement inchangé.
   */
  trialDays?: number;
}

/** Code d'activation : ce que l'éditeur doit connaître pour signer une licence pour CE poste. */
export function activationCode(installationId: string, deviceHash: string) {
  return `RTMS-ACT1.${Buffer.from(JSON.stringify({ i: installationId, d: deviceHash })).toString('base64url')}`;
}

/** Motifs de refus, en clair pour l'utilisateur. */
const LICENSE_REASONS: Record<string, string> = {
  format: 'le texte collé n’est pas une licence RTMS complète',
  signature: 'la licence n’a pas été émise par l’éditeur de RTMS',
  installation: 'cette licence a été établie pour une autre installation',
  device: 'cette licence a été établie pour un autre ordinateur',
  expired: 'la licence est expirée',
  refresh_overdue: 'la licence doit être renouvelée',
  not_yet_valid: 'la licence n’est pas encore valide (vérifiez la date du PC)',
};

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
  private clockTimer?: NodeJS.Timeout;
  private trialStart = 0;
  private highWater = 0;
  private token?: string;

  constructor(private prisma: PrismaClient, private opts: LicenseGuardOptions) {
    this.publicKey = opts.publicKeyPem ? loadPublicKey(opts.publicKeyPem) : undefined;
    this.current = { state: 'unconfigured', enforcement: opts.enforcement };
  }

  private wallMs = () => this.opts.now?.() ?? Date.now();
  /** Heure retenue : jamais avant la plus récente déjà vue (un recul d'horloge est ignoré). */
  private nowSec = () => Math.floor(Math.max(this.wallMs(), this.highWater) / 1000);

  async init() {
    let inst = await this.prisma.installation.findUnique({ where: { id: 1 } });
    if (!inst) {
      inst = await this.prisma.installation.upsert({ where: { id: 1 }, update: {}, create: { id: 1, installationId: randomUUID() } });
    }
    this.installationId = inst.installationId;
    this.deviceHash = sha256(`${this.opts.deviceId ?? machineId()}|${inst.installationId}`);
    this.trialStart = inst.createdAt.getTime();
    this.highWater = Math.max(inst.clockHighWater?.getTime() ?? 0, this.trialStart);
    this.token = inst.licenseToken ?? undefined;
    this.evaluate(this.token);
    if (this.opts.trialDays) await this.tick();
    return this;
  }

  /**
   * Toutes les 5 minutes (installation locale) : mémorise l'heure la plus récente et réévalue,
   * pour que la fin de l'essai ou de l'abonnement s'applique sans redémarrage.
   */
  async tick() {
    const now = this.wallMs();
    if (now > this.highWater + 60_000) {
      this.highWater = now;
      await this.prisma.installation.update({ where: { id: 1 }, data: { clockHighWater: new Date(now) } }).catch(() => {});
    }
    this.evaluate(this.token);
  }

  startClock(minutes = 5) {
    if (!this.opts.trialDays) return;
    this.clockTimer = setInterval(() => void this.tick(), minutes * 60_000);
    this.clockTimer.unref();
  }

  getInstallationId() { return this.installationId; }
  getDeviceHash() { return this.deviceHash; }

  private evaluate(token?: string) {
    this.evaluateLicense(token);
    const s = this.current;
    if (this.opts.trialDays) {
      const licensed = s.state === 'valid' || s.state === 'grace';
      if (!licensed && (s.state === 'missing' || s.state === 'unconfigured' || s.state === 'invalid')) {
        // Pas de licence (ou licence d'un autre poste) : période d'essai
        const end = this.trialStart + this.opts.trialDays * 86400_000;
        const left = end - this.nowSec() * 1000;
        // Horloges du serveur et de la base légèrement décalées : jamais plus que la durée d'essai
        const days = Math.min(this.opts.trialDays, Math.max(0, Math.ceil(left / 86400_000)));
        this.current = {
          ...s,
          state: left > 0 ? 'trial' : 'trial_expired',
          reason: left > 0 ? `Version d’essai : ${days} jour(s) restant(s)` : `Période d’essai de ${this.opts.trialDays} jours terminée : activez une licence pour continuer`,
          trialEndsAt: new Date(end).toISOString(),
          trialDaysLeft: days,
        };
      }
      this.current.usable = ['valid', 'grace', 'trial'].includes(this.current.state);
      if (this.installationId && this.deviceHash) this.current.activationCode = activationCode(this.installationId, this.deviceHash);
    }
  }

  private evaluateLicense(token?: string) {
    const base = { enforcement: this.opts.enforcement, installationId: this.installationId, deviceHash: this.deviceHash };
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

  /** Installation locale : false quand l'essai est terminé (ou la licence expirée) sans licence valide. */
  usable(): boolean {
    if (!this.opts.trialDays) return true;
    return this.current.usable !== false;
  }
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
    this.evaluateLicense(token); // le jeton lui-même, sans repli sur la période d'essai
    if (this.current.state !== 'valid') {
      const reason = this.current.reason;
      this.current = before;
      throw new Error(`Licence refusée : ${LICENSE_REASONS[reason ?? ''] ?? reason}`);
    }
    this.token = token;
    this.evaluate(token);
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

  stop() { if (this.timer) clearInterval(this.timer); if (this.clockTimer) clearInterval(this.clockTimer); }
}
