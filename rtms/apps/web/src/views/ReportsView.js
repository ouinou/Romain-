// Rapports : synthèse calculée par le serveur, impression / PDF.
import { emit, on } from '../core/bus.js';
import { get } from '../core/api.js';
import { dateTimeFr, esc, money } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { printHtml, reportDoc } from '../components/PrintService.js';

const VOL = { Transport: 'transport', Transit: 'transit', 'Import / Export': 'importexport', Commerce: 'commerce', Facturation: 'invoices', 'Finance (mouvements)': 'finance', Véhicules: 'fleet', Personnel: 'staff', Maintenance: 'maintenance', Documents: 'documents', 'Clients et fournisseurs': 'clients' };

export class ReportsView {
  constructor(tab, ws) { this.tab = tab; this.ws = ws; this.offs = [on('data-changed', () => { this.stale = true; })]; }
  title() { return 'Rapports'; }
  icon() { return 'chart'; }
  serialize() { return { id: this.tab.id, kind: 'reports', viewKey: 'reports' }; }
  mount(el) { this.el = el; el.innerHTML = '<div class="view"><div class="empty">Chargement…</div></div>'; this.load(); }
  activate() { if (this.stale) this.load(); }
  refresh() { return this.load(); }
  destroy() { this.offs.forEach((f) => f()); }
  async load() {
    this.stale = false;
    const root = this.el.querySelector('.view');
    try {
      const s = await get('/api/reports/summary');
      this.data = s;
      root.innerHTML = `<div class="view-head"><h1>${icon('chart', 20)} Rapports & statistiques</h1><span class="muted small">Calculé par le serveur le ${esc(dateTimeFr(s.generatedAt))}</span></div>
        <div class="report" data-report>${this.reportHtml(s)}</div>`;
    } catch (e) { root.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    emit('context-changed');
  }
  reportHtml(s) {
    return `<div class="kpis"><div class="kpi money"><span class="kl">Recettes enregistrées</span><span class="kv">${esc(money(s.finance.recettes))} F</span></div><div class="kpi money"><span class="kl">Dépenses enregistrées</span><span class="kv">${esc(money(s.finance.depenses))} F</span></div><div class="kpi money ${s.finance.solde < 0 ? 'neg' : ''}"><span class="kl">Solde net</span><span class="kv">${esc(money(s.finance.solde))} F</span></div></div>
      <section class="panel"><h3>Volumes par activité</h3><table class="mini wide-table"><thead><tr><th>Activité</th><th class="num">Enregistrements actifs</th></tr></thead><tbody>${Object.entries(VOL).map(([l, k]) => `<tr><td>${esc(l)}</td><td class="num">${s.counts[k] || 0}</td></tr>`).join('')}</tbody></table></section>`;
  }
  supports(id) { return ['view.refresh', 'file.print', 'file.pdf'].includes(id) && (id === 'view.refresh' || !!this.data); }
  exec(id) {
    if (id === 'view.refresh') return this.load();
    return printHtml(reportDoc(this.reportHtml(this.data)), { pdf: id === 'file.pdf' });
  }
  toolbar() { return [['view.refresh'], ['file.print', 'file.pdf']]; }
  panelContext() { return { kind: 'reports' }; }
  status() { return 'Rapports'; }
}
