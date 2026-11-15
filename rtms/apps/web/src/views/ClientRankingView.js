// Classement des clients : qui commande le plus, et avec quelle régularité.
// Les chiffres et les catégories sont calculés par le serveur (/api/reports/clients).
import { emit, on } from '../core/bus.js';
import { get } from '../core/api.js';
import { $, dateFr, dateTimeFr, esc, money } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { can } from '../core/session.js';
import { printHtml, reportDoc } from '../components/PrintService.js';

export const CATEGORIES = [
  ['Régulier', 't-green', 'Commandes dans au moins 6 des 12 derniers mois'],
  ['Occasionnel', 't-blue', 'Commandes dans 2 à 5 des 12 derniers mois'],
  ['Nouveau', 't-orange', 'Premier document il y a moins de 90 jours'],
  ['Ponctuel', 't-gray', 'Un seul mois d’activité sur l’année'],
  ['Inactif', 't-red', 'Aucune commande depuis plus de 120 jours'],
];
const TREND = { hausse: ['▲', 'en hausse', 'trend-up'], baisse: ['▼', 'en baisse', 'trend-down'], stable: ['●', 'stable', 'trend-flat'] };

export class ClientRankingView {
  constructor(tab, ws) { this.tab = tab; this.ws = ws; this.cat = tab.desc.state?.cat || ''; this.offs = [on('data-changed', () => { this.stale = true; })]; }
  title() { return 'Classement des clients'; }
  icon() { return 'trophy'; }
  serialize() { return { id: this.tab.id, kind: 'ranking', viewKey: 'ranking', state: { cat: this.cat } }; }
  mount(el) {
    this.el = el;
    el.innerHTML = '<div class="view ranking-view"><div class="empty">Chargement…</div></div>';
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cat]');
      if (t) { this.cat = this.cat === t.dataset.cat ? '' : t.dataset.cat; this.render(); return; }
      const o = e.target.closest('[data-open-client]');
      if (o) this.ws.open({ id: `rec:clients:${o.dataset.openClient}`, kind: 'record', mode: 'view', module: 'clients', recordId: o.dataset.openClient, viewKey: 'clients' });
    });
    this.load();
  }
  activate() { if (this.stale) this.load(); }
  refresh() { return this.load(); }
  destroy() { this.offs.forEach((f) => f()); }

  async load() {
    this.stale = false;
    try { this.data = await get('/api/reports/clients'); this.error = null; } catch (e) { this.error = e.message; }
    this.render();
    emit('context-changed');
  }

  rows() { return (this.data?.clients || []).filter((c) => !this.cat || c.category === this.cat); }

  tableHtml(list, { print = false } = {}) {
    const m = this.data.withAmounts;
    return `<table class="${print ? 'pr-table' : 'mini wide-table ranking-table'}"><thead><tr><th class="num">Rang</th><th>Client</th><th>Catégorie</th><th>Tendance</th><th class="num">Commandes</th><th class="num">Factures</th><th class="num">Missions</th><th class="num">Dossiers / BL</th>${m ? '<th class="num">Chiffre d’affaires (FCFA)</th><th class="num">Reste dû (FCFA)</th>' : ''}<th>Dernière commande</th><th class="num">Mois actifs (12 mois)</th></tr></thead>
      <tbody>${list.map((c) => {
        const [sym, lbl, cls] = TREND[c.trend] || TREND.stable;
        const catCls = (CATEGORIES.find(([k]) => k === c.category) || [])[1] || '';
        const name = !print && c.clientId && can('clients') ? `<button type="button" class="link" data-open-client="${esc(c.clientId)}">${esc(c.name)}</button>` : esc(c.name);
        return `<tr><td class="num"><b>${c.rank}</b></td><td>${name}${c.phone ? `<br><span class="muted small">${esc(c.phone)}</span>` : ''}</td>
          <td><span class="pill cat ${catCls}">${esc(c.category)}</span></td><td><span class="${cls}" title="6 derniers mois comparés aux 6 précédents">${sym} ${esc(lbl)}</span></td>
          <td class="num"><b>${c.orders}</b></td><td class="num">${c.invoices}</td><td class="num">${c.missions}</td><td class="num">${c.dossiers}</td>
          ${m ? `<td class="num">${esc(money(c.revenue))}</td><td class="num ${c.outstanding > 0 ? 'neg' : ''}">${esc(money(c.outstanding))}</td>` : ''}
          <td>${esc(dateFr(String(c.last).slice(0, 10)))}</td><td class="num">${c.monthsActive12} / 12</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  render() {
    const root = $('.ranking-view', this.el);
    if (this.error) { root.innerHTML = `<div class="err">${esc(this.error)}</div>`; return; }
    if (!this.data) return;
    const by = this.data.byCategory || {};
    const list = this.rows();
    const constant = (by['Régulier'] || 0);
    const total = this.data.clients.length;
    root.innerHTML = `<div class="page-head"><span class="page-ico">${icon('trophy', 30)}</span>
        <div class="page-titles"><h1>Classement des clients</h1><p>Clients classés par nombre de commandes (factures, missions, dossiers de transit et BL). Calculé le ${esc(dateTimeFr(this.data.generatedAt))}.</p></div></div>
      <div class="stat-tiles">${CATEGORIES.map(([k, cls, help]) => `<button type="button" class="tile ${cls} ${this.cat === k ? 'on' : ''}" data-cat="${esc(k)}" title="${esc(help)}">${icon(k === 'Inactif' ? 'xcircle' : k === 'Régulier' ? 'trophy' : 'users', 26)}<span><b>${by[k] || 0}</b><small>${esc(k)}</small></span></button>`).join('')}</div>
      <p class="small ranking-summary">${total ? `<b>${constant}</b> client(s) constant(s) sur <b>${total}</b>${total ? ` (${Math.round((constant / total) * 100)} %)` : ''} · <b>${by['Inactif'] || 0}</b> client(s) à relancer (plus de 4 mois sans commande).` : 'Aucune commande enregistrée pour le moment : le classement se remplit au fil des factures et des missions.'}${this.cat ? ` Filtre : <b>${esc(this.cat)}</b> <button type="button" class="link" data-cat="${esc(this.cat)}">retirer</button>` : ''}</p>
      ${list.length ? `<section class="panel ranking-panel">${this.tableHtml(list)}</section>` : total ? '<div class="empty">Aucun client dans cette catégorie.</div>' : ''}`;
  }

  supports(id) { return id === 'view.refresh' || (['file.print', 'file.pdf'].includes(id) && !!this.data); }
  exec(id) {
    if (id === 'view.refresh') return this.load();
    const list = this.rows();
    const title = `<h2>Classement des clients${this.cat ? ` — ${esc(this.cat)}` : ''}</h2><p>${list.length} client(s). Catégories : régulier = au moins 6 mois actifs sur 12 ; occasionnel = 2 à 5 ; inactif = plus de 120 jours sans commande.</p>`;
    return printHtml(reportDoc(title + this.tableHtml(list, { print: true })), { pdf: id === 'file.pdf' });
  }
  toolbar() { return [['view.refresh'], ['file.print', 'file.pdf']]; }
  panelContext() { return { kind: 'ranking' }; }
  status() { return this.data ? `${this.data.clients.length} client(s) classé(s)` : 'Classement des clients'; }
}
