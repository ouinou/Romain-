// MODE DÉMONSTRATION — serveur simulé dans le navigateur.
// Il imite les routes de l'API RTMS pour présenter l'interface sans serveur.
// Données fictives, conservées dans ce navigateur uniquement. AUCUNE sécurité :
// ne jamais y saisir de données réelles. L'application réelle utilise l'API sécurisée.
import { DEFS, MATRIX, ROLES, ACTIONS, RESOURCES } from './defs.js';
import { seedRecords } from './seed.js';

const KEY = 'rtms.demo.db.v1';
// Démonstration uniquement : aucun compte réel n'est créé
const DEMO_TEMP_PASS = 'demo (fictif)';
const VERSION = '2.2.0';
const LOCKED = new Set(['Validé', 'Validée', 'Clôturé', 'Payée']);
const defOf = (m) => DEFS.find((d) => d.key === m);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

let db = null;
function load() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db) db = freshDb();
  return db;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* stockage indisponible : la démo reste en mémoire */ } }
function freshDb() {
  const userId = uuid();
  const d = {
    session: false,
    users: [{ id: userId, email: 'demo@raha-transport.cm', fullName: 'Administrateur (démo)', roleKey: 'admin', status: 'active', mfaEnabled: false, lastLoginAt: null, lockedUntil: null }],
    settings: { name: 'RAHA TRANSPORT', phone: '', email: '', address: '', rccm: '', taxId: '', currency: 'FCFA', language: 'Français' },
    grants: Object.entries(MATRIX).flatMap(([r, mtx]) => Object.entries(mtx).flatMap(([res, acts]) => (acts || []).map((a) => `${r}:${res}:${a}`))),
    records: [],
    audit: [],
    seq: 1,
  };
  db = d;
  seedRecords().forEach(([module, data, status], i) => insert(module, data, userId, status, i));
  save();
  return d;
}
export function resetDemo() { try { localStorage.removeItem(KEY); } catch { /* ignoré */ } db = null; load(); }

// ---------------------------------------------------------------- calculs (identiques au serveur)
const r2 = (x) => Math.round(x * 100) / 100;
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function below100(n) {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) { const t = Math.floor(n / 10), u = n % 10; return u === 0 ? TENS[t] : u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`; }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${below100(n - 60)}`;
  if (n === 80) return 'quatre-vingts';
  return `quatre-vingt-${below100(n - 80)}`;
}
function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const head = h === 0 ? '' : h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
  return [head, r ? below100(r) : ''].filter(Boolean).join(' ');
}
function words(amount) {
  const n = Math.round(Math.abs(amount));
  if (n === 0) return 'zéro francs CFA';
  const parts = [];
  let rest = n;
  for (const [v, one, many] of [[1e9, 'milliard', 'milliards'], [1e6, 'million', 'millions']]) {
    const q = Math.floor(rest / v);
    if (q) { parts.push(`${below1000(q)} ${q > 1 ? many : one}`); rest %= v; }
  }
  const k = Math.floor(rest / 1000);
  if (k) { parts.push(k === 1 ? 'mille' : `${below1000(k).replace(/cents$/, 'cent')} mille`); rest %= 1000; }
  if (rest) parts.push(below1000(rest));
  return `${parts.join(' ')} francs CFA`;
}
function lines(d) {
  if (Array.isArray(d.Lignes) && d.Lignes.length) return d.Lignes;
  if (d['Désignation'] !== undefined) return [{ 'Désignation': d['Désignation'], 'Quantité': d['Quantité'], 'Prix unitaire (FCFA)': d['Prix unitaire (FCFA)'] }];
  return [];
}
function compute(m, d) {
  if (m !== 'invoices') return {};
  const ht = r2(lines(d).reduce((s, l) => s + Number(l['Quantité'] || 0) * Number(l['Prix unitaire (FCFA)'] || 0), 0));
  const tax = r2((ht * Number(d['Taxe (%)'] || 0)) / 100);
  const ttc = r2(ht + tax);
  const avance = r2(Number(d['Avance (FCFA)'] || 0));
  return { totalHT: ht, tax, totalTTC: ttc, avance, reste: r2(ttc - avance), totalEnLettres: words(ttc), lines: lines(d).length };
}

