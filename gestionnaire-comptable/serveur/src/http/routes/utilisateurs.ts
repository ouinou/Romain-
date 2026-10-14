import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { revoquerSessions } from "../../domaine/sessions.js";
import { empreinteJeton, genererJeton } from "../../securite/jetons.js";
import { exiger, pagination, proteger, type Ctx, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";

const motif = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(500);
const idsRoles = z.array(z.string().regex(UUID)).max(20);

function idParam(req: { params: unknown }) {
  const id = (req.params as { id?: string }).id ?? "";
  if (!UUID.test(id)) throw nonTrouve("Utilisateur");
  return id;
}

async function chargerUtilisateur(c: Client, id: string, verrouiller = false) {
  if (verrouiller) await c.query("SELECT 1 FROM app_users WHERE id = $1 FOR UPDATE", [id]);
  const { rows: [u] } = await c.query(
    `SELECT u.id, u.email, u.full_name, u.status, u.access_expires_at, u.last_login_at, u.created_at, u.mfa_enabled,
            u.locked_until IS NOT NULL AND u.locked_until > now() AS verrouille,
            coalesce(json_agg(json_build_object('id', r.id, 'cle', r.role_key, 'libelle', r.display_name) ORDER BY r.display_name)
                     FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
       FROM app_users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = $1
      GROUP BY u.id`, [id]);
  if (!u) throw nonTrouve("Utilisateur");
  return u;
}

const vue = (u: Record<string, any>) => ({
  id: u.id, email: u.email, nom: u.full_name, statut: u.status, verrouille: u.verrouille,
  accesExpireLe: u.access_expires_at, derniereConnexion: u.last_login_at, creeLe: u.created_at,
  mfaActive: u.mfa_enabled, roles: u.roles,
});

/** Empêche de retirer le dernier administrateur actif : l'entreprise ne doit jamais se bloquer elle-même. */
async function verifierResteUnAdmin(c: Client, utilisateurPerdantAdmin: string) {
  const { rows: [r] } = await c.query(
    `SELECT count(DISTINCT u.id)::int AS n
       FROM app_users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN roles ro ON ro.id = ur.role_id AND ro.archived_at IS NULL
       JOIN permissions p ON p.id = rp.permission_id AND p.permission_key = 'users.admin'
      WHERE u.status = 'active' AND u.id <> $1`, [utilisateurPerdantAdmin]);
  if (r.n === 0) throw new ErreurHttp(409, "dernier_administrateur", "Impossible : ce compte est le dernier administrateur actif de l'entreprise.");
}

async function aLaPermission(c: Client, utilisateurId: string, permission: string) {
  const { rowCount } = await c.query(
    `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.archived_at IS NULL
       JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1 AND p.permission_key = $2 LIMIT 1`, [utilisateurId, permission]);
  return (rowCount ?? 0) > 0;
}

function pasSurSoiMeme(ctx: Ctx, id: string, action: string) {
  if (id === ctx.utilisateur.id)
    throw new ErreurHttp(403, "action_sur_soi_interdite", `Vous ne pouvez pas ${action} votre propre compte. Demandez à un autre administrateur.`,
      { type: "security", action: "self_change_denied", resultat: "denied", objetType: "user", objetId: id, details: { tentative: action } });
}

async function creerJeton(ctx: Ctx, utilisateurId: string, objet: "invitation" | "password_reset") {
  const jeton = genererJeton();
  await ctx.c.query("UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [utilisateurId, objet]);
  const duree = objet === "invitation" ? "72 hours" : "30 minutes";
  const { rows: [t] } = await ctx.c.query(
    `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, now() + $4::interval, $5) RETURNING expires_at`,
    [utilisateurId, objet, empreinteJeton(jeton), duree, ctx.utilisateur.id]);
  return { jeton, expireLe: t.expires_at as Date };
}

async function remplacerRoles(ctx: Ctx, utilisateurId: string, roles: string[]) {
  if (roles.length) {
    const { rows } = await ctx.c.query("SELECT id FROM roles WHERE id = ANY($1::uuid[]) AND archived_at IS NULL", [roles]);
    if (rows.length !== new Set(roles).size) throw new ErreurHttp(400, "role_inconnu", "Un des rôles choisis n'existe pas ou est archivé.");
  }
  await ctx.c.query("DELETE FROM user_roles WHERE user_id = $1", [utilisateurId]);
  for (const r of new Set(roles))
    await ctx.c.query("INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1,$2,$3)", [utilisateurId, r, ctx.utilisateur.id]);
}

export function routesUtilisateurs(app: FastifyInstance, deps: Dependances) {
  // Liste paginée avec recherche et filtres.
  app.get("/api/utilisateurs", proteger(deps, { permission: "users.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { page, taille, offset } = pagination(q);
    const filtres: string[] = [], val: unknown[] = [];
    if (q.recherche) { val.push(`%${q.recherche.trim().toLowerCase()}%`); filtres.push(`(lower(u.full_name) LIKE $${val.length} OR lower(u.email) LIKE $${val.length})`); }
    if (q.statut && ["invited", "active", "disabled"].includes(q.statut)) { val.push(q.statut); filtres.push(`u.status = $${val.length}`); }
    if (q.role && UUID.test(q.role)) { val.push(q.role); filtres.push(`EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role_id = $${val.length})`); }
    const where = filtres.length ? "WHERE " + filtres.join(" AND ") : "";
    const tri = ({ nom: "u.full_name", email: "u.email", connexion: "u.last_login_at DESC NULLS LAST", creation: "u.created_at DESC" } as Record<string, string>)[q.tri ?? "nom"] ?? "u.full_name";
    const { rows: [{ total }] } = await ctx.c.query(`SELECT count(*)::int AS total FROM app_users u ${where}`, val);
    const { rows } = await ctx.c.query(
      `SELECT u.id, u.email, u.full_name, u.status, u.access_expires_at, u.last_login_at, u.created_at, u.mfa_enabled,
              u.locked_until IS NOT NULL AND u.locked_until > now() AS verrouille,
              coalesce(json_agg(json_build_object('id', r.id, 'cle', r.role_key, 'libelle', r.display_name) ORDER BY r.display_name)
                       FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
         FROM app_users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
         ${where} GROUP BY u.id ORDER BY ${tri}, u.id LIMIT ${taille} OFFSET ${offset}`, val);
    return { elements: rows.map(vue), total, page, taille };
  }));

  app.get("/api/utilisateurs/:id", proteger(deps, { permission: "users.read" }, async (req, ctx) =>
    vue(await chargerUtilisateur(ctx.c, idParam(req)))));

  // Création par invitation : le jeton est affiché une seule fois, à remettre à la personne.
  app.post("/api/utilisateurs", proteger(deps, { permission: "users.create" }, async (req, ctx) => {
    const d = z.object({
      nom: z.string().trim().min(3).max(120),
      email: z.string().trim().toLowerCase().email().max(254),
      roles: idsRoles.default([]),
      accesExpireLe: z.coerce.date().nullable().optional(),
    }).parse(req.body);
    if (d.roles.length) exiger(ctx, "users.admin");
    if (d.accesExpireLe && d.accesExpireLe < new Date()) throw new ErreurHttp(400, "date_passee", "La date de fin d'accès doit être dans le futur.");
    const existe = await ctx.c.query("SELECT 1 FROM app_users WHERE lower(email) = $1", [d.email]);
    if (existe.rowCount) throw new ErreurHttp(409, "email_existant", "Un compte utilise déjà cette adresse e-mail dans cette entreprise.");
    const { rows: [u] } = await ctx.c.query(
      "INSERT INTO app_users (email, full_name, status, access_expires_at) VALUES ($1,$2,'invited',$3) RETURNING id",
      [d.email, d.nom, d.accesExpireLe ?? null]);
    await remplacerRoles(ctx, u.id, d.roles);
    const invitation = await creerJeton(ctx, u.id, "invitation");
    await ctx.journaliser({ type: "users", action: "create", objetType: "user", objetId: u.id,
      apres: { email: d.email, nom: d.nom, roles: d.roles, accesExpireLe: d.accesExpireLe ?? null } });
    return { utilisateur: vue(await chargerUtilisateur(ctx.c, u.id)), invitation };
  }));

  app.patch("/api/utilisateurs/:id", proteger(deps, { permission: "users.update" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({
      nom: z.string().trim().min(3).max(120).optional(),
      accesExpireLe: z.coerce.date().nullable().optional(),
    }).parse(req.body);
    const avant = await chargerUtilisateur(ctx.c, id, true);
    if (d.accesExpireLe !== undefined) pasSurSoiMeme(ctx, id, "modifier la date d'expiration de");
    const { rows: [u] } = await ctx.c.query(
      `UPDATE app_users SET full_name = coalesce($2, full_name),
              access_expires_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE access_expires_at END
        WHERE id = $1 RETURNING full_name, access_expires_at`,
      [id, d.nom ?? null, d.accesExpireLe !== undefined, d.accesExpireLe ?? null]);
    await ctx.journaliser({ type: "users", action: "update", objetType: "user", objetId: id,
      avant: { nom: avant.full_name, accesExpireLe: avant.access_expires_at }, apres: { nom: u.full_name, accesExpireLe: u.access_expires_at } });
    return vue(await chargerUtilisateur(ctx.c, id));
  }));

  app.post("/api/utilisateurs/:id/desactivation", proteger(deps, { permission: "users.admin" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ motif }).parse(req.body);
    pasSurSoiMeme(ctx, id, "désactiver");
    const u = await chargerUtilisateur(ctx.c, id, true);
    if (u.status === "disabled") throw new ErreurHttp(409, "deja_desactive", "Ce compte est déjà désactivé.");
    if (await aLaPermission(ctx.c, id, "users.admin")) await verifierResteUnAdmin(ctx.c, id);
    await ctx.c.query("UPDATE app_users SET status = 'disabled' WHERE id = $1", [id]);
    const n = await revoquerSessions(ctx.c, id, "compte_desactive");
    await ctx.c.query("UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [id]);
    await ctx.journaliser({ type: "users", action: "disable", objetType: "user", objetId: id, motif: d.motif,
      avant: { statut: u.status }, apres: { statut: "disabled" }, details: { sessionsFermees: n } });
    return vue(await chargerUtilisateur(ctx.c, id));
  }));

  app.post("/api/utilisateurs/:id/reactivation", proteger(deps, { permission: "users.admin" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ motif }).parse(req.body);
    const { rows: [u] } = await ctx.c.query("SELECT status, password_hash IS NOT NULL AS a_mdp FROM app_users WHERE id = $1 FOR UPDATE", [id]);
    if (!u) throw nonTrouve("Utilisateur");
    if (u.status !== "disabled") throw new ErreurHttp(409, "non_desactive", "Seul un compte désactivé peut être réactivé.");
    const statut = u.a_mdp ? "active" : "invited";
    await ctx.c.query("UPDATE app_users SET status = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1", [id, statut]);
    await ctx.journaliser({ type: "users", action: "enable", objetType: "user", objetId: id, motif: d.motif, avant: { statut: "disabled" }, apres: { statut } });
    return vue(await chargerUtilisateur(ctx.c, id));
  }));

  app.post("/api/utilisateurs/:id/deverrouillage", proteger(deps, { permission: "users.admin" }, async (req, ctx) => {
    const id = idParam(req);
    const r = await ctx.c.query("UPDATE app_users SET failed_login_count = 0, locked_until = NULL WHERE id = $1 AND locked_until > now()", [id]);
    if (!r.rowCount) throw new ErreurHttp(409, "non_verrouille", "Ce compte n'est pas verrouillé.");
    await ctx.journaliser({ type: "security", action: "account_unlock", objetType: "user", objetId: id });
    return vue(await chargerUtilisateur(ctx.c, id));
  }));

  app.put("/api/utilisateurs/:id/roles", proteger(deps, { permission: "users.admin" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ roles: idsRoles, motif }).parse(req.body);
    pasSurSoiMeme(ctx, id, "modifier les rôles de");
    const avant = await chargerUtilisateur(ctx.c, id, true);
    const etaitAdmin = await aLaPermission(ctx.c, id, "users.admin");
    await remplacerRoles(ctx, id, d.roles);
    if (etaitAdmin && !(await aLaPermission(ctx.c, id, "users.admin"))) await verifierResteUnAdmin(ctx.c, id);
    const apres = await chargerUtilisateur(ctx.c, id);
    await ctx.journaliser({ type: "roles", action: "assign", objetType: "user", objetId: id, motif: d.motif,
      avant: avant.roles.map((r: { cle: string }) => r.cle), apres: apres.roles.map((r: { cle: string }) => r.cle) });
    return vue(apres);
  }));

  app.post("/api/utilisateurs/:id/invitation", proteger(deps, { permission: "users.create" }, async (req, ctx) => {
    const id = idParam(req);
    const u = await chargerUtilisateur(ctx.c, id, true);
    if (u.status !== "invited") throw new ErreurHttp(409, "deja_active", "Ce compte a déjà été activé.");
    const invitation = await creerJeton(ctx, id, "invitation");
    await ctx.journaliser({ type: "users", action: "invite_renew", objetType: "user", objetId: id });
    return { invitation };
  }));

  // Réinitialisation hors ligne : l'administrateur remet le code en main propre (pas de serveur e-mail requis).
  app.post("/api/utilisateurs/:id/reinitialisation-mot-de-passe", proteger(deps, { permission: "users.admin" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ motif }).parse(req.body);
    pasSurSoiMeme(ctx, id, "réinitialiser le mot de passe de");
    const u = await chargerUtilisateur(ctx.c, id, true);
    if (u.status !== "active") throw new ErreurHttp(409, "compte_inactif", "Seul un compte actif peut recevoir un code de réinitialisation.");
    const reinitialisation = await creerJeton(ctx, id, "password_reset");
    await ctx.journaliser({ type: "users", action: "password_reset_issue", objetType: "user", objetId: id, motif: d.motif });
    return { reinitialisation };
  }));

  app.post("/api/utilisateurs/:id/revocation-sessions", proteger(deps, { permission: "users.admin" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ motif }).parse(req.body);
    await chargerUtilisateur(ctx.c, id);
    const n = await revoquerSessions(ctx.c, id, "revocation_administrateur", id === ctx.utilisateur.id ? ctx.sessionId : undefined);
    await ctx.journaliser({ type: "security", action: "sessions_revoke", objetType: "user", objetId: id, motif: d.motif, details: { sessionsFermees: n } });
    return { sessionsFermees: n };
  }));

  // Historique des connexions d'un utilisateur (succès, échecs, refus).
  app.get("/api/utilisateurs/:id/connexions", proteger(deps, { permission: "users.read" }, async (req, ctx) => {
    const id = idParam(req);
    const { page, taille, offset } = pagination(req.query as Record<string, string>);
    const { rows } = await ctx.c.query(
      `SELECT occurred_at, action, outcome, host(ip_address) AS ip, event_details->>'raison' AS raison
         FROM audit_events WHERE actor_user_id = $1 AND event_type IN ('auth', 'security')
        ORDER BY sequence_no DESC LIMIT $2 OFFSET $3`, [id, taille, offset]);
    return { elements: rows.map((r) => ({ date: r.occurred_at, action: r.action, resultat: r.outcome, ip: r.ip, raison: r.raison })), page, taille };
  }));
}
