// Vue « liste » d'un module : tableau dense type tableur avec recherche instantanée,
// tri par colonne, filtres multicritères, pagination, sélection multiple,
// actions groupées, colonnes personnalisables, export et impression.
import { emit, on } from '../core/bus.js';
import { fetchBlob, get, patch, post } from '../core/api.js';
import { $, $$, csvCell, debounce, download, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { prefs, setPrefs } from '../core/prefs.js';
import { can, session } from '../core/session.js';
import { COLUMNS, LOCKED_STATUSES, MODULE_LABEL, VALIDATED_STATUS, recordTitle, viewByKey } from '../config.js';
import { showContextMenu } from '../components/ContextMenu.js';
import { confirmDialog, dialog, formDialog } from '../components/ModalManager.js';
import { invoiceDoc, missionOrderDoc, printHtml, tableDoc } from '../components/PrintService.js';

export function statusField(module) { return session.defs[module]?.statusField; }
export function statusOptions(module) {
  const f = session.defs[module]?.fields.find((x) => x.name === statusField(module));
  return f ? f.options : [];
}

/** Applique un nouveau statut à des enregistrements (avec confirmation si le statut fige). */
export async function changeStatus(module, records, forced) {
  const sf = statusField(module);
  if (!sf || !records.length) return false;
  let status = forced;
  if (!status) {
    const opts = statusOptions(module).filter((o) => can(module, 'validate') || !LOCKED_STATUSES.includes(o));
    const r = await formDialog(records.length > 1 ? `Modifier le statut de ${records.length} enregistrements` : 'Modifier le statut', [{ name: 'status', label: 'Nouveau statut', type: 'select', options: opts, value: records[0].status }], { ok: 'Appliquer' });
    if (!r) return false;
    status = r.status;
  }
  if (LOCKED_STATUSES.includes(status)) {
    const ok = await confirmDialog(`Passer ${records.length > 1 ? `${records.length} enregistrements` : '« ' + recordTitle(module, records[0]) + ' »'} au statut « ${status} » ?`, { title: 'Validation', ok: 'Valider', detail: 'Un enregistrement validé ne peut plus être modifié que par un profil habilité. L’opération est tracée.' });
    if (!ok) return false;
  }
  return bulk(records, async (r) => patch(`/api/records/${module}/${r.id}`, { version: r.version, data: { [sf]: status } }), `Statut « ${status} »`, module);
}

/** Exécute une opération sur chaque enregistrement et résume le résultat. */
export async function bulk(records, fn, label, module) {
  let ok = 0;
  const errors = [];
  for (const r of records) {
    try { await fn(r); ok++; } catch (e) { errors.push(`${recordTitle(module, r)} : ${e.message}`); }
  }
  if (ok) {
    emit('data-changed', { module });
    emit('operation', { message: `${label} — ${ok} ${MODULE_LABEL[module].toLowerCase()}(s) (${module})` });
  }
  if (errors.length) {
    await dialog({ title: `${errors.length} opération(s) refusée(s)`, body: `<ul class="err-list">${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, actions: [{ label: 'OK', value: true }] });
  } else if (ok) emit('toast', { type: 'success', message: `${label} : ${ok} enregistrement(s) mis à jour.` });
  return ok > 0;
}

export async function cancelRecords(module, records) {
  if (!records.length) return false;
  const one = records.length === 1;
  const r = await formDialog(one ? `Supprimer « ${recordTitle(module, records[0])} »` : `Supprimer ${records.length} enregistrements`, [{ name: 'reason', label: 'Motif (conservé dans le journal d’audit)', type: 'text', value: 'Supprimé depuis la liste', required: true }], { ok: 'Supprimer', intro: 'Les enregistrements sont retirés des listes et conservés dans l’historique. Aucune donnée n’est effacée physiquement.' });
  if (!r) return false;
  return bulk(records, (x) => post(`/api/records/${module}/${x.id}/cancel`, { reason: r.reason }), 'Suppression (annulation tracée)', module);
}

async function pickRelated(title, module, field, preset, current) {
  if (!can(module)) { emit('toast', { type: 'error', message: 'Vous n’avez pas accès à ce référentiel.' }); return null; }
  const qs = preset ? `&f=${encodeURIComponent(JSON.stringify(preset))}` : '';
  const list = await get(`/api/records/${module}?limit=200&sort=${encodeURIComponent(field)}&dir=asc${qs}`);
  const opts = list.items.map((x) => x.data[field]).filter(Boolean);
  if (!opts.length) { emit('toast', { type: 'error', message: 'Aucun élément disponible dans le référentiel.' }); return null; }
  const r = await formDialog(title, [{ name: 'v', label: title, type: 'select', options: opts, value: current }], { ok: 'Affecter' });
  return r ? r.v : null;
}

export class ListView {
  constructor(tab, ws) {
    this.tab = tab;
    this.ws = ws;
    this.cfg = viewByKey(tab.desc.viewKey);
    this.module = this.cfg.module;
    const s = tab.desc.state || {};
    this.state = { q: s.q || '', filters: s.filters || {}, sort: s.sort || '', dir: s.dir || 'desc', offset: s.offset || 0, showFilters: !!s.showFilters };
    this.rows = [];
    this.total = 0;
    this.selected = new Set();
    this.focusIdx = -1;
    this.stale = false;
    this.loading = false;
    this.offs = [on('data-changed', (d) => this.invalidate(d?.module)), on('prefs', () => this.renderTable())];
  }

  title() { return this.cfg.title || this.cfg.label; }
  icon() { return this.cfg.icon; }
  defs() { return session.defs[this.module]; }
  pageSize() { return prefs().pageSize || 50; }
  serialize() { return { id: this.tab.id, kind: 'list', viewKey: this.cfg.key, state: this.state }; }
  selectedRows() { return this.rows.filter((r) => this.selected.has(r.id)); }
  single() { const s = this.selectedRows(); return s.length === 1 ? s[0] : null; }
  columns() {
    const all = COLUMNS[this.module];
    const saved = prefs().columns[this.cfg.key];
    return saved ? all.filter((c) => saved.includes(c.key)) : all.filter((c) => !c.hidden && !(this.cfg.preset && c.key in this.cfg.preset));
  }

  mount(el) {
    this.el = el;
    el.innerHTML = `<div class="view list-view">
      <div class="view-head"><h1>${icon(this.cfg.icon, 20)} ${esc(this.title())}</h1><span class="count" data-count></span><span class="chips" data-chips></span></div>
      <div class="list-bar">
        <label class="search-box">${icon('search', 15)}<input type="search" data-q placeholder="Rechercher dans ${esc(this.title().toLowerCase())}…  (Ctrl+F)" maxlength="100" value="${esc(this.state.q)}" aria-label="Rechercher"></label>
        <button type="button" class="btn secondary sm" data-act="filters">${icon('filter', 15)} Filtres <span data-nfilters></span></button>
        <button type="button" class="btn secondary sm" data-act="columns">${icon('columns', 15)} Colonnes</button>
        <span class="spacer"></span>
        <span class="bulk off" data-bulk aria-hidden="true"></span>
      </div>
      <form class="filters" data-filters ${this.state.showFilters ? '' : 'hidden'}></form>
      <div class="grid-wrap" tabindex="0" data-grid aria-label="Tableau ${esc(this.title())}"></div>
      <div class="pager" data-pager></div>
    </div>`;
    this.renderFilters();
    $('[data-q]', el).addEventListener('input', debounce((e) => { this.state.q = e.target.value; this.state.offset = 0; this.load(); }, 250));
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    $('[data-grid]', el).addEventListener('keydown', (e) => this.onKey(e));
    $('[data-filters]', el).addEventListener('input', debounce(() => this.readFilters(), 300));
    $('[data-filters]', el).addEventListener('submit', (e) => e.preventDefault());
    this.load();
  }

  activate() { if (this.stale) this.load(); }
  invalidate(module) { if (!module || module === this.module) { this.stale = true; if (this.ws.active() === this.tab) this.load(); } }
  refresh() { return this.load(); }
  destroy() { this.offs.forEach((f) => f()); }

  query() {
    const f = { ...this.state.filters, ...(this.cfg.preset || {}) };
    const p = new URLSearchParams({ limit: String(this.pageSize()), offset: String(this.state.offset), q: this.state.q, dir: this.state.dir });
    if (this.state.sort) p.set('sort', this.state.sort);
    if (Object.keys(f).length) p.set('f', JSON.stringify(f));
    return p.toString();
  }

  async load() {
    this.loading = true;
    this.stale = false;
    const grid = $('[data-grid]', this.el);
    grid.classList.add('loading');
    try {
      const r = await get(`/api/records/${this.module}?${this.query()}`);
      this.rows = r.items;
      this.total = r.total;
      if (this.state.offset >= r.total && r.total > 0) { this.state.offset = Math.floor((r.total - 1) / this.pageSize()) * this.pageSize(); return this.load(); }
      const ids = new Set(this.rows.map((x) => x.id));
      for (const id of [...this.selected]) if (!ids.has(id)) this.selected.delete(id);
      this.loadedAt = new Date();
      this.renderTable();
    } catch (e) {
      grid.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    } finally {
      this.loading = false;
      grid.classList.remove('loading');
      emit('tab-changed');
      emit('context-changed');
    }
  }

  renderTable() {
    if (!this.el) return;
    const cols = this.columns();
    const grid = $('[data-grid]', this.el);
    const allSel = this.rows.length && this.rows.every((r) => this.selected.has(r.id));
    const sortIco = (c) => (c.sort && this.state.sort === c.sort ? icon(this.state.dir === 'asc' ? 'chevron' : 'chevrondown', 12, `sort-${this.state.dir}`) : '');
    if (!this.rows.length) {
      grid.innerHTML = `<div class="empty">${this.state.q || Object.keys(this.state.filters).length ? 'Aucun résultat pour cette recherche ou ces filtres.' : `Aucun enregistrement.${can(this.module, 'create') ? ` Utilisez « ${esc(this.cfg.newLabel)} » (Ctrl+N) pour commencer.` : ''}`}</div>`;
    } else {
      grid.innerHTML = `<table class="grid ${prefs().density === 'normal' ? '' : 'dense'}">
        <thead><tr><th class="chk"><input type="checkbox" data-all aria-label="Tout sélectionner" ${allSel ? 'checked' : ''}></th>
        ${cols.map((c) => `<th class="${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''}" ${c.sort ? `data-sort="${esc(c.sort)}" aria-sort="${this.state.sort === c.sort ? (this.state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"` : ''}>${esc(c.label)} ${sortIco(c)}</th>`).join('')}</tr></thead>
        <tbody>${this.rows.map((r, i) => `<tr data-id="${esc(r.id)}" class="${this.selected.has(r.id) ? 'sel' : ''} ${i === this.focusIdx ? 'focus' : ''}">
          <td class="chk"><input type="checkbox" data-sel aria-label="Sélectionner" ${this.selected.has(r.id) ? 'checked' : ''}></td>
          ${cols.map((c) => {
            const v = c.render ? c.render(r.data, r) : r.data[c.key];
            const shown = v === undefined || v === null || v === '' ? '—' : v;
            if (c.key === 'Statut' || c.key === 'Type (Recette/Dépense)') return `<td><span class="pill ${pillClass(shown)}">${esc(shown)}</span></td>`;
            return `<td class="${c.num ? 'num' : ''}">${esc(shown)}</td>`;
          }).join('')}</tr>`).join('')}</tbody>
        ${this.footerRow(cols)}
      </table>`;
    }
    $('[data-count]', this.el).textContent = `${this.total} enregistrement(s)`;
    const nf = Object.values(this.state.filters).filter((v) => (typeof v === 'object' ? v.from || v.to : v)).length;
    $('[data-nfilters]', this.el).textContent = nf ? `(${nf})` : '';
    $('[data-chips]', this.el).innerHTML = Object.entries(this.state.filters).filter(([, v]) => (typeof v === 'object' ? v.from || v.to : v))
      .map(([k, v]) => `<span class="chip">${esc(k)} : ${esc(typeof v === 'object' ? `${v.from || '…'} → ${v.to || '…'}` : v)}<button type="button" data-unfilter="${esc(k)}" aria-label="Retirer le filtre">${icon('x', 11)}</button></span>`).join('');
    this.renderPager();
    this.renderBulk();
  }

  /** Ligne de totaux pour les colonnes monétaires (page affichée). */
  footerRow(cols) {
    const sums = { 'Montant (FCFA)': 'Montant (FCFA)', 'Coût (FCFA)': 'Coût (FCFA)', 'Frais estimés': 'Frais estimés', 'Valeur déclarée': 'Valeur déclarée', __ttc: 'totalTTC' };
    if (!cols.some((c) => c.key in sums)) return '';
    const cells = cols.map((c) => {
      if (!(c.key in sums)) return '<td></td>';
      const total = this.rows.reduce((s, r) => s + (Number(c.key === '__ttc' ? r.computed?.totalTTC : r.data[c.key]) || 0), 0);
      return `<td class="num">${esc(total.toLocaleString('fr-FR'))}</td>`;
    });
    return `<tfoot><tr><td class="chk"></td>${cells.join('').replace('<td></td>', '<td class="muted">Total page</td>')}</tr></tfoot>`;
  }

  renderPager() {
    const size = this.pageSize();
    const page = Math.floor(this.state.offset / size) + 1;
    const pages = Math.max(1, Math.ceil(this.total / size));
    $('[data-pager]', this.el).innerHTML = `
      <button type="button" class="icon-btn" data-page="first" ${page <= 1 ? 'disabled' : ''} aria-label="Première page">«</button>
      <button type="button" class="icon-btn" data-page="prev" ${page <= 1 ? 'disabled' : ''} aria-label="Page précédente">‹</button>
      <span>Page ${page} / ${pages}</span>
      <button type="button" class="icon-btn" data-page="next" ${page >= pages ? 'disabled' : ''} aria-label="Page suivante">›</button>
      <button type="button" class="icon-btn" data-page="last" ${page >= pages ? 'disabled' : ''} aria-label="Dernière page">»</button>
      <label class="muted">Lignes par page <select data-size>${[25, 50, 100, 200].map((n) => `<option ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <span class="spacer"></span><span class="muted">${this.selected.size ? `${this.selected.size} sélectionné(s) · ` : ''}${this.loadedAt ? `Actualisé à ${this.loadedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>`;
    $('[data-size]', this.el).addEventListener('change', (e) => { setPrefs({ pageSize: Number(e.target.value) }, { silent: true }); this.state.offset = 0; this.load(); });
  }

  renderBulk() {
    const n = this.selected.size;
    const el = $('[data-bulk]', this.el);
    // La barre garde sa place (pas de décalage du tableau quand la sélection change)
    el.classList.toggle('off', n < 2);
    el.setAttribute('aria-hidden', String(n < 2));
    if (n < 2) { el.innerHTML = ''; return; }
    el.innerHTML = `<strong>${n} sélectionnés</strong>
      ${statusField(this.module) && can(this.module, 'update') ? `<button type="button" class="btn secondary sm" data-cmd="record.status">${icon('tag', 14)} Statut</button>` : ''}
      ${can(this.module, 'export') ? `<button type="button" class="btn secondary sm" data-cmd="file.csv">${icon('sheet', 14)} Exporter</button>` : ''}
      <button type="button" class="btn secondary sm" data-cmd="file.print">${icon('printer', 14)} Imprimer</button>
      ${can(this.module, 'cancel') ? `<button type="button" class="btn secondary sm danger-text" data-cmd="record.cancel">${icon('ban', 14)} Supprimer</button>` : ''}
      <button type="button" class="icon-btn" data-act="clearsel" title="Désélectionner">${icon('x', 14)}</button>`;
  }

  renderFilters() {
    const form = $('[data-filters]', this.el);
    const fields = this.defs().fields.filter((f) => f.filterable && !(this.cfg.preset && f.name in this.cfg.preset));
    const v = this.state.filters;
    form.innerHTML = fields.map((f) => {
      const cur = v[f.name];
      if (f.type === 'enum') return `<label>${esc(f.name)}<select data-f="${esc(f.name)}"><option value="">Tous</option>${f.options.map((o) => `<option ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      if (f.type === 'date' || f.type === 'number') {
        const t = f.type === 'date' ? 'date' : 'number';
        return `<label>${esc(f.name)}<span class="range"><input type="${t}" data-f="${esc(f.name)}" data-r="from" value="${esc(cur?.from ?? '')}" aria-label="${esc(f.name)} à partir de"><span>→</span><input type="${t}" data-f="${esc(f.name)}" data-r="to" value="${esc(cur?.to ?? '')}" aria-label="${esc(f.name)} jusqu’à"></span></label>`;
      }
      if (f.type === 'longtext') return '';
      return `<label>${esc(f.name)}<input type="text" data-f="${esc(f.name)}" value="${esc(cur ?? '')}" maxlength="100"></label>`;
    }).join('') + `<div class="filters-actions"><button type="button" class="btn secondary sm" data-act="clearfilters">Effacer les filtres</button></div>`;
  }

  readFilters() {
    const f = {};
    for (const el of $$('[data-f]', this.el)) {
      const k = el.dataset.f;
      if (el.dataset.r) { if (el.value) { f[k] = f[k] || {}; f[k][el.dataset.r] = el.value; } } else if (el.value) f[k] = el.value;
    }
    this.state.filters = f;
    this.state.offset = 0;
    this.load();
  }

  select(id, { toggle = false, range = false } = {}) {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (range && this.focusIdx >= 0) {
      const [a, b] = [Math.min(idx, this.focusIdx), Math.max(idx, this.focusIdx)];
      for (let i = a; i <= b; i++) this.selected.add(this.rows[i].id);
    } else if (toggle) {
      if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
    } else {
      this.selected = new Set([id]);
    }
    this.focusIdx = idx;
    this.syncSelection();
    emit('context-changed');
  }

  /** Met à jour la sélection sans reconstruire le tableau (préserve le double-clic et le défilement). */
  syncSelection() {
    for (const tr of this.el.querySelectorAll('tbody tr[data-id]')) {
      const on = this.selected.has(tr.dataset.id);
      tr.classList.toggle('sel', on);
      tr.classList.toggle('focus', this.rows[this.focusIdx]?.id === tr.dataset.id);
      const cb = tr.querySelector('[data-sel]');
      if (cb) cb.checked = on;
    }
    const all = this.el.querySelector('[data-all]');
    if (all) all.checked = this.rows.length > 0 && this.rows.every((r) => this.selected.has(r.id));
    this.renderPager();
    this.renderBulk();
  }

  onClick(e) {
    const cmd = e.target.closest('[data-cmd]');
    if (cmd) { import('../core/commands.js').then((m) => m.run(cmd.dataset.cmd)); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'filters') return this.exec('view.filters');
    if (act === 'columns') return this.exec('view.columns');
    if (act === 'clearfilters') { this.state.filters = {}; this.renderFilters(); this.state.offset = 0; return this.load(); }
    if (act === 'clearsel') { this.selected.clear(); this.syncSelection(); return emit('context-changed'); }
    const un = e.target.closest('[data-unfilter]');
    if (un) { delete this.state.filters[un.dataset.unfilter]; this.renderFilters(); this.state.offset = 0; return this.load(); }
    const pg = e.target.closest('[data-page]');
    if (pg) {
      const size = this.pageSize();
      const last = Math.max(0, Math.floor((this.total - 1) / size) * size);
      this.state.offset = { first: 0, prev: Math.max(0, this.state.offset - size), next: Math.min(last, this.state.offset + size), last }[pg.dataset.page];
      return this.load();
    }
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      if (this.state.sort !== k) { this.state.sort = k; this.state.dir = 'asc'; } else if (this.state.dir === 'asc') this.state.dir = 'desc'; else { this.state.sort = ''; this.state.dir = 'desc'; }
      this.state.offset = 0;
      return this.load();
    }
    if (e.target.matches('[data-all]')) {
      if (e.target.checked) this.rows.forEach((r) => this.selected.add(r.id)); else this.selected.clear();
      this.syncSelection();
      return emit('context-changed');
    }
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    // Double-clic : e.detail survit à un rechargement de la liste entre les deux clics
    if (e.detail === 2 && !e.target.matches('[data-sel]')) { this.selected = new Set([tr.dataset.id]); this.syncSelection(); this.exec('record.open'); return; }
    this.select(tr.dataset.id, { toggle: e.target.matches('[data-sel]') || e.ctrlKey || e.metaKey, range: e.shiftKey });
  }

  onContextMenu(e) {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    e.preventDefault();
    if (!this.selected.has(tr.dataset.id)) this.select(tr.dataset.id);
    const extra = this.module === 'transport' ? ['transport.vehicle', 'transport.driver', 'transport.order'] : this.module === 'invoices' ? ['invoice.print'] : [];
    showContextMenu(e.clientX, e.clientY, ['record.open', 'record.edit', 'record.duplicate', '-', 'record.status', 'record.validate', ...extra, '-', 'file.print', 'file.csv', '-', 'record.cancel']);
  }

  onKey(e) {
    if (!this.rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = Math.max(0, Math.min(this.rows.length - 1, this.focusIdx + (e.key === 'ArrowDown' ? 1 : -1)));
      this.select(this.rows[i].id, { range: e.shiftKey });
      $('tr.focus', this.el)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); this.exec('record.open'); }
    else if (e.key === ' ' && this.focusIdx >= 0) { e.preventDefault(); this.select(this.rows[this.focusIdx].id, { toggle: true }); }
  }

  labelFor(id) {
    if (id === 'record.new') return this.cfg.newLabel;
    if (id === 'record.validate' && VALIDATED_STATUS[this.module]) return 'Valider';
    return null;
  }
  toolbar() { return this.cfg.toolbar; }

  supports(id) {
    const n = this.selected.size;
    const m = this.module;
    switch (id) {
      case 'record.new': return can(m, 'create');
      case 'record.open': return n === 1;
      case 'record.edit': case 'record.duplicate': return n === 1 && can(m, id === 'record.edit' ? 'update' : 'create');
      case 'record.status': return n >= 1 && !!statusField(m) && can(m, 'update');
      case 'record.validate': return n >= 1 && !!VALIDATED_STATUS[m] && can(m, 'validate');
      case 'record.cancel': return n >= 1 && can(m, 'cancel');
      case 'file.print': case 'file.pdf': return can(m, 'print') || can(m, 'read');
      case 'file.csv': return can(m, 'export');
      case 'view.filters': case 'view.columns': case 'view.refresh': case 'edit.find': return true;
      case 'edit.selectAll': return this.rows.length > 0;
      case 'edit.deselect': return n > 0;
      case 'transport.vehicle': case 'transport.driver': return m === 'transport' && n === 1 && can(m, 'update');
      case 'transport.order': return m === 'transport' && n === 1;
      case 'invoice.print': return m === 'invoices' && n === 1;
      default: return false;
    }
  }

  async exec(id) {
    const m = this.module;
    const one = this.single();
    const sel = this.selectedRows();
    switch (id) {
      case 'record.new': return this.ws.open({ kind: 'record', mode: 'new', module: m, viewKey: this.cfg.key, values: { ...(this.cfg.preset || {}) } });
      case 'record.open': return one && this.ws.open({ id: `rec:${m}:${one.id}`, kind: 'record', mode: 'view', module: m, recordId: one.id, viewKey: this.cfg.key });
      case 'record.edit': {
        if (!one) return;
        const t = this.ws.open({ id: `rec:${m}:${one.id}`, kind: 'record', mode: 'edit', module: m, recordId: one.id, viewKey: this.cfg.key });
        return t && t.view.setMode?.('edit');
      }
      case 'record.duplicate': {
        if (!one) return;
        const values = { ...one.data };
        const ref = this.defs().referenceField;
        if (ref) values[ref] = '';
        const sf = statusField(m);
        if (sf && LOCKED_STATUSES.includes(values[sf])) delete values[sf];
        return this.ws.open({ kind: 'record', mode: 'new', module: m, viewKey: this.cfg.key, values });
      }
      case 'record.status': return changeStatus(m, sel);
      case 'record.validate': return changeStatus(m, sel, VALIDATED_STATUS[m]);
      case 'record.cancel': { const done = await cancelRecords(m, sel); if (done) this.selected.clear(); return; }
      case 'file.print': case 'file.pdf': {
        const rows = sel.length ? sel : this.rows;
        return printHtml(tableDoc(this.title(), this.columns(), rows, sel.length ? `${sel.length} enregistrement(s) sélectionné(s)` : this.describeQuery()), { pdf: id === 'file.pdf' });
      }
      case 'file.csv': {
        if (sel.length) {
          const fields = this.defs().fields.map((f) => f.name);
          const csv = '﻿' + [fields.map(csvCell).join(';'), ...sel.map((r) => fields.map((f) => csvCell(r.data[f])).join(';'))].join('\r\n');
          download(`raha_${this.cfg.key}_selection.csv`, csv, 'text/csv;charset=utf-8');
        } else {
          download(`raha_${this.cfg.key}.csv`, await fetchBlob(`/api/records/${m}/export.csv`));
        }
        return emit('operation', { message: `Export CSV — ${this.title()}` });
      }
      case 'view.filters':
        this.state.showFilters = !this.state.showFilters;
        $('[data-filters]', this.el).hidden = !this.state.showFilters;
        if (this.state.showFilters) $('[data-filters] [data-f]', this.el)?.focus();
        return emit('tab-changed');
      case 'view.columns': return this.chooseColumns();
      case 'view.refresh': return this.load();
      case 'edit.find': { const q = $('[data-q]', this.el); q.focus(); return q.select(); }
      case 'edit.selectAll': this.rows.forEach((r) => this.selected.add(r.id)); this.syncSelection(); return emit('context-changed');
      case 'edit.deselect': this.selected.clear(); this.syncSelection(); return emit('context-changed');
      case 'transport.vehicle': {
        const v = await pickRelated('Véhicule', 'fleet', 'Immatriculation', null, one.data['Véhicule']);
        if (v) await bulk([one], (r) => patch(`/api/records/transport/${r.id}`, { version: r.version, data: { 'Véhicule': v } }), `Véhicule ${v} affecté`, m);
        return;
      }
      case 'transport.driver': {
        const v = await pickRelated('Chauffeur', 'staff', 'Nom complet', null, one.data.Chauffeur);
        if (v) await bulk([one], (r) => patch(`/api/records/transport/${r.id}`, { version: r.version, data: { Chauffeur: v } }), `Chauffeur ${v} affecté`, m);
        return;
      }
      case 'transport.order': return printHtml(missionOrderDoc(one));
      case 'invoice.print': return printHtml(invoiceDoc(one));
      default: return undefined;
    }
  }

  describeQuery() {
    const parts = [];
    if (this.state.q) parts.push(`Recherche : « ${this.state.q} »`);
    for (const [k, v] of Object.entries(this.state.filters)) parts.push(`${k} : ${typeof v === 'object' ? `${v.from || '…'} → ${v.to || '…'}` : v}`);
    return parts.join(' · ');
  }

  async chooseColumns() {
    const all = COLUMNS[this.module];
    const vis = new Set(this.columns().map((c) => c.key));
    const r = await dialog({
      title: 'Colonnes affichées',
      body: `<div class="col-choice">${all.map((c) => `<label><input type="checkbox" value="${esc(c.key)}" ${vis.has(c.key) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</div>`,
      actions: [{ label: 'Rétablir par défaut', value: 'reset', secondary: true }, { label: 'Annuler', value: null, secondary: true }, { label: 'Appliquer', value: (el) => $$('input:checked', el).map((i) => i.value) }],
    });
    if (r === null) return;
    const columns = { ...prefs().columns };
    if (r === 'reset' || !r.length) delete columns[this.cfg.key]; else columns[this.cfg.key] = r;
    setPrefs({ columns });
  }

  panelContext() {
    return { kind: 'list', module: this.module, viewKey: this.cfg.key, record: this.single(), selection: this.selected.size, total: this.total, loadedAt: this.loadedAt };
  }
  status() {
    const s = this.selected.size;
    return `${this.title()} · ${this.total} enregistrement(s)${s ? ` · ${s} sélectionné(s)` : ''}${this.state.sort ? ` · tri : ${this.state.sort} ${this.state.dir === 'asc' ? '↑' : '↓'}` : ''}`;
  }
}

export function pillClass(v) {
  if (['Annulé', 'Annulée', 'Hors service', 'Dépense', 'Inactif'].includes(v)) return 'gray';
  if (['En attente', 'Brouillon', 'En maintenance', 'Payée partiellement', 'En congé'].includes(v)) return 'orange';
  if (['Validé', 'Validée', 'Payée', 'Clôturé'].includes(v)) return 'green';
  return '';
}