// ---------------------------------------------------------------- validation (règles principales du serveur)
class HttpErr extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; } }
function validate(m, input, { partial = false } = {}) {
  const def = defOf(m);
  const out = {};
  const errors = [];
  for (const k of Object.keys(input || {})) if (!def.fields.find((f) => f.name === k)) errors.push(`${k} : champ inconnu`);
  for (const f of def.fields) {
    let v = input?.[f.name];
    if (v === '' || v === null) v = undefined;
    if (v === undefined) { if (f.required && !partial) errors.push(`${f.name} : champ obligatoire`); continue; }
    if (f.type === 'number') { const n = Number(v); if (!Number.isFinite(n)) errors.push(`${f.name} : nombre attendu`); else if (f.min != null && n < f.min) errors.push(`${f.name} : valeur minimale ${f.min}`); else if (f.max != null && n > f.max) errors.push(`${f.name} : valeur maximale ${f.max}`); else out[f.name] = n; }
    else if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors.push(`${f.name} : date AAAA-MM-JJ attendue`); else out[f.name] = String(v); }
    else if (f.type === 'enum') { if (!f.options.includes(v)) errors.push(`${f.name} : valeur non autorisée`); else out[f.name] = v; }
    else if (f.type === 'lines') {
      if (!Array.isArray(v)) { errors.push('Lignes : format invalide'); continue; }
      out[f.name] = v.map((l, i) => {
        const q = Number(l['Quantité']), p = Number(l['Prix unitaire (FCFA)']);
        if (!String(l['Désignation'] || '').trim()) errors.push(`Lignes : désignation obligatoire (ligne ${i + 1})`);
        if (!(q > 0)) errors.push(`Lignes : quantité supérieure à 0 (ligne ${i + 1})`);
        if (!(p >= 0)) errors.push(`Lignes : prix unitaire positif (ligne ${i + 1})`);
        return { 'Désignation': String(l['Désignation'] || '').trim(), 'Quantité': q, 'Prix unitaire (FCFA)': p };
      });
    } else { const s = String(v).trim(); if (f.required && !s) errors.push(`${f.name} : champ obligatoire`); else out[f.name] = s; }
  }
  if (!partial && m === 'invoices') {
    const has = (Array.isArray(out.Lignes) && out.Lignes.length) || (out['Désignation'] !== undefined && out['Quantité'] !== undefined && out['Prix unitaire (FCFA)'] !== undefined);
    if (!has) errors.push('Lignes : au moins une ligne de facture (désignation, quantité, prix unitaire) est obligatoire');
    if (Number(out['Avance (FCFA)'] || 0) > compute('invoices', out).totalTTC) errors.push('Avance (FCFA) : supérieure au total de la facture');
  }
  if (errors.length) throw new HttpErr(400, 'requete_invalide', 'Formulaire incomplet ou invalide', errors);
  return out;
}

// ---------------------------------------------------------------- stockage
function audit(action, entity, entityId, before, after) {
  db.audit.unshift({ id: String(db.seq++), userId: db.users[0].id, user: db.users[0].fullName, action, entity, entityId, before, after, at: new Date().toISOString(), ip: '127.0.0.1', hash: 'démo' });
  db.audit = db.audit.slice(0, 2000);
}
function refOf(m, d) { const f = defOf(m).referenceField; const v = f ? d[f] : undefined; return typeof v === 'string' && v.trim() ? v.trim() : null; }
function statusOf(m, d) { const f = defOf(m).statusField; return f ? d[f] ?? null : null; }
function checkUnique(m, ref, exceptId) {
  if (ref && db.records.some((r) => r.module === m && !r.cancelledAt && r.id !== exceptId && (r.reference || '').toLowerCase() === ref.toLowerCase())) {
    throw new HttpErr(409, 'conflit', `${defOf(m).referenceField} déjà utilisée`);
  }
}
function insert(m, data, userId, status, silent = false) {
  const ref = refOf(m, data);
  checkUnique(m, ref);
  // Données d'exemple : la première est la plus récente
  const now = new Date(Date.now() - (silent === false ? 0 : (Number(silent) + 1) * 3600000)).toISOString();
  const r = { id: uuid(), module: m, reference: ref, status: status ?? statusOf(m, data), data, computed: compute(m, data), version: 1, createdAt: now, updatedAt: now, createdBy: userId, cancelledAt: null };
  db.records.push(r);
  if (silent === false) audit('record.create', m, r.id, null, data);
  return r;
}
const pub = (r) => ({ id: r.id, version: r.version, reference: r.reference, status: r.status, data: r.data, computed: r.computed, createdAt: r.createdAt, updatedAt: r.updatedAt });
const active = (m) => db.records.filter((r) => r.module === m && !r.cancelledAt);

