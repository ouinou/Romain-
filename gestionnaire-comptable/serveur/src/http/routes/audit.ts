import type { FastifyInstance } from "fastify";
import { UUID, type Client } from "../../db.js";
import { verifierIntegrite } from "../../domaine/audit.js";
import { pagination, proteger, type Dependances } from "../contexte.js";
import { ErreurHttp } from "../erreurs.js";

const RESULTATS = ["success", "denied", "failure"];

/** Filtres communs à la consultation et à l'export. */
function filtres(q: Record<string, string | undefined>) {
  const f: string[] = [], v: unknown[] = [];
  const ajouter = (sql: string, val: unknown) => { v.push(val); f.push(sql.replace("?", `$${v.length}`)); };
  if (q.type) ajouter("a.event_type = ?", q.type);
  if (q.action) ajouter("a.action = ?", q.action);
  if (q.resultat && RESULTATS.includes(q.resultat)) ajouter("a.outcome = ?", q.resultat);
  if (q.utilisateur && UUID.test(q.utilisateur)) ajouter("a.actor_user_id = ?", q.utilisateur);
  if (q.du && !Number.isNaN(Date.parse(q.du))) ajouter("a.occurred_at >= ?", q.du);
  if (q.au && !Number.isNaN(Date.parse(q.au))) ajouter("a.occurred_at < ?::timestamptz + interval '1 day'", q.au);
  if (q.recherche) {
    v.push(`%${q.recherche.trim()}%`);
    const n = `$${v.length}`;
    f.push(`(a.action ILIKE ${n} OR a.object_id ILIKE ${n} OR a.reason ILIKE ${n} OR a.event_details::text ILIKE ${n})`);
  }
  return { where: f.length ? "WHERE " + f.join(" AND ") : "", valeurs: v };
}

async function lister(c: Client, where: string, valeurs: unknown[], limite: number, offset: number) {
  const { rows } = await c.query(
    `SELECT a.sequence_no, a.event_uuid, a.occurred_at, a.event_type, a.action, a.outcome, a.object_type, a.object_id,
            a.previous_value, a.new_value, a.reason, a.event_details, host(a.ip_address) AS ip, a.session_id, a.event_hash,
            a.actor_user_id, u.full_name AS acteur
       FROM audit_events a LEFT JOIN app_users u ON u.id = a.actor_user_id
       ${where} ORDER BY a.sequence_no DESC LIMIT ${limite} OFFSET ${offset}`, valeurs);
  return rows.map((r) => ({
    sequence: Number(r.sequence_no), id: r.event_uuid, date: r.occurred_at, type: r.event_type, action: r.action, resultat: r.outcome,
    objetType: r.object_type, objetId: r.object_id, avant: r.previous_value, apres: r.new_value, motif: r.reason, details: r.event_details,
    ip: r.ip, sessionId: r.session_id, empreinte: r.event_hash, acteurId: r.actor_user_id, acteur: r.acteur ?? (r.actor_user_id ? null : "Système"),
  }));
}

const csv = (v: unknown) => `"${(v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/"/g, '""')}"`;

export function routesAudit(app: FastifyInstance, deps: Dependances) {
  app.get("/api/audit", proteger(deps, { permission: "audit.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { page, taille, offset } = pagination(q);
    const { where, valeurs } = filtres(q);
    const { rows: [{ total }] } = await ctx.c.query(`SELECT count(*)::int AS total FROM audit_events a ${where}`, valeurs);
    return { elements: await lister(ctx.c, where, valeurs, taille, offset), total, page, taille };
  }));

  app.get("/api/audit/integrite", proteger(deps, { permission: "audit.read" }, async (_req, ctx) => {
    const r = await verifierIntegrite(ctx.c, ctx.entrepriseId);
    await ctx.journaliser({ type: "audit", action: "verify", resultat: r.valide ? "success" : "failure",
      details: { anomalies: r.anomalies.length, derniereSequence: r.derniereSequence } });
    return r;
  }));

  // Export CSV (séparateur « ; », compatible Excel en français). L'export lui-même est journalisé.
  app.get("/api/audit/export", proteger(deps, { permission: "audit.export", sensible: true }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { where, valeurs } = filtres(q);
    const lignes = await lister(ctx.c, where, valeurs, 50_000, 0);
    await ctx.journaliser({ type: "audit", action: "export", details: { lignes: lignes.length, filtres: q } });
    const entete = ["Séquence", "Date (UTC)", "Utilisateur", "Type", "Action", "Résultat", "Objet", "Identifiant objet", "Avant", "Après", "Motif", "Détails", "Adresse IP", "Empreinte"];
    const corps = lignes.map((l) => [l.sequence, new Date(l.date).toISOString(), l.acteur ?? l.acteurId, l.type, l.action, l.resultat, l.objetType, l.objetId, l.avant, l.apres, l.motif, l.details, l.ip, l.empreinte].map(csv).join(";"));
    ctx.rep.header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="journal-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    return "﻿" + [entete.map(csv).join(";"), ...corps].join("\r\n");
  }));

  // Toute tentative de modification ou de suppression du journal par l'API est refusée et journalisée.
  const tentative = proteger(deps, { permission: null }, async (req, ctx) => {
    throw new ErreurHttp(403, "journal_non_modifiable", "Le journal d'audit ne peut être ni modifié ni supprimé.",
      { type: "security", action: "audit_tamper_attempt", resultat: "denied", details: { methode: req.method, url: req.url } });
  });
  for (const url of ["/api/audit", "/api/audit/*"])
    app.route({ method: ["POST", "PUT", "PATCH", "DELETE"], url, handler: tentative });
}
