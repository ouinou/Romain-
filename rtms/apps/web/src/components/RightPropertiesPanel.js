// Panneaux latéraux droits, à la manière des panneaux d'un logiciel de création :
// contenu selon le contexte, réduction/extension, redimensionnement, réorganisation
// par glisser-déposer, masquage, détachement en panneau flottant.
import { on } from '../core/bus.js';
import { get } from '../core/api.js';
import { activeView, isEnabled, labelOf, command, run } from '../core/commands.js';
import { $, clampToViewport, dateFr, dateTimeFr, debounce, esc, h, makeDraggable, money } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { PANEL_SECTIONS, SECTION_LABELS, prefs, setPrefs } from '../core/prefs.js';
import { can, session } from '../core/session.js';
import { MODULE_LABEL, recordTitle, viewByKey, viewForRecord } from '../config.js';
import { workspace } from './MainWorkspace.js';
import { notificationListHtml, notifications } from './NotificationCenter.js';

const ICONS = { properties: 'info', history: 'history', documents: 'link', quick: 'zap', notifications: 'bell', activity: 'activity' };
const ACTIONS = { 'record.create': 'Création', 'record.update': 'Modification', 'record.cancel': 'Suppression', 'record.export': 'Export' };
const cache = new Map();
async function cached(key, fn) { if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; })); return cache.get(key); }
on('data-changed', () => cache.clear());

let panelEl, splitterEl, floatHost;

