import type { Client, Pool } from "../db.js";
import { transaction } from "../db.js";

export type Resultat = "success" | "denied" | "failure";

export interface Evenement {
  type: string;              // famille : auth, users, roles, company, audit, security, backups…
  action: string;            // action précise : login, create, disable, export…
  resultat?: Resultat;
  acteurId?: string | null;
  sessionId?: string | null;
  objetType?: string;
  objetId?: string;
  avant?: unknown;
  apres?: unknown;
  motif?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Ajoute un événement au journal de l'entreprise courante, dans la transaction en cours :
 * il est enregistré si et seulement si l'opération elle-même est validée.
 * Horodatage, séquence et empreinte sont imposés par la base.
 */
export async function journaliser(c: Client, e: Evenement): Promise<void> {
  await c.query(
    `INSERT INTO audit_events (actor_user_id, session_id, event_type, action, object_type, object_id, outcome,
                               event_details, previous_value, new_value, reason, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [e.acteurId ?? null, e.sessionId ?? null, e.type, e.action, e.objetType ?? null, e.objetId ?? null,
     e.resultat ?? "success", JSON.stringify(e.details ?? {}),
     e.avant === undefined ? null : JSON.stringify(e.avant), e.apres === undefined ? null : JSON.stringify(e.apres),
     e.motif ?? null, e.ip ?? null],
  );
}

/** Pour les refus et les échecs : écrit dans sa propre transaction, indépendante de l'opération annulée. */
export const journaliserIsole = (pool: Pool, entrepriseId: string, e: Evenement) =>
  transaction(pool, entrepriseId, (c) => journaliser(c, e));

/** Journal système : événements sans entreprise identifiée. */
export async function journaliserSysteme(pool: Pool | Client, type: string, resultat: Resultat, details: Record<string, unknown>, ip?: string | null) {
  await pool.query("INSERT INTO system_events (event_type, outcome, details, ip_address) VALUES ($1,$2,$3,$4)",
    [type, resultat, JSON.stringify(details), ip ?? null]);
}

export interface Integrite { valide: boolean; anomalies: { sequence: number; probleme: string }[]; derniereSequence: number; derniereEmpreinte: string | null; total: number }

export async function verifierIntegrite(c: Client, entrepriseId: string): Promise<Integrite> {
  const a = await c.query("SELECT seq, problem FROM audit_verify_chain($1)", [entrepriseId]);
  const d = await c.query("SELECT sequence_no, event_hash, (SELECT count(*) FROM audit_events WHERE company_id=$1)::int AS total FROM audit_events WHERE company_id=$1 ORDER BY sequence_no DESC LIMIT 1", [entrepriseId]);
  return {
    valide: a.rowCount === 0,
    anomalies: a.rows.map((r) => ({ sequence: Number(r.seq), probleme: r.problem })),
    derniereSequence: d.rows[0] ? Number(d.rows[0].sequence_no) : 0,
    derniereEmpreinte: d.rows[0]?.event_hash ?? null,
    total: d.rows[0]?.total ?? 0,
  };
}

/** Notification visible par une personne précise ou par toute personne disposant d'une permission. */
export async function notifier(c: Client, n: { destinataireId?: string; permission?: string; type: "info" | "warning" | "security"; titre: string; corps?: string }) {
  await c.query("INSERT INTO notifications (recipient_user_id, required_permission, kind, title, body) VALUES ($1,$2,$3,$4,$5)",
    [n.destinataireId ?? null, n.permission ?? null, n.type, n.titre, n.corps ?? null]);
}
