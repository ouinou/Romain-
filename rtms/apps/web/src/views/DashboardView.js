// Tableau de bord dense : indicateurs, activité, alertes, accès rapides, activité récente.
import { emit, on } from '../core/bus.js';
import { get } from '../core/api.js';
import { dateTimeFr, esc, money } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { can } from '../core/session.js';
import { VIEWS } from '../config.js';
import { notificationListHtml, notifications } from '../components/NotificationCenter.js';

const ACTIONS = { 'record.create': 'Création', 'record.update': 'Modification', 'record.cancel': 'Suppression', 'record.export': 'Export' };

export class DashboardView {
  constructor(tab, ws) { this.tab = tab; this.ws = ws; this.offs = [on('data-changed', () => this.invalidate()), on('notifications', () => this.renderAlerts())]; }
  title() { return 'Tableau de bord'; }
  icon() { return 'dashboard'; }
  serialize() { return { id: this.tab.id, kind: 'dashboard', viewKey: 'dashboard' }; }
  mount(el) {
    this.el = el;
    el.innerHTML = '<div class="view dash-view"><div class="empty">Chargement…</div></div>';
    el.addEventListener('click', (e) => {
      const g = e.target.closest('[data-new]');
      if (g) { const v = VIEWS.find((x) => x.key === g.dataset.new); this.ws.open({ kind: 'record', mode: 'new', module: v.module, viewKey: v.key, values: { ...(v.preset || {}) } }); }
      const o = e.target.closest('[data-openview]');
      if (o) this.ws.open({ id: `view:${o.dataset.openview}`, kind: 'list', viewKey: o.dataset.openview });
    });
    this.load();
  }
  activate() { if (this.stale) this.load(); }
  invalidate() { this.stale = true; if (this.ws.active() === this.tab) this.load(); }
  refresh() { return this.load(); }
  destroy() { this.offs.forEach((f) => f()); }

  async load() {
    this.stale = false;
    const root = this.el.querySelector('.dash-view');
    try {
      const [d, act] = await Promise.all([get('/api/dashboard'), get('/api/activity').catch(() => [])]);
      const c = (k) => d.counts[k] || 0;
      const kpis = [['Missions', 'transport', 'truck', 't-green'], ['Dossiers de transit', 'transit', 'transit', 't-blue'], ['Import / Export', 'importexport', 'import', 't-orange'], ['Factures', 'invoices', 'receipt', 't-gray'], ['Tiers', 'clients', 'users', 't-green'], ['Véhicules', 'fleet', 'car', 't-blue'], ['Articles', 'commerce', 'store', 't-orange'], ['Documents', 'documents', 'folder', 't-gray']];
      const bars = [['Transport', c('transport')], ['Transit', c('transit')], ['Import/Export', c('importexport')], ['Factures', c('invoices')], ['Véhicules', c('fleet')], ['Maintenance', c('maintenance')]];
      const max = Math.max(1, ...bars.map((b) => b[1]));
      const quick = VIEWS.filter((v) => v.kind === 'list' && can(v.module, 'create') && ['transport', 'transit', 'invoices', 'fleet', 'clients', 'finance'].includes(v.key));
      root.innerHTML = `
        <div class="view-head"><h1>${icon('dashboard', 20)} Tableau de bord</h1><span class="muted small">Vue synthétique des activités de RAHA TRANSPORT · ${esc(dateTimeFr(d.generatedAt))}</span></div>
        <div class="stat-tiles dash">${kpis.map(([l, k, ic, cls]) => `<button type="button" class="tile ${cls}" data-openview="${k === 'importexport' ? 'import' : k}" ${can(k) ? '' : 'disabled'}>${icon(ic, 26)}<span><b>${c(k)}</b><small>${esc(l)}</small></span></button>`).join('')}</div>
        <div class="kpis">
          ${d.finance ? `<div class="kpi money"><span class="kl">Recettes</span><span class="kv">${esc(money(d.finance.recettes))}</span></div><div class="kpi money"><span class="kl">Dépenses</span><span class="kv">${esc(money(d.finance.depenses))}</span></div><div class="kpi money ${d.finance.solde < 0 ? 'neg' : ''}"><span class="kl">Solde (FCFA)</span><span class="kv">${esc(money(d.finance.solde))}</span></div>` : ''}
        </div>
        <div class="dash-grid">
          <section class="panel"><h3>Activité opérationnelle</h3><div class="hbars">${bars.map(([n, v]) => `<div class="hbar"><span>${esc(n)}</span><div><i style="width:${Math.round((v / max) * 100)}%"></i></div><b>${v}</b></div>`).join('')}</div></section>
          <section class="panel"><h3>Alertes</h3><div data-alerts></div></section>
          <section class="panel"><h3>Accès rapide</h3><div class="quick">${quick.map((v) => `<button type="button" data-new="${v.key}">${icon('plus', 14)} ${esc(v.newLabel)}</button>`).join('') || '<span class="muted small">Aucune création autorisée pour votre profil.</span>'}</div></section>
          <section class="panel"><h3>Mon activité récente</h3>${act.length ? `<table class="mini"><tbody>${act.slice(0, 8).map((a) => `<tr><td>${esc(dateTimeFr(a.at))}</td><td>${esc(ACTIONS[a.action] || a.action)}</td><td>${esc(a.reference || a.entity)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Aucune opération récente.</p>'}</section>
        </div>
        <div class="foot">RAHA TRANSPORT MANAGEMENT SYSTEM</div>`;
      this.renderAlerts();
    } catch (e) { root.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    emit('context-changed');
  }
  renderAlerts() { const a = this.el?.querySelector('[data-alerts]'); if (a) a.innerHTML = notificationListHtml(notifications().items.slice(0, 8), 'Aucune échéance ni alerte en cours.'); }
  supports(id) { return id === 'view.refresh' || (id === 'file.print'); }
  exec(id) { if (id === 'view.refresh') return this.load(); if (id === 'file.print') window.print(); return undefined; }
  toolbar() { return [['view.refresh'], ['file.print']]; }
  panelContext() { return { kind: 'dashboard' }; }
  status() { return 'Tableau de bord'; }
}
