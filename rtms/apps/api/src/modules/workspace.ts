/**
 * Routes au service de l'espace de travail : historique d'un enregistrement,
 * recherche globale, notifications métier et activité récente.
 * Toutes respectent les permissions de lecture de chaque module et la RLS.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTenant } from '../db.js';
import { notFound } from '../errors.js';
import { requirePermission, requireSession } from '../security/guard.js';
import { MODULES, permKey, type ModuleKey } from '../security/permissions.js';
import { MODULE_DEFS, isModule } from './definitions.js';

const SENSITIVE = new Map(Object.values(MODULE_DEFS).map((m) => [m.key, new Set(m.fields.filter((f) => f.sensitive).map((f) => f.name))]));

/** Libellé lisible d'un enregistrement pour les listes de résultats. */
export function labelOf(module: ModuleKey, data: Record<string, unknown>): { title: string; subtitle: string } {
  const d = (k: string) => (typeof data[k] === 'string' || typeof data[k] === 'number' ? String(data[k]) : '');
  switch (module) {
    case 'transport': return { title: d('Référence mission'), subtitle: `${d('Client')} · ${d('Départ')} → ${d('Destination')}` };
    case 'transit': return { title: d('Référence dossier'), subtitle: `${d('Client')} · ${d('Type de procédure')}` };
    case 'importexport': return { title: d('Référence'), subtitle: `${d('Type (Import/Export)')} · ${d('Client / fournisseur')}` };
    case 'commerce': return { title: `${d('Code article')} — ${d('Désignation')}`, subtitle: `Stock : ${d('Quantité en stock')} ${d('Unité')}` };
    case 'clients': return { title: d('Nom / raison sociale'), subtitle: `${d('Type (Client/Fournisseur)')} · ${d('Téléphone')}` };
    case 'fleet': return { title: d('Immatriculation'), subtitle: `${d('Marque / modèle')} · ${d('Statut')}` };
    case 'staff': return { title: d('Nom complet'), subtitle: `${d('Matricule')} · ${d('Fonction')}` };
    case 'maintenance': return { title: `${d('Véhicule')} — ${d('Type d’intervention')}`, subtitle: d('Date') };
    case 'invoices': return { title: d('Numéro de facture'), subtitle: `${d('Client')} · ${d('Statut')}` };
    case 'finance': return { title: d('Libellé'), subtitle: `${d('Type (Recette/Dépense)')} · ${d('Montant (FCFA)')} FCFA` };
    case 'documents': return { title: `${d('Référence')} — ${d('Intitulé')}`, subtitle: d('Catégorie') };
  }
}

interface Notice { module: ModuleKey; id: string; reference: string | null; level: 'warning' | 'danger'; message: string; due: string | null }

