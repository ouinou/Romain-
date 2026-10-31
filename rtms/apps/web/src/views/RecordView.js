// Fiche d'un enregistrement : consultation, modification ou création.
// Formulaire organisé en sections, champs obligatoires signalés, listes et
// calendriers, recherche dans les référentiels, calculs automatiques, brouillon
// conservé tant que l'onglet est ouvert, confirmation avant validation.
import { emit, on } from '../core/bus.js';
import { ApiError, get, patch, post } from '../core/api.js';
import { $, dateFr, dateTimeFr, esc, money } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { can, session } from '../core/session.js';
import { LOCKED_STATUSES, LOOKUPS, MODULE_LABEL, SECTIONS, VALIDATED_STATUS, recordTitle, viewByKey } from '../config.js';
import { confirmDialog, dialog } from '../components/ModalManager.js';
import { invoiceDoc, invoiceLines, loadingDoc, missionOrderDoc, printHtml, recordDoc, waybillDoc } from '../components/PrintService.js';
import { cancelRecords, pillClass, statusField } from './ListView.js';

const lookupCache = new Map();
async function lookupValues(field) {
  const l = LOOKUPS[field];
  if (!l || !can(l[0])) return [];
  const key = JSON.stringify(l);
  if (!lookupCache.has(key)) {
    const qs = l[2] ? `&f=${encodeURIComponent(JSON.stringify(l[2]))}` : '';
    lookupCache.set(key, get(`/api/records/${l[0]}?limit=200&sort=${encodeURIComponent(l[1])}&dir=asc${qs}`)
      .then((r) => [...new Set(r.items.map((x) => x.data[l[1]]).filter(Boolean))]).catch(() => []));
    setTimeout(() => lookupCache.delete(key), 60_000);
  }
  return lookupCache.get(key);
}
on('data-changed', () => lookupCache.clear());

export class RecordView {
  constructor(tab, ws) {
    this.tab = tab;
    this.ws = ws;
    const d = tab.desc;
    this.module = d.module;
    this.viewKey = d.viewKey;
    this.mode = d.mode || 'view';
    this.recordId = d.recordId || null;
    this.record = null;
    this.values = { ...(d.values || {}) };
    this.initial = d.mode === 'new' ? { ...(d.initial || d.values || {}) } : null;
    this.errors = [];
    this.offs = [on('data-changed', (x) => {
      if (this.mode !== 'view' || !this.recordId) return;
      if (!x?.module || (x.module === this.module && (!x.id || x.id === this.recordId))) { this.stale = true; if (this.ws.active() === this.tab) this.loadRecord(); }
    })];
  }

  defs() { return session.defs[this.module]; }
  icon() { return viewByKey(this.viewKey)?.icon || 'pencil'; }
  title() {
    if (this.mode === 'new') return `${viewByKey(this.viewKey)?.newLabel || 'Nouvel enregistrement'}`;
    const t = this.record ? recordTitle(this.module, this.record) : this.missing ? 'Enregistrement introuvable' : 'Chargement…';
    return this.mode === 'edit' ? `${t} (modification)` : t;
  }
  isDirty() {
    if (this.mode === 'view') return false;
    const base = this.mode === 'new' ? this.initial : this.record?.data || {};
    const norm = (v) => (Array.isArray(v) ? JSON.stringify(v.map((l) => Object.fromEntries(Object.entries(l).map(([k, x]) => [k, String(x ?? '')])))) : String(v ?? ''));
    return this.defs().fields.some((f) => norm(this.values[f.name]) !== norm(base[f.name]));
  }
  serialize() {
    return { id: this.tab.id, kind: 'record', module: this.module, viewKey: this.viewKey, mode: this.mode, recordId: this.recordId, values: this.mode === 'view' ? undefined : this.values, initial: this.initial || undefined };
  }