function applyFilters(m, rows, q, f) {
  const def = defOf(m);
  if (q) { const s = q.toLowerCase(); rows = rows.filter((r) => JSON.stringify(Object.values(r.data)).toLowerCase().includes(s)); }
  for (const [k, v] of Object.entries(f || {})) {
    const fd = def.fields.find((x) => x.name === k);
    if (!fd || !fd.filterable) throw new HttpErr(400, 'requete_invalide', `Champ « ${k} » non triable ou non filtrable`);
    if (v && typeof v === 'object') {
      const num = fd.type === 'number';
      rows = rows.filter((r) => {
        const x = r.data[k];
        if (x === undefined || x === null || x === '') return false;
        const val = num ? Number(x) : String(x);
        if (v.from !== undefined && v.from !== '' && val < (num ? Number(v.from) : String(v.from))) return false;
        if (v.to !== undefined && v.to !== '' && val > (num ? Number(v.to) : String(v.to))) return false;
        return true;
      });
    } else if (v !== '') {
      rows = fd.type === 'enum' ? rows.filter((r) => r.data[k] === v) : rows.filter((r) => String(r.data[k] ?? '').toLowerCase().includes(String(v).toLowerCase()));
    }
  }
  return rows;
}
function sortRows(m, rows, sort, dir) {
  const def = defOf(m);
  const key = (r) => {
    if (!sort || sort === 'createdAt') return r.createdAt;
    if (sort === 'reference') return (r.reference || '').toLowerCase();
    if (sort === 'status') return r.status || '';
    if (sort === 'totalTTC') return r.computed?.totalTTC ?? null;
    const fd = def.fields.find((x) => x.name === sort);
    if (!fd) throw new HttpErr(400, 'requete_invalide', 'Champ non triable');
    const v = r.data[sort];
    return v === undefined || v === '' ? null : fd.type === 'number' ? Number(v) : String(v).toLowerCase();
  };
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(a), y = key(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? -mul : x > y ? mul : 0;
  });
}

function me() {
  const u = db.users[0];
  const perms = db.grants.filter((g) => g.startsWith(`${u.roleKey}:`)).map((g) => g.slice(u.roleKey.length + 1));
  return { user: { id: u.id, fullName: u.fullName, role: u.roleKey, roleLabel: ROLES[u.roleKey] }, state: 'active', csrfToken: 'demo', permissions: perms, license: { state: 'unconfigured', enforcement: 'off', reason: 'Mode démonstration' }, instance: 'DÉMO', version: VERSION };
}