export function workspaceRoutes(app: FastifyInstance, ctx: AppContext) {
  const tenant = (req: FastifyRequest) => ({ companyId: req.session!.companyId, userId: req.session!.userId });
  const readable = (req: FastifyRequest) => MODULES.filter((m) => req.perms!.has(permKey(m, 'read')));

  // ---------- Historique d'un enregistrement (panneau « Historique ») ----------
  app.get('/api/records/:module/:id/history', {
    preHandler: requirePermission(ctx, (req) => {
      const m = (req.params as { module?: string }).module ?? '';
      if (!isModule(m)) throw notFound('Module inconnu');
      return m;
    }, 'read'),
  }, async (req) => {
    const { module, id } = z.object({ module: z.string(), id: z.string().uuid() }).parse(req.params);
    const hidden = SENSITIVE.get(module as ModuleKey) ?? new Set<string>();
    const rows = await withTenant(ctx.prisma, tenant(req), (tx) => tx.$queryRaw<{ id: bigint; action: string; at: Date; before: Prisma.JsonValue; after: Prisma.JsonValue; user: string | null }[]>`
      SELECT a.id, a.action, a.at, a.before, a.after, u.full_name AS "user"
        FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity = ${module} AND a.entity_id = ${id}
       ORDER BY a.id DESC LIMIT 100`);
    return rows.map((r) => {
      const before = (r.before ?? {}) as Record<string, unknown>;
      const after = (r.after ?? {}) as Record<string, unknown>;
      const changes = r.action === 'record.update'
        ? [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
          .map((k) => (hidden.has(k) ? { field: k, from: '••••', to: '••••' } : { field: k, from: before[k] ?? null, to: after[k] ?? null }))
        : [];
      return { id: r.id.toString(), action: r.action, at: r.at, user: r.user, changes, reason: r.action === 'record.cancel' ? (after.reason ?? null) : null };
    });
  });

  // ---------- Recherche globale (barre supérieure, Ctrl+K) ----------
  app.get('/api/search', { preHandler: requireSession(ctx) }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
    const modules = readable(req);
    if (!modules.length) return { query: q, groups: [] };
    const pattern = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await withTenant(ctx.prisma, tenant(req), (tx) => tx.$queryRaw<{ id: string; module: ModuleKey; reference: string | null; data: Record<string, unknown> }[]>`
      SELECT id, module, reference, data FROM (
        SELECT id, module, reference, data,
               row_number() OVER (PARTITION BY module, CASE WHEN module IN ('clients','importexport') THEN data->>'Type (Client/Fournisseur)' || coalesce(data->>'Type (Import/Export)','') END ORDER BY created_at DESC) AS n
          FROM records
         WHERE company_id = ${req.session!.companyId}::uuid AND cancelled_at IS NULL
           AND module = ANY(${modules}::text[]) AND search_text LIKE ${pattern}) t
       WHERE n <= 6`);
    const groups = new Map<string, { key: string; module: ModuleKey; label: string; items: unknown[] }>();
    const LABELS: Record<string, string> = {
      transport: 'Missions', transit: 'Dossiers de transit', 'importexport:Import': 'Importations', 'importexport:Export': 'Exportations',
      commerce: 'Articles', 'clients:Client': 'Clients', 'clients:Fournisseur': 'Fournisseurs', fleet: 'Véhicules', staff: 'Personnel',
      maintenance: 'Maintenance', invoices: 'Factures', finance: 'Mouvements financiers', documents: 'Documents',
    };
    for (const r of rows) {
      const sub = r.module === 'clients' ? r.data['Type (Client/Fournisseur)'] : r.module === 'importexport' ? r.data['Type (Import/Export)'] : null;
      const key = sub ? `${r.module}:${String(sub)}` : r.module;
      if (!groups.has(key)) groups.set(key, { key, module: r.module, label: LABELS[key] ?? LABELS[r.module] ?? r.module, items: [] });
      const clean = Object.fromEntries(Object.entries(r.data).filter(([k]) => !SENSITIVE.get(r.module)?.has(k)));
      groups.get(key)!.items.push({ id: r.id, reference: r.reference, ...labelOf(r.module, clean) });
    }
    return { query: q, groups: [...groups.values()] };
  });

  // ---------- Notifications métier (échéances, seuils) ----------
  app.get('/api/notifications', { preHandler: requireSession(ctx) }, async (req) => {
    const can = new Set(readable(req));
    const gen = (await ctx.redis.get(`gen:${req.session!.companyId}`)) ?? '0';
    const day = new Date().toISOString().slice(0, 10);
    const key = `notif:${req.session!.companyId}:${gen}:${day}`;
    let all: Notice[];
    const hit = await ctx.redis.get(key);
    if (hit) all = JSON.parse(hit) as Notice[];
    else {
      all = await withTenant(ctx.prisma, tenant(req), (tx) => tx.$queryRaw<Notice[]>`
        WITH r AS (SELECT * FROM records WHERE company_id = ${req.session!.companyId}::uuid AND cancelled_at IS NULL)
        SELECT 'fleet' AS module, id, reference,
               CASE WHEN rtms_date(data->>'Assurance valide jusqu’au') < current_date THEN 'danger' ELSE 'warning' END AS level,
               'Assurance ' || CASE WHEN rtms_date(data->>'Assurance valide jusqu’au') < current_date THEN 'expirée' ELSE 'à renouveler' END || ' — ' || coalesce(reference, '') AS message,
               data->>'Assurance valide jusqu’au' AS due
          FROM r WHERE module = 'fleet' AND rtms_date(data->>'Assurance valide jusqu’au') <= current_date + 30
        UNION ALL
        SELECT 'documents', id, reference,
               CASE WHEN rtms_date(data->>'Date d’expiration') < current_date THEN 'danger' ELSE 'warning' END,
               'Document ' || CASE WHEN rtms_date(data->>'Date d’expiration') < current_date THEN 'expiré' ELSE 'bientôt expiré' END || ' — ' || coalesce(data->>'Intitulé', reference, ''),
               data->>'Date d’expiration'
          FROM r WHERE module = 'documents' AND rtms_date(data->>'Date d’expiration') <= current_date + 30
        UNION ALL
        SELECT 'invoices', id, reference, 'danger',
               'Facture échue — ' || coalesce(reference, '') || ' (' || coalesce(data->>'Client', '') || ')',
               data->>'Échéance'
          FROM r WHERE module = 'invoices' AND rtms_date(data->>'Échéance') < current_date
                   AND coalesce(status, '') NOT IN ('Payée', 'Annulée')
        UNION ALL
        SELECT 'commerce', id, reference, 'warning',
               'Stock sous le seuil — ' || coalesce(data->>'Désignation', reference, ''), NULL
          FROM r WHERE module = 'commerce' AND rtms_num(data->>'Quantité en stock') <= rtms_num(data->>'Stock minimum')
        UNION ALL
        SELECT 'maintenance', id, reference, 'warning',
               'Entretien à prévoir — ' || coalesce(data->>'Véhicule', ''), data->>'Prochain entretien'
          FROM r WHERE module = 'maintenance' AND rtms_date(data->>'Prochain entretien') <= current_date + 15
        ORDER BY due NULLS LAST
        LIMIT 200`);
      await ctx.redis.set(key, JSON.stringify(all), 'EX', 600);
    }
    const items = all.filter((n) => can.has(n.module));
    const counts: Record<string, number> = {};
    for (const n of items) counts[n.module] = (counts[n.module] ?? 0) + 1;
    return { items, counts };
  });

  // ---------- Activité récente de l'utilisateur ----------
  app.get('/api/activity', { preHandler: requireSession(ctx) }, async (req) => {
    const rows = await withTenant(ctx.prisma, tenant(req), (tx) => tx.$queryRaw<{ id: bigint; action: string; entity: string; entityId: string | null; at: Date; reference: string | null }[]>`
      SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.at, r.reference
        FROM audit_log a LEFT JOIN records r ON r.id::text = a.entity_id
       WHERE a.user_id = ${req.session!.userId}::uuid AND a.action LIKE 'record.%'
       ORDER BY a.id DESC LIMIT 30`);
    const can = new Set(readable(req));
    return rows.filter((r) => can.has(r.entity as ModuleKey)).map((r) => ({ ...r, id: r.id.toString() }));
  });
}