  async mount(el) {
    this.el = el;
    el.innerHTML = '<div class="view record-view"><div class="empty">Chargement…</div></div>';
    el.addEventListener('input', (e) => this.onInput(e));
    el.addEventListener('change', (e) => this.onInput(e));
    el.addEventListener('submit', (e) => { e.preventDefault(); this.exec('form.save'); });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-addline]')) { this.materializeLines().push({ 'Désignation': '', 'Quantité': '1', 'Prix unitaire (FCFA)': '' }); this.rerenderLines(true); return; }
      const del = e.target.closest('[data-delline]');
      if (del) { this.materializeLines().splice(Number(del.dataset.delline), 1); this.rerenderLines(); return; }
      const c = e.target.closest('[data-cmd]');
      if (c) import('../core/commands.js').then((m) => m.run(c.dataset.cmd));
      const o = e.target.closest('[data-open-linked]');
      if (o) { const [mod, id] = o.dataset.openLinked.split(':'); this.ws.open({ id: `rec:${mod}:${id}`, kind: 'record', mode: 'view', module: mod, recordId: id, viewKey: viewByKey(this.viewKey)?.key }); }
    });
    if (this.recordId) await this.loadRecord(); else this.render();
  }

  async loadRecord() {
    try {
      this.record = await get(`/api/records/${this.module}/${this.recordId}`);
      if (this.mode === 'view' || !Object.keys(this.values).length) this.values = { ...this.record.data };
      this.stale = false;
      this.render();
    } catch (e) {
      this.missing = e.status === 404;
      $('.record-view', this.el).innerHTML = `<div class="err">${esc(e.status === 404 ? 'Cet enregistrement n’existe plus ou a été supprimé.' : e.message)}</div>`;
    }
    emit('tab-changed');
    emit('context-changed');
  }

  activate() { if (this.stale) this.loadRecord(); }
  refresh() { if (this.mode === 'view' || !this.isDirty()) return this.loadRecord(); return undefined; }
  invalidate() {}
  destroy() { this.offs.forEach((f) => f()); }

  setMode(mode) {
    if (mode === 'edit' && this.record) {
      const sf = statusField(this.module);
      if (sf && LOCKED_STATUSES.includes(this.record.status) && !can(this.module, 'validate')) {
        emit('toast', { type: 'error', message: 'Enregistrement validé : modification réservée aux profils habilités.' });
        return;
      }
      if (this.mode === 'view') this.values = { ...this.record.data };
    }
    this.mode = mode;
    this.errors = [];
    this.render();
    emit('tab-changed');
    emit('context-changed');
  }

  sections() {
    const fields = this.defs().fields;
    const used = new Set();
    const secs = (SECTIONS[this.module] || []).map(([title, names]) => {
      const fs = names.map((n) => fields.find((f) => f.name === n)).filter(Boolean);
      fs.forEach((f) => used.add(f.name));
      return [title, fs];
    });
    // Factures : l'ancienne saisie à une ligne est reprise dans l'éditeur de lignes
    if (this.module === 'invoices') ['Désignation', 'Quantité', 'Prix unitaire (FCFA)'].forEach((n) => used.add(n));
    const rest = fields.filter((f) => !used.has(f.name));
    if (rest.length) secs.push(['Autres informations', rest]);
    return secs;
  }

  render() {
    const root = $('.record-view', this.el);
    const r = this.record;
    const editing = this.mode !== 'view';
    const sf = statusField(this.module);
    const status = editing ? this.values[sf] : r?.status;
    root.innerHTML = `
      <div class="view-head">
        <h1>${icon(this.icon(), 20)} ${esc(this.title())}</h1>
        ${status ? `<span class="pill ${pillClass(status)}">${esc(status)}</span>` : ''}
        ${editing ? `<span class="hint">Les champs marqués <b class="req">*</b> sont obligatoires · Ctrl+S pour enregistrer</span>` : ''}
        <span class="spacer"></span>
        ${r ? `<span class="muted small">Créé le ${esc(dateTimeFr(r.createdAt))} · modifié le ${esc(dateTimeFr(r.updatedAt))} · version ${esc(r.version)}</span>` : ''}
      </div>
      ${this.errors.length ? `<div class="err"><strong>L’enregistrement a été refusé :</strong><ul>${this.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${this.stale && !editing ? '<div class="notice">Cet enregistrement a été modifié. <button type="button" class="link" data-cmd="view.refresh">Recharger</button></div>' : ''}
      <form class="record-form ${editing ? 'editing' : 'reading'}" novalidate>
        ${this.sections().map(([title, fields]) => `<fieldset class="fs"><legend>${esc(title)}</legend><div class="fs-grid">${fields.map((f) => this.fieldHtml(f, editing)).join('')}</div></fieldset>`).join('')}
        ${this.computedHtml()}
        ${editing ? `<div class="form-actions"><button type="button" class="btn secondary" data-cmd="form.cancelEdit">Annuler</button>${VALIDATED_STATUS[this.module] && can(this.module, 'validate') ? `<button type="button" class="btn secondary" data-cmd="record.validate">${icon('check', 15)} Enregistrer et valider</button>` : ''}<button type="submit" class="btn">${icon('save', 15)} Enregistrer</button></div>` : ''}
      </form>`;
    if (editing) this.attachLookups();
    const first = editing && $('input:not([readonly]),select,textarea', root);
    if (first && this.mode === 'new' && this.ws.active() === this.tab) first.focus();
  }

  /** Lignes affichées : format multi-lignes, ou ancienne saisie à une ligne. */
  currentLines() {
    if (Array.isArray(this.values.Lignes)) return this.values.Lignes;
    return invoiceLines(this.values).map((l) => ({ ...l }));
  }
  materializeLines() {
    if (!Array.isArray(this.values.Lignes)) {
      this.values.Lignes = this.currentLines();
      for (const k of ['Désignation', 'Quantité', 'Prix unitaire (FCFA)']) if (this.values[k] !== undefined) this.values[k] = '';
    }
    return this.values.Lignes;
  }

  linesHtml(editing) {
    const lines = this.currentLines();
    const rows = (editing && !lines.length ? [{}] : lines).map((l, i) => {
      const total = (Number(l['Quantité']) || 0) * (Number(l['Prix unitaire (FCFA)']) || 0);
      if (!editing) return `<tr><td class="c">${i + 1}</td><td>${esc(l['Désignation'])}</td><td class="num">${esc(money(l['Quantité']))}</td><td class="num">${esc(money(l['Prix unitaire (FCFA)']))}</td><td class="num">${esc(money(total))}</td></tr>`;
      return `<tr><td class="c">${i + 1}</td>
        <td><input data-line="${i}" data-k="Désignation" value="${esc(l['Désignation'] ?? '')}" maxlength="300" required aria-label="Désignation ligne ${i + 1}"></td>
        <td><input data-line="${i}" data-k="Quantité" type="number" step="any" min="0.0001" value="${esc(l['Quantité'] ?? '')}" required aria-label="Quantité ligne ${i + 1}"></td>
        <td><input data-line="${i}" data-k="Prix unitaire (FCFA)" type="number" step="any" min="0" value="${esc(l['Prix unitaire (FCFA)'] ?? '')}" required aria-label="Prix unitaire ligne ${i + 1}"></td>
        <td class="num" data-line-total="${i}">${esc(money(total))}</td>
        <td><button type="button" class="icon-btn" data-delline="${i}" title="Supprimer la ligne" aria-label="Supprimer la ligne ${i + 1}">${icon('x', 14)}</button></td></tr>`;
    }).join('');
    return `<div class="fv wide lines-box" data-lines><table class="lines"><thead><tr><th class="c">N°</th><th>Désignation</th><th class="num">Qté</th><th class="num">P. unitaire (FCFA)</th><th class="num">P. total</th>${editing ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">Aucune ligne.</td></tr>`}</tbody></table>
      ${editing ? `<button type="button" class="btn outline sm" data-addline>${icon('plus', 14)} Ajouter une ligne</button>` : ''}</div>`;
  }

  fieldHtml(f, editing) {
    if (f.type === 'lines') return this.linesHtml(editing);
    const v = this.values[f.name];
    const wide = f.type === 'longtext' ? 'wide' : '';
    const errored = this.errors.some((e) => e.startsWith(f.name));
    const label = `<span class="fl">${esc(f.name)}${f.required ? ' <b class="req" aria-hidden="true">*</b>' : ''}</span>`;
    if (!editing) {
      const shown = v === undefined || v === null || v === '' ? '—' : f.type === 'date' ? dateFr(v) : f.type === 'number' ? money(v) : v;
      return `<div class="fv ${wide}">${label}<span class="fval">${esc(shown)}</span></div>`;
    }
    const req = f.required ? 'required aria-required="true"' : '';
    const name = `name="${esc(f.name)}"`;
    const cls = errored ? 'class="invalid"' : '';
    let input;
    if (f.type === 'enum') input = `<select ${name} ${req} ${cls}>${f.required ? '' : '<option value=""></option>'}${f.options.map((o) => `<option ${o === v ? 'selected' : ''} ${LOCKED_STATUSES.includes(o) && !can(this.module, 'validate') ? 'disabled' : ''}>${esc(o)}</option>`).join('')}${v && !f.options.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
    else if (f.type === 'date') input = `<input type="date" ${name} value="${esc(v ?? '')}" ${req} ${cls}>`;
    else if (f.type === 'number') input = `<input type="number" step="any" ${name} value="${esc(v ?? '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${req} ${cls}>`;
    else if (f.type === 'longtext') input = `<textarea ${name} rows="3" maxlength="4000" ${req} ${cls}>${esc(v ?? '')}</textarea>`;
    else input = `<input type="text" ${name} value="${esc(v ?? '')}" maxlength="500" ${LOOKUPS[f.name] ? `list="dl-${this.tab.id}-${esc(f.name.replace(/\W/g, ''))}" autocomplete="off"` : ''} ${req} ${cls}>`;
    const preset = viewByKey(this.viewKey)?.preset;
    const locked = preset && f.name in preset && this.mode === 'new' ? 'locked' : '';
    return `<label class="fv ${wide} ${locked}">${label}${input}</label>`;
  }

  rerenderLines(focusLast = false) {
    const box = $('[data-lines]', this.el);
    if (!box) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.linesHtml(true);
    box.replaceWith(tmp.firstElementChild);
    this.refreshComputed();
    this.ws.persist();
    emit('tab-title');
    if (focusLast) { const ins = this.el.querySelectorAll('[data-k="Désignation"]'); ins[ins.length - 1]?.focus(); }
  }

  async attachLookups() {
    for (const f of this.defs().fields) {
      if (!LOOKUPS[f.name]) continue;
      const values = await lookupValues(f.name);
      const id = `dl-${this.tab.id}-${f.name.replace(/\W/g, '')}`;
      let dl = document.getElementById(id);
      if (!dl) { dl = document.createElement('datalist'); dl.id = id; this.el.appendChild(dl); }
      dl.innerHTML = values.map((x) => `<option value="${esc(x)}"></option>`).join('');
    }
  }

  computedHtml() {
    const v = this.values;
    if (this.module === 'invoices') {
      const ht = this.currentLines().reduce((sum, l) => sum + (Number(l['Quantité']) || 0) * (Number(l['Prix unitaire (FCFA)']) || 0), 0);
      const tax = (ht * (Number(v['Taxe (%)']) || 0)) / 100;
      const r2 = (x) => Math.round(x * 100) / 100;
      const server = this.mode === 'view' && this.record?.computed;
      const avance = Number(v['Avance (FCFA)']) || 0;
      const c = server || { totalHT: r2(ht), tax: r2(tax), totalTTC: r2(ht + tax), avance, reste: r2(ht + tax - avance) };
      return `<fieldset class="fs computed"><legend>Calcul ${server ? '(serveur)' : 'automatique'}</legend><div class="totals" data-computed>
        <span>Total HT</span><strong>${esc(money(c.totalHT))} FCFA</strong><span>Taxe</span><strong>${esc(money(c.tax))} FCFA</strong><span>Total</span><strong class="ttc">${esc(money(c.totalTTC))} FCFA</strong>
        <span>Avance</span><strong>${esc(money(c.avance ?? 0))} FCFA</strong><span>Reste</span><strong class="${(c.reste ?? 0) < 0 ? 'neg' : ''}">${esc(money(c.reste ?? c.totalTTC))} FCFA</strong>
        ${server && c.totalEnLettres ? `<span>En lettres</span><strong class="words">${esc(c.totalEnLettres)}</strong>` : ''}</div>
        ${server ? '' : '<p class="muted small">Montant en lettres et totaux définitifs calculés par le serveur à l’enregistrement.</p>'}</fieldset>`;
    }
    if (this.module === 'commerce' && v['Prix de vente'] !== undefined && v['Prix d’achat'] !== undefined && v['Prix de vente'] !== '' && v['Prix d’achat'] !== '') {
      const m = Number(v['Prix de vente']) - Number(v['Prix d’achat']);
      const pct = Number(v['Prix d’achat']) ? (m / Number(v['Prix d’achat'])) * 100 : 0;
      const low = v['Quantité en stock'] !== '' && v['Stock minimum'] !== '' && Number(v['Quantité en stock']) <= Number(v['Stock minimum']);
      return `<fieldset class="fs computed"><legend>Calcul automatique</legend><div class="totals" data-computed><span>Marge unitaire</span><strong>${esc(money(m))} FCFA</strong><span>Taux de marge</span><strong>${esc(pct.toFixed(1))} %</strong></div>${low ? '<p class="warn-text">Stock au niveau du seuil minimum ou en dessous.</p>' : ''}</fieldset>`;
    }
    return '';
  }

  onInput(e) {
    const t = e.target;
    if (this.mode === 'view' || !t.closest('.record-form')) return;
    if (t.dataset.line !== undefined) {
      const lines = this.materializeLines();
      const i = Number(t.dataset.line);
      lines[i] = { ...(lines[i] || {}), [t.dataset.k]: t.value };
      const cell = $(`[data-line-total="${i}"]`, this.el);
      if (cell) cell.textContent = money((Number(lines[i]['Quantité']) || 0) * (Number(lines[i]['Prix unitaire (FCFA)']) || 0));
      this.refreshComputed();
      this.ws.persist();
      emit('tab-title');
      return;
    }
    if (!t.name) return;
    this.values[t.name] = t.value;
    t.classList.remove('invalid');
    this.refreshComputed();
    if (t.name === statusField(this.module)) { const p = $('.view-head .pill', this.el); if (p) { p.textContent = t.value; p.className = `pill ${pillClass(t.value)}`; } }
    this.ws.persist();
    emit('tab-title');
  }

  refreshComputed() {
    const box = $('[data-computed]', this.el);
    if (box) { const tmp = document.createElement('div'); tmp.innerHTML = this.computedHtml(); const nb = $('[data-computed]', tmp); if (nb) box.replaceWith(nb); }
  }

  payload() {
    const data = {};
    for (const f of this.defs().fields) {
      const v = this.values[f.name];
      if (f.type === 'lines') {
        if (Array.isArray(v) && v.length) data[f.name] = v.map((l) => ({ 'Désignation': String(l['Désignation'] ?? '').trim(), 'Quantité': String(l['Quantité'] ?? ''), 'Prix unitaire (FCFA)': String(l['Prix unitaire (FCFA)'] ?? '') }));
        continue;
      }
      if (v === undefined || v === null || String(v).trim() === '') continue;
      data[f.name] = String(v).trim();
    }
    return data;
  }

  async save({ validate = false } = {}) {
    const form = $('.record-form', this.el);
    if (!form.reportValidity()) return false;
    // Les listes laissées sur leur valeur par défaut n'émettent aucun événement : on relit le formulaire
    for (const el of form.querySelectorAll('[name]')) this.values[el.name] = el.value;
    if (this.module === 'invoices' && form.querySelector('[data-line]')) {
      const lines = this.materializeLines();
      for (const inp of form.querySelectorAll('[data-line]')) { const i = Number(inp.dataset.line); lines[i] = { ...(lines[i] || {}), [inp.dataset.k]: inp.value }; }
    }
    const sf = statusField(this.module);
    const data = this.payload();
    if (validate) data[sf] = VALIDATED_STATUS[this.module];
    const newStatus = data[sf];
    const oldStatus = this.record?.status;
    if (newStatus && LOCKED_STATUSES.includes(newStatus) && newStatus !== oldStatus) {
      const ok = await confirmDialog(`Enregistrer avec le statut « ${newStatus} » ?`, { title: 'Confirmation avant validation', ok: 'Valider', detail: 'L’enregistrement sera figé : seuls les profils habilités pourront encore le modifier. L’opération est tracée dans le journal d’audit.' });
      if (!ok) return false;
    }
    try {
      let saved;
      if (this.mode === 'new') {
        saved = await post(`/api/records/${this.module}`, { data });
      } else {
        // PATCH : on envoie aussi les champs vidés (chaîne vide = suppression de la valeur)
        const full = { ...data };
        for (const f of this.defs().fields) if (!(f.name in full) && this.record.data[f.name] !== undefined) full[f.name] = '';
        saved = await patch(`/api/records/${this.module}/${this.recordId}`, { version: this.record.version, data: full });
      }
      const created = this.mode === 'new';
      this.record = saved;
      this.recordId = saved.id;
      this.values = { ...saved.data };
      this.errors = [];
      this.mode = 'view';
      if (created) this.ws.rekey(this.tab, `rec:${this.module}:${saved.id}`);
      this.render();
      emit('data-changed', { module: this.module, id: saved.id });
      emit('operation', { message: `${created ? 'Création' : 'Modification'} — ${MODULE_LABEL[this.module]} ${recordTitle(this.module, saved)}` });
      emit('toast', { type: 'success', message: `${MODULE_LABEL[this.module]} « ${recordTitle(this.module, saved)} » enregistré(e).` });
      emit('tab-changed');
      emit('context-changed');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.details?.currentVersion) {
        const reload = await confirmDialog('Cet enregistrement a été modifié par un autre utilisateur pendant votre saisie.', { title: 'Conflit de modification', ok: 'Recharger la version actuelle', detail: 'Vos modifications non enregistrées seront perdues. Notez-les avant de recharger si nécessaire.' });
        if (reload) { this.mode = 'view'; await this.loadRecord(); }
        return false;
      }
      this.errors = Array.isArray(e.body?.details) ? e.body.details : [e.message];
      this.render();
      return false;
    }
  }

  toolbar() {
    if (this.mode === 'view') {
      const extra = this.module === 'transport' ? ['transport.order', 'transport.waybill', 'transport.loading'] : this.module === 'invoices' ? ['invoice.print'] : [];
      return [['record.new'], ['record.edit', 'record.duplicate'], ['record.validate'], [...extra, 'file.print', 'file.pdf'], ['record.cancel'], ['view.refresh']];
    }
    return [['form.save', 'record.validate', 'form.cancelEdit'], ['view.refresh']];
  }
  labelFor(id) {
    if (id === 'record.new') return viewByKey(this.viewKey)?.newLabel;
    if (id === 'record.validate' && this.mode !== 'view') return 'Enregistrer et valider';
    return null;
  }

  supports(id) {
    const m = this.module;
    const r = this.record;
    const editing = this.mode !== 'view';
    switch (id) {
      case 'record.new': return can(m, 'create');
      case 'form.save': return editing;
      case 'form.cancelEdit': return editing;
      case 'record.edit': return !editing && !!r && can(m, 'update');
      case 'record.duplicate': return !editing && !!r && can(m, 'create');
      case 'record.validate': return !!VALIDATED_STATUS[m] && can(m, 'validate') && (editing || (r && r.status !== VALIDATED_STATUS[m]));
      case 'record.cancel': return !editing && !!r && can(m, 'cancel');
      case 'file.print': case 'file.pdf': return !editing && !!r;
      case 'transport.order': case 'transport.waybill': case 'transport.loading': return !editing && !!r && m === 'transport';
      case 'invoice.print': return !editing && !!r && m === 'invoices';
      case 'view.refresh': return !!this.recordId;
      default: return false;
    }
  }

  async exec(id) {
    const m = this.module;
    switch (id) {
      case 'record.new': return this.ws.open({ kind: 'record', mode: 'new', module: m, viewKey: this.viewKey, values: { ...(viewByKey(this.viewKey)?.preset || {}) } });
      case 'form.save': return this.save();
      case 'record.validate':
        if (this.mode !== 'view') return this.save({ validate: true });
        this.setMode('edit');
        return this.save({ validate: true });
      case 'form.cancelEdit':
        if (this.isDirty() && !(await confirmDialog('Abandonner les modifications en cours ?', { ok: 'Abandonner', danger: true }))) return undefined;
        if (this.mode === 'new') return this.ws.close(this.tab.id, { force: true });
        this.values = { ...this.record.data };
        return this.setMode('view');
      case 'record.edit': return this.setMode('edit');
      case 'record.duplicate': {
        const values = { ...this.record.data };
        const ref = this.defs().referenceField;
        if (ref) values[ref] = '';
        const sf = statusField(m);
        if (sf && LOCKED_STATUSES.includes(values[sf])) delete values[sf];
        return this.ws.open({ kind: 'record', mode: 'new', module: m, viewKey: this.viewKey, values });
      }
      case 'record.cancel':
        if (await cancelRecords(m, [this.record])) return this.ws.close(this.tab.id, { force: true });
        return undefined;
      case 'file.print': case 'file.pdf': return printHtml(recordDoc(`${MODULE_LABEL[m]} — ${recordTitle(m, this.record)}`, this.defs().fields, this.record), { pdf: id === 'file.pdf' });
      case 'transport.order': return printHtml(missionOrderDoc(this.record));
      case 'transport.waybill': return printHtml(waybillDoc(this.record));
      case 'transport.loading': return printHtml(loadingDoc(this.record));
      case 'invoice.print': return printHtml(invoiceDoc(this.record));
      case 'view.refresh':
        if (this.isDirty() && !(await confirmDialog('Recharger et perdre les modifications en cours ?', { ok: 'Recharger', danger: true }))) return undefined;
        this.mode = this.mode === 'new' ? 'new' : 'view';
        return this.loadRecord();
      default: return undefined;
    }
  }

  panelContext() { return { kind: 'record', module: this.module, viewKey: this.viewKey, record: this.record, mode: this.mode, dirty: this.isDirty() }; }
  status() { return `${MODULE_LABEL[this.module]} · ${this.mode === 'new' ? 'création' : this.mode === 'edit' ? 'modification' : 'consultation'}${this.isDirty() ? ' · modifications non enregistrées' : ''}`; }
}

export async function showRecordDialog(module, id) {
  const r = await get(`/api/records/${module}/${id}`);
  const f = session.defs[module].fields;
  return dialog({ title: recordTitle(module, r), body: `<table class="kv">${f.map((x) => `<tr><th>${esc(x.name)}</th><td>${esc(r.data[x.name] ?? '—')}</td></tr>`).join('')}</table>`, actions: [{ label: 'Fermer', value: null }] });
}
