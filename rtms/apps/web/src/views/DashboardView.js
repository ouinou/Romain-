// Tableau de bord dense : indicateurs, activité, alertes, accès rapides, activité récente.
import { emit, on } from '../core/bus.js';
import { get } from '../core/api.js';
import { dateTimeFr, esc, money } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { can } from '../core/session.js';
import { VIEWS } from '../config.js';
import { notificationListHtml, notifications } from '../components/NotificationCenter.js';
import { printHtml, reportDoc } from '../components/PrintService.js';

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
      this.data = d;
      const c = (k) => d.counts[k] || 0;
      const kpis = this.kpis = [['Missions', 'transport', 'truck', 't-green'], ['Dossiers de transit', 'transit', 'transit', 't-blue'], ['Import / Export', 'importexport', 'import', 't-orange'], ['Factures', 'invoices', 'receipt', 't-gray'], ['Tiers', 'clients', 'users', 't-green'], ['Véhicules', 'fleet', 'car', 't-blue'], ['Articles', 'commerce', 'store', 't-orange'], ['Documents', 'documents', 'folder', 't-gray']];
      const bars = [['Transport', c('transport')], ['Transit', c('transit')], ['Import/Export', c('importexport')], ['Factures', c('invoices')], ['Véhicules', c('fleet')], ['Maintenance', c('maintenance')]];
      const max = Math.max(1, ...bars.map((b) => b[1]));
      // Accès rapide, en haut : on commence à travailler dès l'ouverture, sans chercher dans les menus
      const ORDER = ['invoices', 'transport', 'transit', 'import', 'export', 'finance', 'clients', 'suppliers', 'commerce', 'fleet', 'staff', 'maintenance', 'documents'];
      const quick = ORDER.map((k) => VIEWS.find((v) => v.key === k)).filter((v) => v && v.kind === 'list' && can(v.module, 'create'));
      root.innerHTML = `
        <div class="view-head"><h1>${icon('dashboard', 20)} Tableau de bord</h1><span class="muted small">Vue synthétique des activités de RAHA TRANSPORT · ${esc(dateTimeFr(d.generatedAt))}</span></div>
        <section class="quick-start" aria-label="Accès rapide">
          <h2>Accès rapide</h2>
          ${quick.length ? `<div class="quick-big">${quick.map((v, i) => `<button type="button" class="${i === 0 ? 'first' : ''}" data-new="${v.key}">${icon(v.icon, 22)}<span>${esc(v.newLabel)}</span></button>`).join('')}</div>` : '<p class="muted small">Aucune création autorisée pour votre profil : utilisez les listes à gauche pour consulter.</p>'}
        </section>
        <div class="stat-tiles dash">${kpis.map(([l, k, ic, cls]) => `<button type="button" class="tile ${cls}" data-openview="${k === 'importexport' ? 'import' : k}" ${can(k) ? '' : 'disabled'}>${icon(ic, 26)}<span><b>${c(k)}</b><small>${esc(l)}</small></span></button>`).join('')}</div>
        <div class="kpis">
          ${d.finance ? `<div class="kpi money"><span class="kl">Recettes</span><span class="kv">${esc(money(d.finance.recettes))}</span></div><div class="kpi money"><span class="kl">Dépenses</span><span class="kv">${esc(money(d.finance.depenses))}</span></div><div class="kpi money ${d.finance.solde < 0 ? 'neg' : ''}"><span class="kl">Solde (FCFA)</span><span class="kv">${esc(money(d.finance.solde))}</span></div>` : ''}
        </div>
        <div class="dash-grid">
          <section class="panel"><h3>Activité opérationnelle</h3><div class="hbars">${bars.map(([n, v]) => `<div class="hbar"><span>${esc(n)}</span><div><i style="width:${Math.round((v / max) * 100)}%"></i></div><b>${v}</b></div>`).join('')}</div></section>
          <section class="panel"><h3>Alertes</h3><div data-alerts></div></section>
          <section class="panel"><h3>Mon activité récente</h3>${act.length ? `<table class="mini"><tbody>${act.slice(0, 8).map((a) => `<tr><td>${esc(dateTimeFr(a.at))}</td><td>${esc(ACTIONS[a.action] || a.action)}</td><td>${esc(a.reference || a.entity)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Aucune opération récente.</p>'}</section>
        </div>
        <div class="foot">RAHA TRANSPORT MANAGEMENT SYSTEM</div>`;
      this.renderAlerts();
    } catch (e) { root.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    emit('context-changed');
  }
  renderAlerts() { const a = this.el?.querySelector('[data-alerts]'); if (a) a.innerHTML = notificationListHtml(notifications().items.slice(0, 8), 'Aucune échéance ni alerte en cours.'); }
  supports(id) { return id === 'view.refresh' || (id === 'file.print'); }
  exec(id) {
    if (id === 'view.refresh') return this.load();
    if (id === 'file.print' && this.data) {
      // Synthèse imprimable du tableau de bord (passe par l'aperçu, comme tout document)
      const d = this.data;
      const rows = this.kpis.map(([l, k]) => `<tr><td>${esc(l)}</td><td class="num">${d.counts[k] || 0}</td></tr>`).join('');
      const money3 = d.finance ? `<tr><td>Recettes</td><td class="num">${esc(money(d.finance.recettes))} FCFA</td></tr><tr><td>Dépenses</td><td class="num">${esc(money(d.finance.depenses))} FCFA</td></tr><tr><td><b>Solde</b></td><td class="num"><b>${esc(money(d.finance.solde))} FCFA</b></td></tr>` : '';
      return printHtml(reportDoc(`<h2>Tableau de bord — ${esc(dateTimeFr(d.generatedAt))}</h2><table class="pr-kv"><tbody>${rows}${money3}</tbody></table><h3>Alertes</h3>${notificationListHtml(notifications().items.slice(0, 15), 'Aucune alerte en cours.')}`));
    }
    return undefined;
  }
  toolbar() { return [['view.refresh'], ['file.print']]; }
  panelContext() { return { kind: 'dashboard' }; }
  status() { return 'Tableau de bord'; }
}
