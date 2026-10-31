import type { Prisma } from '@prisma/client';
import type { Tx } from '../db.js';

export interface AuditEntry {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

/** Les champs secrets ne doivent jamais apparaître dans le journal. */
const REDACT = new Set(['passwordHash', 'password', 'mfaSecretEnc', 'recoveryCodes', 'token', 'licenseKey']);
function scrub(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (REDACT.has(k) ? '[masqué]' : val)));
}

/**
 * Écrit dans la même transaction que l'opération : pas d'opération sans trace.
 * INSERT sans RETURNING : une ligne sans société (échec de connexion d'un e-mail
 * inconnu) n'est pas lisible par l'application, conformément à la RLS.
 */
export async function audit(tx: Tx, e: AuditEntry) {
  const j = (v: unknown) => { const x = scrub(v); return x === undefined ? null : JSON.stringify(x); };
  await tx.$executeRaw`
    INSERT INTO audit_log (company_id, user_id, action, entity, entity_id, before, after, ip, user_agent)
    VALUES (${e.companyId ?? null}::uuid, ${e.userId ?? null}::uuid, ${e.action}, ${e.entity}, ${e.entityId ?? null},
            ${j(e.before)}::jsonb, ${j(e.after)}::jsonb, ${e.ip ?? null}, ${e.userAgent?.slice(0, 300) ?? null})`;
}