export function mountRightPanel(el, splitter) {
  panelEl = el;
  splitterEl = splitter;
  floatHost = h('<div class="float-host"></div>');
  document.body.appendChild(floatHost);
  const r = debounce(render, 60);
  on('context-changed', r);
  on('tab-changed', r);
  on('prefs', () => { applyLayout(); render(); });
  on('notifications', r);
  on('data-changed', r);

  // Redimensionnement par la poignée
  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing');
    const move = (ev) => {
      const w = Math.max(240, Math.min(560, window.innerWidth - ev.clientX));
      document.documentElement.style.setProperty('--panel-w', `${w}px`);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.body.classList.remove('resizing');
      setPrefs({ panelWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'), 10) }, { silent: true });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  });
  splitter.addEventListener('dblclick', () => togglePanel());

  const onClick = (e) => {
    const t = e.target.closest('[data-pact]');
    if (t) {
      const s = t.dataset.sec;
      const p = prefs();
      if (t.dataset.pact === 'collapse') setPrefs({ collapsed: p.collapsed.includes(s) ? p.collapsed.filter((x) => x !== s) : [...p.collapsed, s] });
      if (t.dataset.pact === 'hide') setPrefs({ hidden: [...p.hidden, s], floating: { ...(p.floating || {}), [s]: undefined } });
      if (t.dataset.pact === 'float') setPrefs({ floating: { ...(p.floating || {}), [s]: { x: window.innerWidth - 620, y: 140 } } });
      if (t.dataset.pact === 'dock') { const f = { ...(p.floating || {}) }; delete f[s]; setPrefs({ floating: f }); }
      return;
    }
    const c = e.target.closest('[data-cmd]');
    if (c && !c.disabled) return run(c.dataset.cmd);
    const o = e.target.closest('[data-open-record]');
    if (o) {
      const [module, id] = o.dataset.openRecord.split(':');
      workspace.open({ id: `rec:${module}:${id}`, kind: 'record', mode: 'view', module, recordId: id, viewKey: viewForRecord(module) });
    }
  };
  el.addEventListener('click', onClick);
  floatHost.addEventListener('click', onClick);

  // Réorganisation des sections par glisser-déposer
  let drag = null;
  el.addEventListener('dragstart', (e) => { const s = e.target.closest('[data-sec-box]'); if (s) { drag = s.dataset.secBox; e.dataTransfer.effectAllowed = 'move'; } });
  el.addEventListener('dragover', (e) => { if (drag) e.preventDefault(); });
  el.addEventListener('drop', (e) => {
    const s = e.target.closest('[data-sec-box]');
    if (!drag || !s || s.dataset.secBox === drag) { drag = null; return; }
    e.preventDefault();
    const order = prefs().order.filter((x) => x !== drag);
    order.splice(order.indexOf(s.dataset.secBox), 0, drag);
    drag = null;
    setPrefs({ order });
  });
  applyLayout();
  render();
}

export function togglePanel(force) {
  setPrefs({ panelVisible: force ?? !prefs().panelVisible });
}
export function showSection(s) {
  const p = prefs();
  setPrefs({ hidden: p.hidden.filter((x) => x !== s), collapsed: p.collapsed.filter((x) => x !== s), panelVisible: true });
}

function applyLayout() {
  const p = prefs();
  document.documentElement.style.setProperty('--panel-w', `${p.panelWidth || 320}px`);
  document.body.classList.toggle('no-panel', !p.panelVisible);
  document.body.classList.toggle('density-normal', p.density === 'normal');
}

function sectionBox(s, body, floating) {
  const p = prefs();
  const collapsed = p.collapsed.includes(s) && !floating;
  return `<section class="psec ${collapsed ? 'collapsed' : ''}" data-sec-box="${s}" ${floating ? '' : 'draggable="true"'} aria-label="${esc(SECTION_LABELS[s])}">
    <header class="psec-head">${floating ? '' : `<span class="grip" title="Glisser pour réorganiser">${icon('grip', 13)}</span>`}
      <button type="button" class="psec-title" data-pact="collapse" data-sec="${s}" aria-expanded="${!collapsed}">${icon(collapsed ? 'chevron' : 'chevrondown', 13)} ${icon(ICONS[s], 14)} ${esc(SECTION_LABELS[s])}</button>
      <button type="button" class="icon-btn" data-pact="${floating ? 'dock' : 'float'}" data-sec="${s}" title="${floating ? 'Ancrer dans le panneau' : 'Détacher en panneau flottant'}">${icon(floating ? 'pin' : 'float', 13)}</button>
      <button type="button" class="icon-btn" data-pact="hide" data-sec="${s}" title="Masquer (réafficher : menu Fenêtre)">${icon('x', 13)}</button></header>
    <div class="psec-body" data-sec-body="${s}">${collapsed ? '' : body}</div></section>`;
}

async function render() {
  if (!panelEl) return;
  const p = prefs();
  const v = activeView();
  const ctx = v?.panelContext?.() || { kind: 'none' };
  const floating = p.floating || {};
  const visible = p.order.filter((s) => PANEL_SECTIONS.includes(s) && !p.hidden.includes(s));
  const docked = visible.filter((s) => !floating[s]);
  panelEl.innerHTML = docked.length
    ? docked.map((s) => sectionBox(s, '<div class="muted small">…</div>', false)).join('')
    : '<div class="muted small pad">Tous les panneaux sont masqués ou détachés. Menu Fenêtre pour les réafficher.</div>';
  // Panneaux flottants (bornés à l'écran, déplaçables par leur titre)
  floatHost.innerHTML = '';
  for (const s of visible.filter((x) => floating[x])) {
    const w = h(`<div class="pfloat" data-float="${s}">${sectionBox(s, '<div class="muted small">…</div>', true)}</div>`);
    floatHost.appendChild(w);
    clampToViewport(w, floating[s].x, floating[s].y);
    makeDraggable($('.psec-head', w), w, (rr) => setPrefs({ floating: { ...prefs().floating, [s]: { x: rr.left, y: rr.top } } }, { silent: true }));
  }
  for (const s of visible) {
    if (p.collapsed.includes(s) && !floating[s]) continue;
    const target = document.querySelector(`[data-sec-body="${s}"]`);
    if (!target) continue;
    try { target.innerHTML = await sectionContent(s, ctx, v); } catch (e) { target.innerHTML = `<div class="err small">${esc(e.message)}</div>`; }
  }
}

const kv = (rows) => `<table class="kv">${rows.filter(Boolean).map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val ?? '—')}</td></tr>`).join('')}</table>`;

async function sectionContent(s, ctx, v) {
  const rec = ctx.record;
  const m = ctx.module;
  switch (s) {
    case 'properties': {
      if (rec && m) {
        const f = session.defs[m]?.fields || [];
        const rows = f.map((x) => [x.name, x.type === 'date' ? dateFr(rec.data[x.name]) : x.type === 'number' && rec.data[x.name] !== undefined ? money(rec.data[x.name]) : rec.data[x.name]]);
        if (rec.computed?.totalTTC !== undefined) rows.push(['Total TTC (calculé)', `${money(rec.computed.totalTTC)} FCFA`]);
        rows.push(['Version', String(rec.version)], ['Modifié le', dateTimeFr(rec.updatedAt)]);
        return `<div class="psec-title2">${esc(MODULE_LABEL[m])} — ${esc(recordTitle(m, rec))}</div>${kv(rows)}`;
      }
      if (ctx.kind === 'list') {
        return `<div class="psec-title2">Informations générales</div>${kv([['Vue', viewByKey(ctx.viewKey)?.title], ['Enregistrements', String(ctx.total)], ['Sélection', ctx.selection ? `${ctx.selection} enregistrement(s)` : 'aucune'], ['Actualisé', ctx.loadedAt ? dateTimeFr(ctx.loadedAt) : '—']])}<p class="muted small">Sélectionnez une ligne pour afficher ses propriétés. Double-clic ou Entrée pour ouvrir la fiche.</p>`;
      }
      if (ctx.kind === 'record' && ctx.mode === 'new') return '<p class="muted small">Nouvel enregistrement en cours de saisie. Les propriétés s’afficheront après l’enregistrement.</p>';
      return kv([['Utilisateur', session.me?.user.fullName], ['Profil', session.me?.user.roleLabel], ['Licence', session.me?.license?.state], ['Version', '2.1']]);
    }
    case 'history': {
      if (!rec || !m) return '<p class="muted small">Sélectionnez un enregistrement pour voir son historique.</p>';
      const hist = await cached(`h:${m}:${rec.id}:${rec.version}`, () => get(`/api/records/${m}/${rec.id}/history`));
      if (!hist.length) return '<p class="muted small">Aucun historique.</p>';
      return `<ol class="timeline">${hist.map((x) => `<li><div class="tl-h"><b>${esc(ACTIONS[x.action] || x.action)}</b><span>${esc(dateTimeFr(x.at))}</span></div><div class="muted small">${esc(x.user || 'Système')}</div>
        ${x.changes.length ? `<ul class="changes">${x.changes.map((c) => `<li><span>${esc(c.field)}</span> : <del>${esc(c.from ?? '∅')}</del> → <ins>${esc(c.to ?? '∅')}</ins></li>`).join('')}</ul>` : ''}${x.reason ? `<div class="small">Motif : ${esc(x.reason)}</div>` : ''}</li>`).join('')}</ol>`;
    }
    case 'documents': {
      if (!rec || !m) return '<p class="muted small">Sélectionnez un enregistrement pour voir les documents rattachés.</p>';
      if (!can('documents')) return '<p class="muted small">Votre profil n’a pas accès à la gestion documentaire.</p>';
      if (!rec.reference) return '<p class="muted small">Cet enregistrement n’a pas de référence à laquelle rattacher des documents.</p>';
      const docs = await cached(`d:${rec.reference}`, () => get(`/api/records/documents?limit=20&f=${encodeURIComponent(JSON.stringify({ 'Dossier lié': rec.reference }))}`));
      return docs.items.length
        ? `<ul class="link-list">${docs.items.map((d) => `<li><button type="button" class="link" data-open-record="documents:${esc(d.id)}">${icon('folder', 13)} ${esc(d.data['Référence'])} — ${esc(d.data['Intitulé'] || '')}</button>${d.data['Date d’expiration'] ? `<span class="muted small"> exp. ${esc(dateFr(d.data['Date d’expiration']))}</span>` : ''}</li>`).join('')}</ul>`
        : `<p class="muted small">Aucun document dont le « Dossier lié » est ${esc(rec.reference)}.</p>`;
    }
    case 'quick': {
      const ids = [...new Set((v?.toolbar?.() || []).flat())].filter((id) => isEnabled(id));
      return ids.length ? `<div class="quick-list">${ids.map((id) => `<button type="button" class="qa" data-cmd="${id}">${icon(command(id)?.icon || 'zap', 14)} ${esc(labelOf(id))}</button>`).join('')}</div>` : '<p class="muted small">Aucune action disponible ici.</p>';
    }
    case 'notifications': {
      const items = notifications().items.filter((n) => !m || n.module === m);
      return notificationListHtml(items.slice(0, 30), m ? 'Aucune alerte pour ce module.' : 'Aucune alerte.');
    }
    case 'activity': {
      const act = await cached('activity', () => get('/api/activity'));
      return act.length ? `<ul class="act-list">${act.slice(0, 15).map((a) => `<li><button type="button" class="link" data-open-record="${esc(a.entity)}:${esc(a.entityId)}" ${a.action === 'record.cancel' || a.action === 'record.export' ? 'disabled' : ''}>${esc(ACTIONS[a.action] || a.action)} · ${esc(a.reference || MODULE_LABEL[a.entity] || a.entity)}</button><span class="muted small">${esc(dateTimeFr(a.at))}</span></li>`).join('')}</ul>` : '<p class="muted small">Aucune opération récente.</p>';
    }
    default: return '';
  }
}