const LABELS = { transport: 'Missions', transit: 'Dossiers de transit', 'importexport:Import': 'Importations', 'importexport:Export': 'Exportations', commerce: 'Articles', 'clients:Client': 'Clients', 'clients:Fournisseur': 'Fournisseurs', fleet: 'Véhicules', staff: 'Personnel', maintenance: 'Maintenance', invoices: 'Factures', finance: 'Mouvements financiers', documents: 'Documents' };
function labelOf(m, d) {
  const g = (k) => (d[k] === undefined ? '' : String(d[k]));
  const map = {
    transport: [g('Référence mission'), `${g('Client')} · ${g('Départ')} → ${g('Destination')}`], transit: [g('Référence dossier'), g('Client')],
    importexport: [g('Référence'), `${g('Type (Import/Export)')} · ${g('Client / fournisseur')}`], commerce: [`${g('Code article')} — ${g('Désignation')}`, ''],
    clients: [g('Nom / raison sociale'), g('Téléphone')], fleet: [g('Immatriculation'), g('Marque / modèle')], staff: [g('Nom complet'), g('Fonction')],
    maintenance: [`${g('Véhicule')} — ${g('Type d’intervention')}`, g('Date')], invoices: [g('Numéro de facture'), `${g('Client')} · ${g('Statut')}`],
    finance: [g('Libellé'), `${g('Montant (FCFA)')} FCFA`], documents: [`${g('Référence')} — ${g('Intitulé')}`, g('Catégorie')],
  };
  const [title, subtitle] = map[m];
  return { title, subtitle };
}
function notifications() {
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const in15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const items = [];
  for (const r of db.records.filter((x) => !x.cancelledAt)) {
    const d = r.data;
    if (r.module === 'fleet' && d['Assurance valide jusqu’au'] && d['Assurance valide jusqu’au'] <= in30) items.push({ module: 'fleet', id: r.id, reference: r.reference, level: d['Assurance valide jusqu’au'] < today ? 'danger' : 'warning', message: `Assurance ${d['Assurance valide jusqu’au'] < today ? 'expirée' : 'à renouveler'} — ${r.reference}`, due: d['Assurance valide jusqu’au'] });
    if (r.module === 'documents' && d['Date d’expiration'] && d['Date d’expiration'] <= in30) items.push({ module: 'documents', id: r.id, reference: r.reference, level: d['Date d’expiration'] < today ? 'danger' : 'warning', message: `Document ${d['Date d’expiration'] < today ? 'expiré' : 'bientôt expiré'} — ${d['Intitulé'] || r.reference}`, due: d['Date d’expiration'] });
    if (r.module === 'invoices' && d['Échéance'] && d['Échéance'] < today && !['Payée', 'Annulée'].includes(r.status)) items.push({ module: 'invoices', id: r.id, reference: r.reference, level: 'danger', message: `Facture échue — ${r.reference} (${d.Client || ''})`, due: d['Échéance'] });
    if (r.module === 'commerce' && d['Quantité en stock'] !== undefined && d['Stock minimum'] !== undefined && Number(d['Quantité en stock']) <= Number(d['Stock minimum'])) items.push({ module: 'commerce', id: r.id, reference: r.reference, level: 'warning', message: `Stock sous le seuil — ${d['Désignation'] || r.reference}`, due: null });
    if (r.module === 'maintenance' && d['Prochain entretien'] && d['Prochain entretien'] <= in15) items.push({ module: 'maintenance', id: r.id, reference: r.reference, level: 'warning', message: `Entretien à prévoir — ${d['Véhicule'] || ''}`, due: d['Prochain entretien'] });
  }
  items.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
  const counts = {};
  for (const n of items) counts[n.module] = (counts[n.module] || 0) + 1;
  return { items, counts };
}
function stats() {
  const counts = {};
  let rec = 0, dep = 0;
  for (const r of db.records.filter((x) => !x.cancelledAt)) {
    counts[r.module] = (counts[r.module] || 0) + 1;
    if (r.module === 'finance') { const v = Number(r.data['Montant (FCFA)'] || 0); if (r.data['Type (Recette/Dépense)'] === 'Recette') rec += v; else dep += v; }
  }
  return { counts, finance: { recettes: rec, depenses: dep, solde: rec - dep }, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- routeur
async function handle(method, path, query, body) {
  load();
  let m;
  if (path === '/api/auth/me' && method === 'GET') { if (!db.session) throw new HttpErr(401, 'non_authentifie', 'Authentification requise'); return me(); }
  if (path === '/api/auth/login') {
    if (!body?.password || body.password !== 'demo') throw new HttpErr(401, 'identifiants_invalides', 'Démonstration : utilisez le mot de passe « demo ».');
    db.session = true; db.users[0].lastLoginAt = new Date().toISOString(); save(); return me();
  }
  if (path === '/api/auth/logout') { db.session = false; save(); return { ok: true }; }
  if (!db.session) throw new HttpErr(401, 'non_authentifie', 'Authentification requise');
  if (path === '/api/auth/password') return { ok: true };
  if (path === '/api/modules') return DEFS;
  if (path === '/api/dashboard') { const s = stats(); return { counts: s.counts, finance: s.finance, generatedAt: s.generatedAt }; }
  if (path === '/api/reports/summary') return stats();
  if (path === '/api/notifications') return notifications();
  if (path === '/api/activity') {
    return db.audit.filter((a) => a.action.startsWith('record.')).slice(0, 30).map((a) => ({ id: a.id, action: a.action, entity: a.entity, entityId: a.entityId, at: a.at, reference: db.records.find((r) => r.id === a.entityId)?.reference || null }));
  }
  if (path === '/api/search') {
    const q = String(query.get('q') || '').trim().toLowerCase();
    if (q.length < 2) throw new HttpErr(400, 'requete_invalide', 'Requête invalide');
    const groups = new Map();
    for (const r of db.records.filter((x) => !x.cancelledAt && JSON.stringify(Object.values(x.data)).toLowerCase().includes(q))) {
      const sub = r.module === 'clients' ? r.data['Type (Client/Fournisseur)'] : r.module === 'importexport' ? r.data['Type (Import/Export)'] : null;
      const key = sub ? `${r.module}:${sub}` : r.module;
      if (!groups.has(key)) groups.set(key, { key, module: r.module, label: LABELS[key] || LABELS[r.module], items: [] });
      const g = groups.get(key);
      if (g.items.length < 6) g.items.push({ id: r.id, reference: r.reference, ...labelOf(r.module, r.data) });
    }
    return { query: q, groups: [...groups.values()] };
  }
  // ----- administration
  if (path === '/api/admin/settings') { if (method === 'PUT') { db.settings = { ...db.settings, ...body }; audit('settings.update', 'company', null, null, body); save(); return db.settings; } return db.settings; }
  if (path === '/api/admin/users' && method === 'GET') return db.users;
  if (path === '/api/admin/users' && method === 'POST') {
    if (db.users.some((u) => u.email === String(body.email).toLowerCase())) throw new HttpErr(409, 'conflit', 'E-mail déjà utilisé');
    const u = { id: uuid(), email: String(body.email).toLowerCase(), fullName: body.fullName, roleKey: body.roleKey, status: 'active', mfaEnabled: false, lastLoginAt: null, lockedUntil: null };
    db.users.push(u); audit('user.create', 'user', u.id, null, body); save();
    return { id: u.id, temporaryPassword: DEMO_TEMP_PASS };
  }
  if ((m = path.match(/^\/api\/admin\/users\/([^/]+)$/))) {
    const u = db.users.find((x) => x.id === m[1]);
    if (!u) throw new HttpErr(404, 'introuvable', 'Introuvable');
    if (body.roleKey) u.roleKey = body.roleKey;
    if (body.status) u.status = body.status;
    if (body.unlock) u.lockedUntil = null;
    if (body.resetMfa) u.mfaEnabled = false;
    audit('user.update', 'user', u.id, null, body); save(); return { ok: true };
  }
  if (path === '/api/admin/permissions') return { roles: ROLES, resources: RESOURCES, actions: ACTIONS, grants: db.grants };
  if ((m = path.match(/^\/api\/admin\/permissions\/([^/]+)$/))) {
    if (m[1] === 'admin') throw new HttpErr(400, 'requete_invalide', 'Les droits Administrateur ne sont pas modifiables (anti-verrouillage)');
    db.grants = [...db.grants.filter((g) => !g.startsWith(`${m[1]}:`)), ...body.grants.map((g) => `${m[1]}:${g}`)];
    audit('permissions.update', 'role', m[1], null, body.grants); save(); return { ok: true };
  }
  if (path === '/api/admin/audit') return db.audit.slice(0, Number(query.get('limit') || 100)).map(({ before, after, ...a }) => a);
  if (path === '/api/admin/audit/verify') return { intact: true, firstBrokenId: null };
  if (path === '/api/admin/license') return { state: 'unconfigured', enforcement: 'off', reason: 'Mode démonstration : pas de licence', installationId: 'démo' };
  if (path === '/api/admin/license/activate') throw new HttpErr(400, 'requete_invalide', 'L’activation de licence n’est pas disponible en démonstration.');
  if (path === '/api/admin/import-legacy') {
    const report = [];
    for (const [mod, rows] of Object.entries(body.data || {})) {
      if (!defOf(mod)) { report.push({ module: mod, imported: 0, skipped: rows.length, warnings: ['module inconnu'] }); continue; }
      let imported = 0, skipped = 0; const warnings = [];
      for (const raw of rows) { try { if (!body.dryRun) insert(mod, raw, db.users[0].id); imported++; } catch (e) { skipped++; warnings.push(e.message); } }
      report.push({ module: mod, imported, skipped, warnings });
    }
    save(); return { dryRun: !!body.dryRun, report };
  }
  // ----- enregistrements
  if ((m = path.match(/^\/api\/records\/([a-z]+)(?:\/(.+))?$/))) {
    const mod = m[1];
    const rest = m[2];
    if (!defOf(mod)) throw new HttpErr(404, 'introuvable', 'Module inconnu');
    const f = query.get('f') ? JSON.parse(query.get('f')) : {};
    if (!rest && method === 'GET') {
      const rows = sortRows(mod, applyFilters(mod, active(mod), String(query.get('q') || '').trim(), f), query.get('sort'), query.get('dir') || 'desc');
      const limit = Number(query.get('limit') || 50), offset = Number(query.get('offset') || 0);
      return { items: rows.slice(offset, offset + limit).map(pub), total: rows.length, limit, offset };
    }
    if (rest === 'stats') {
      const rows = applyFilters(mod, active(mod), String(query.get('q') || '').trim(), f);
      const byStatus = {};
      for (const r of rows) byStatus[r.status ?? ''] = (byStatus[r.status ?? ''] || 0) + 1;
      return { total: rows.length, byStatus };
    }
    if (rest === 'export.csv') {
      const fields = defOf(mod).fields.map((x) => x.name);
      const cell = (v) => { let s = Array.isArray(v) ? v.map((l) => Object.values(l).join(' × ')).join(' | ') : v === undefined || v === null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      return new Blob(['﻿' + [fields.map(cell).join(';'), ...active(mod).map((r) => fields.map((k) => cell(r.data[k])).join(';'))].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    }
    if (!rest && method === 'POST') {
      const data = validate(mod, body?.data);
      const st = statusOf(mod, data);
      const r = insert(mod, data, db.users[0].id, st);
      save(); return { __status: 201, ...pub(r) };
    }
    const [id, sub] = rest.split('/');
    const rec = db.records.find((r) => r.id === id && r.module === mod);
    if (!rec || (rec.cancelledAt && sub !== 'history')) throw new HttpErr(404, 'introuvable', 'Introuvable');
    if (!sub && method === 'GET') return pub(rec);
    if (sub === 'history') {
      return db.audit.filter((a) => a.entity === mod && a.entityId === id).map((a) => {
        const before = a.before || {}, after = a.after || {};
        const changes = a.action === 'record.update' ? [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => ({ field: k, from: before[k] ?? null, to: after[k] ?? null })) : [];
        return { id: a.id, action: a.action, at: a.at, user: a.user, changes, reason: a.action === 'record.cancel' ? after.reason : null };
      });
    }
    if (!sub && method === 'PATCH') {
      if (body.version !== rec.version) throw new HttpErr(409, 'conflit', 'Cet enregistrement a été modifié par un autre utilisateur. Rechargez avant de modifier.', { currentVersion: rec.version });
      const merged = { ...rec.data, ...body.data };
      for (const [k, v] of Object.entries(body.data)) if (v === '') delete merged[k];
      const data = validate(mod, merged);
      checkUnique(mod, refOf(mod, data), rec.id);
      const before = rec.data;
      Object.assign(rec, { data, reference: refOf(mod, data), status: statusOf(mod, data), computed: compute(mod, data), version: rec.version + 1, updatedAt: new Date().toISOString() });
      audit('record.update', mod, id, before, data); save(); return pub(rec);
    }
    if (sub === 'cancel') {
      rec.cancelledAt = new Date().toISOString(); rec.version += 1;
      audit('record.cancel', mod, id, rec.data, { reason: body?.reason || 'Annulé' }); save(); return { ok: true };
    }
  }
  throw new HttpErr(404, 'introuvable', `Route ${method} ${path} introuvable (démonstration)`);
}

/** Installe le serveur simulé : les appels /api/* ne quittent plus le navigateur. */
export function installDemoApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/') && !url.pathname.includes('/api/')) return realFetch(input, init);
    const path = url.pathname.slice(url.pathname.indexOf('/api/'));
    const method = (init.method || 'GET').toUpperCase();
    let body;
    try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
    await new Promise((r) => setTimeout(r, 40)); // léger délai, comme un vrai serveur
    try {
      const out = await handle(method, path, url.searchParams, body);
      if (out instanceof Blob) return new Response(out, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
      const status = out?.__status || 200;
      if (out && out.__status) delete out.__status;
      return new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      const status = e.status || 500;
      return new Response(JSON.stringify({ code: e.code || 'erreur_interne', message: e.message, details: e.details }), { status, headers: { 'content-type': 'application/json' } });
    }
  };
}
