import type { FastifyInstance } from "fastify";
import { UUID } from "../../db.js";
import { pagination, proteger, type Ctx, type Dependances } from "../contexte.js";
import { nonTrouve } from "../erreurs.js";

/** Notifications adressées à l'utilisateur, ou à toute personne disposant de la permission requise. */
const visibles = (ctx: Ctx) => ({
  sql: "(n.recipient_user_id = $1 OR n.required_permission = ANY($2::text[]))",
  valeurs: [ctx.utilisateur.id, [...ctx.permissions]],
});

export function routesNotifications(app: FastifyInstance, deps: Dependances) {
  app.get("/api/notifications", proteger(deps, { permission: null, avantMfa: true }, async (req, ctx) => {
    const { page, taille, offset } = pagination(req.query as Record<string, string>);
    const v = visibles(ctx);
    const { rows } = await ctx.c.query(
      `SELECT n.id, n.kind, n.title, n.body, n.created_at, r.read_at
         FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
        WHERE ${v.sql} ORDER BY n.created_at DESC LIMIT ${taille} OFFSET ${offset}`, v.valeurs);
    const { rows: [{ non_lues }] } = await ctx.c.query(
      `SELECT count(*)::int AS non_lues FROM notifications n
        WHERE ${v.sql} AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = $1)`, v.valeurs);
    return { elements: rows.map((n) => ({ id: n.id, type: n.kind, titre: n.title, texte: n.body, date: n.created_at, lue: !!n.read_at })), nonLues: non_lues, page, taille };
  }));

  app.post("/api/notifications/:id/lecture", proteger(deps, { permission: null, avantMfa: true }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw nonTrouve("Notification");
    const v = visibles(ctx);
    const { rowCount } = await ctx.c.query(`SELECT 1 FROM notifications n WHERE n.id = $3 AND ${v.sql}`, [...v.valeurs, id]);
    if (!rowCount) throw nonTrouve("Notification");
    await ctx.c.query("INSERT INTO notification_reads (notification_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, ctx.utilisateur.id]);
    return { ok: true };
  }));
}
