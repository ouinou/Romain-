import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { exiger, exigerConfirmation, proteger, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";

const cleRole = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,40}$/, "Clé : lettres minuscules, chiffres et _ (3 à 41 caractères).");
const listePermissions = z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).max(200);
const motif = z.string().trim().min(3).max(500);

function idParam(req: { params: unknown }) {
  const id = (req.params as { id?: string }).id ?? "";
  if (!UUID.test(id)) throw nonTrouve("Rôle");
  return id;
}

async function chargerRole(c: Client, id: string) {
  const { rows: [r] } = await c.query(
    `SELECT r.id, r.role_key, r.display_name, r.description, r.is_system_role, r.mfa_required, r.archived_at,
            coalesce(array_agg(p.permission_key ORDER BY p.permission_key) FILTER (WHERE p.id IS NOT NULL), '{}') AS permissions,
            (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS utilisateurs
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE r.id = $1 GROUP BY r.id`, [id]);
  if (!r) throw nonTrouve("Rôle");
  return r;
}

const vue = (r: Record<string, any>) => ({
  id: r.id, cle: r.role_key, libelle: r.display_name, description: r.description, systeme: r.is_system_role,
  mfaRequise: r.mfa_required, archiveLe: r.archived_at, permissions: r.permissions, utilisateurs: r.utilisateurs,
});

async function verifierPermissionsConnues(c: Client, perms: string[]) {
  if (!perms.length) return;
  const { rows } = await c.query("SELECT permission_key FROM permissions WHERE permission_key = ANY($1::text[])", [perms]);
  const connues = new Set(rows.map((r) => r.permission_key));
  const inconnues = [...new Set(perms)].filter((p) => !connues.has(p));
  if (inconnues.length) throw new ErreurHttp(400, "permission_inconnue", `Permission inconnue : ${inconnues.join(", ")}.`);
}

async function ecrirePermissions(c: Client, roleId: string, perms: string[], par: string) {
  await c.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
  await c.query(
    `INSERT INTO role_permissions (role_id, permission_id, granted_by)
     SELECT $1, id, $3 FROM permissions WHERE permission_key = ANY($2::text[])`, [roleId, perms, par]);
}

