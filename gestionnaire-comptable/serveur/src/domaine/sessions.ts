import type { Client } from "../db.js";
import type { Config } from "../config.js";
import { empreinteJeton, genererJeton } from "../securite/jetons.js";

export interface SessionValide {
  sessionId: string;
  utilisateur: { id: string; email: string; nom: string; mfaActive: boolean };
  permissions: Set<string>;
  /** Un rôle détenu exige la MFA, l'entreprise l'impose, et l'utilisateur ne l'a pas encore activée. */
  mfaAConfigurer: boolean;
  /** Mot de passe ressaisi récemment dans cette session (opérations sensibles). */
  confirmee: boolean;
}

export async function creerSession(c: Client, cfg: Config, utilisateurId: string, ip: string | null, agent: string | null) {
  const jeton = genererJeton();
  const { rows: [s] } = await c.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, now() + make_interval(hours => $3), $4, $5) RETURNING id`,
    [utilisateurId, empreinteJeton(jeton), cfg.sessionDureeMaxHeures, ip, agent?.slice(0, 300) ?? null]);
  return { sessionId: s.id as string, jeton };
}

/**
 * Valide une session et rafraîchit sa dernière activité.
 * Révoque immédiatement une session expirée (inactivité, durée maximale) ou dont le compte n'est plus autorisé.
 */
export async function validerSession(c: Client, cfg: Config, jeton: string): Promise<SessionValide | { refus: string }> {
  const { rows: [s] } = await c.query(
    `SELECT s.id, s.revoked_at, s.user_id,
            (now() - s.last_seen_at) > make_interval(mins => $2) AS inactive,
            now() > s.expires_at AS expiree,
            s.reauth_at IS NOT NULL AND (now() - s.reauth_at) < make_interval(mins => $3) AS confirmee,
            u.status, u.email, u.full_name, u.mfa_enabled,
            u.access_expires_at IS NOT NULL AND u.access_expires_at < now() AS acces_expire,
            coalesce((co.settings->>'mfaObligatoire')::boolean, true) AS mfa_obligatoire
       FROM user_sessions s
       JOIN app_users u ON u.id = s.user_id
       JOIN companies co ON co.id = s.company_id
      WHERE s.token_hash = $1
      FOR UPDATE OF s`,
    [empreinteJeton(jeton), cfg.sessionInactiviteMinutes, cfg.confirmationMinutes]);
  if (!s || s.revoked_at) return { refus: "Session inconnue ou fermée. Reconnectez-vous." };
  const raison = s.inactive ? "inactivite" : s.expiree ? "duree_maximale" : s.status !== "active" ? "compte_inactif" : s.acces_expire ? "acces_expire" : null;
  if (raison) {
    await c.query("UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1", [s.id, raison]);
    return { refus: raison === "inactivite" ? "Session fermée après une période d'inactivité. Reconnectez-vous." : "Session expirée. Reconnectez-vous." };
  }
  await c.query("UPDATE user_sessions SET last_seen_at = now() WHERE id = $1", [s.id]);
  const { permissions, mfaRequis } = await chargerPermissions(c, s.user_id);
  return {
    sessionId: s.id,
    utilisateur: { id: s.user_id, email: s.email, nom: s.full_name, mfaActive: s.mfa_enabled },
    permissions,
    mfaAConfigurer: mfaRequis && s.mfa_obligatoire && !s.mfa_enabled,
    confirmee: s.confirmee,
  };
}

export async function chargerPermissions(c: Client, utilisateurId: string) {
  const { rows } = await c.query(
    `SELECT p.permission_key, r.mfa_required
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.archived_at IS NULL
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1`, [utilisateurId]);
  return {
    permissions: new Set<string>(rows.filter((r) => r.permission_key).map((r) => r.permission_key)),
    mfaRequis: rows.some((r) => r.mfa_required),
  };
}

export async function revoquerSessions(c: Client, utilisateurId: string, raison: string, saufSessionId?: string) {
  const r = await c.query(
    "UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $3",
    [utilisateurId, raison, saufSessionId ?? null]);
  return r.rowCount ?? 0;
}