export function routesRoles(app: FastifyInstance, deps: Dependances) {
  // Catalogue : grille modules × actions, pour construire l'écran d'édition des rôles.
  app.get("/api/permissions/catalogue", proteger(deps, { permission: "roles.read" }, async (_req, ctx) => {
    const { rows: modules } = await ctx.c.query("SELECT module_key AS cle, label AS libelle FROM permission_modules ORDER BY sort_order");
    const { rows: actions } = await ctx.c.query("SELECT action_key AS cle, label AS libelle FROM permission_actions ORDER BY sort_order");
    return { modules, actions };
  }));

  app.get("/api/roles", proteger(deps, { permission: "roles.read" }, async (req, ctx) => {
    const archives = (req.query as { archives?: string }).archives === "oui";
    const { rows } = await ctx.c.query(`SELECT id FROM roles ${archives ? "" : "WHERE archived_at IS NULL"} ORDER BY is_system_role DESC, display_name`);
    const roles = [];
    for (const r of rows) roles.push(vue(await chargerRole(ctx.c, r.id)));   // une connexion = une requête à la fois
    return roles;
  }));

  app.get("/api/roles/:id", proteger(deps, { permission: "roles.read" }, async (req, ctx) => vue(await chargerRole(ctx.c, idParam(req)))));

  // Rôle personnalisé, vide ou copié d'un rôle existant.
  app.post("/api/roles", proteger(deps, { permission: "roles.create" }, async (req, ctx) => {
    const d = z.object({
      cle: cleRole, libelle: z.string().trim().min(3).max(80), description: z.string().trim().max(300).optional(),
      mfaRequise: z.boolean().default(false), permissions: listePermissions.default([]), copierDe: z.string().regex(UUID).optional(),
    }).parse(req.body);
    let perms = d.permissions;
    if (d.copierDe) perms = [...new Set([...perms, ...(await chargerRole(ctx.c, d.copierDe)).permissions])];
    if (perms.length) { exiger(ctx, "roles.admin"); exigerConfirmation(ctx); }
    await verifierPermissionsConnues(ctx.c, perms);
    const existe = await ctx.c.query("SELECT 1 FROM roles WHERE role_key = $1", [d.cle]);
    if (existe.rowCount) throw new ErreurHttp(409, "cle_existante", "Un rôle utilise déjà cette clé.");
    const { rows: [r] } = await ctx.c.query(
      "INSERT INTO roles (role_key, display_name, description, mfa_required) VALUES ($1,$2,$3,$4) RETURNING id",
      [d.cle, d.libelle, d.description ?? null, d.mfaRequise]);
    await ecrirePermissions(ctx.c, r.id, perms, ctx.utilisateur.id);
    await ctx.journaliser({ type: "roles", action: "create", objetType: "role", objetId: r.id,
      apres: { cle: d.cle, libelle: d.libelle, mfaRequise: d.mfaRequise, permissions: perms }, details: d.copierDe ? { copieDe: d.copierDe } : undefined });
    return vue(await chargerRole(ctx.c, r.id));
  }));

  app.patch("/api/roles/:id", proteger(deps, { permission: "roles.update" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ libelle: z.string().trim().min(3).max(80).optional(), description: z.string().trim().max(300).nullable().optional(), mfaRequise: z.boolean().optional() }).parse(req.body);
    const avant = await chargerRole(ctx.c, id);
    if (avant.is_system_role) throw new ErreurHttp(409, "role_systeme", "Les rôles système ne sont pas modifiables. Créez un rôle personnalisé à partir de celui-ci.");
    if (d.mfaRequise === false && avant.mfa_required) exiger(ctx, "roles.admin");
    await ctx.c.query(
      `UPDATE roles SET display_name = coalesce($2, display_name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              mfa_required = coalesce($5, mfa_required) WHERE id = $1`,
      [id, d.libelle ?? null, d.description !== undefined, d.description ?? null, d.mfaRequise ?? null]);
    const apres = await chargerRole(ctx.c, id);
    await ctx.journaliser({ type: "roles", action: "update", objetType: "role", objetId: id,
      avant: { libelle: avant.display_name, description: avant.description, mfaRequise: avant.mfa_required },
      apres: { libelle: apres.display_name, description: apres.description, mfaRequise: apres.mfa_required } });
    return vue(apres);
  }));

  // Changement de permissions : interdit sur les rôles système et sur un rôle que l'on détient soi-même.
  app.put("/api/roles/:id/permissions", proteger(deps, { permission: "roles.admin", sensible: true }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ permissions: listePermissions, motif }).parse(req.body);
    const avant = await chargerRole(ctx.c, id);
    if (avant.is_system_role) throw new ErreurHttp(409, "role_systeme", "Les permissions d'un rôle système ne sont pas modifiables.");
    if (avant.archived_at) throw new ErreurHttp(409, "role_archive", "Ce rôle est archivé.");
    const detenu = await ctx.c.query("SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2", [ctx.utilisateur.id, id]);
    if (detenu.rowCount)
      throw new ErreurHttp(403, "auto_attribution_interdite", "Vous ne pouvez pas modifier les permissions d'un rôle que vous détenez.",
        { type: "security", action: "self_change_denied", resultat: "denied", objetType: "role", objetId: id, details: { tentative: "permissions_role_detenu" } });
    await verifierPermissionsConnues(ctx.c, d.permissions);
    await ecrirePermissions(ctx.c, id, [...new Set(d.permissions)], ctx.utilisateur.id);
    const apres = await chargerRole(ctx.c, id);
    const ajoutees = apres.permissions.filter((p: string) => !avant.permissions.includes(p));
    const retirees = avant.permissions.filter((p: string) => !apres.permissions.includes(p));
    await ctx.journaliser({ type: "roles", action: "permissions_change", objetType: "role", objetId: id, motif: d.motif,
      avant: avant.permissions, apres: apres.permissions, details: { ajoutees, retirees } });
    return vue(apres);
  }));

  app.post("/api/roles/:id/archivage", proteger(deps, { permission: "roles.archive" }, async (req, ctx) => {
    const id = idParam(req);
    const d = z.object({ motif }).parse(req.body);
    const r = await chargerRole(ctx.c, id);
    if (r.is_system_role) throw new ErreurHttp(409, "role_systeme", "Un rôle système ne peut pas être archivé.");
    if (r.archived_at) throw new ErreurHttp(409, "deja_archive", "Ce rôle est déjà archivé.");
    if (r.utilisateurs > 0) throw new ErreurHttp(409, "role_utilise", `Ce rôle est encore attribué à ${r.utilisateurs} utilisateur(s). Retirez-le d'abord.`);
    await ctx.c.query("UPDATE roles SET archived_at = now() WHERE id = $1", [id]);
    await ctx.journaliser({ type: "roles", action: "archive", objetType: "role", objetId: id, motif: d.motif });
    return vue(await chargerRole(ctx.c, id));
  }));
}
