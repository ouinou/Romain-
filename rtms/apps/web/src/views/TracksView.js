// Suivi GPS des trajets (parc automobile) : liste filtrée par véhicule et par période,
// tracé du trajet choisi, chiffres calculés par le serveur, import de traces GPX/KML/CSV.
import { emit, on } from '../core/bus.js';
import { fetchBlob, get, patch, post } from '../core/api.js';
import { $, download, esc, h } from '../core/dom.js';
import { readTrackFile } from '../core/gpsParse.js';
import { icon } from '../core/icons.js';
import { can } from '../core/session.js';
import { dayFr, fmtDuration, fmtKm, osmLink, timeFr, trackSvg } from '../components/GpsMap.js';
import { dialog, formDialog } from '../components/ModalManager.js';
import { gpsDoc, printHtml } from '../components/PrintService.js';

const SOURCE = { gpx: 'Fichier GPX', kml: 'Fichier KML', csv: 'Fichier CSV', telephone: 'Téléphone' };
const avgKmh = (t) => (t.movingS > 0 ? (t.distanceM / t.movingS) * 3.6 : 0);
const kmh = (v) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} km/h`;

async function loadOptions(module, field, extra = '') {
  try {
    const r = await get(`/api/records/${module}?limit=200&sort=${encodeURIComponent(field)}&dir=asc${extra}`);
    return r.items.map((x) => ({ id: x.id, label: x.data[field] || x.reference || '—', data: x.data }));
  } catch { return []; }
}

/** Fenêtre d'import d'un trajet. Renvoie l'id du trajet créé, ou null. */
export async function importTrackDialog(vehicleId = '') {
  const [vehicles, missions, staff] = await Promise.all([
    loadOptions('fleet', 'Immatriculation'),
    can('transport') ? loadOptions('transport', 'Référence mission') : Promise.resolve([]),
    can('staff') ? loadOptions('staff', 'Nom complet') : Promise.resolve([]),
  ]);
  if (!vehicles.length) { emit('toast', { type: 'error', message: 'Ajoutez d’abord le véhicule dans le parc automobile.' }); return null; }
  const body = h(`<form class="form dlg-form" novalidate>
    <p class="dlg-detail wide">Fichier enregistré par le traceur GPS du véhicule ou par un téléphone (application d’enregistrement de trajets) : <b>.gpx</b> conseillé, <b>.kml</b> ou <b>.csv</b> acceptés. Les distances et les arrêts sont calculés par le poste principal.</p>
    <label class="wide">Véhicule<select name="vehicleId" required>${vehicles.map((v) => `<option value="${esc(v.id)}" ${v.id === vehicleId ? 'selected' : ''}>${esc(v.label)} — ${esc(v.data['Marque / modèle'] || '')}</option>`).join('')}</select></label>
    <label class="wide">Fichier du trajet<input name="file" type="file" accept=".gpx,.kml,.csv,.txt,application/gpx+xml" required></label>
    <label class="wide">Chauffeur<input name="driver" list="gps-staff" maxlength="120" autocomplete="off"><datalist id="gps-staff">${staff.map((s) => `<option value="${esc(s.label)}">`).join('')}</datalist></label>
    ${missions.length ? `<label class="wide">Mission de transport (facultatif)<select name="missionId"><option value="">— Aucune —</option>${missions.slice().reverse().map((m) => `<option value="${esc(m.id)}">${esc(m.label)} · ${esc(m.data['Départ'] || '')} → ${esc(m.data.Destination || '')}</option>`).join('')}</select></label>` : ''}
    <label class="wide">Libellé (facultatif)<input name="label" maxlength="200" placeholder="ex. Douala – Yaoundé, livraison SOCAVER"></label>
    <p class="err wide" data-err hidden></p>
  </form>`);
  let created = null;
  await dialog({
    title: 'Importer un trajet GPS', body, width: 520,
    actions: [{ label: 'Annuler', value: null, secondary: true }, {
      label: 'Importer',
      validate: async (el) => {
        const f = $('form', el);
        const err = $('[data-err]', el);
        err.hidden = true;
        if (!f.reportValidity()) return false;
        const file = f.file.files[0];
        try {
          const { source, points, ignored } = await readTrackFile(file);
          const r = await post('/api/gps/tracks', { vehicleId: f.vehicleId.value, missionId: f.missionId?.value || null, driver: f.driver.value.trim() || null, label: f.label.value.trim() || null, source, fileName: file.name.slice(0, 200), points });
          created = r.id;
          const extra = [r.dropped ? `${r.dropped} position(s) aberrante(s) écartée(s)` : '', ignored ? `trace allégée de ${ignored} positions` : ''].filter(Boolean).join(', ');
          emit('toast', { type: 'success', message: `Trajet importé : ${fmtKm(r.distanceM)}, ${fmtDuration(r.movingS)} de roulage, ${r.stops} arrêt(s)${extra ? ` (${extra})` : ''}.` });
          emit('data-changed', { module: 'gps' });
          return true;
        } catch (e) {
          err.textContent = [e.message, ...(Array.isArray(e.body?.details) ? e.body.details : [])].filter((x, i, a) => a.indexOf(x) === i).join(' — ');
          err.hidden = false;
          return false;
        }
      },
      value: () => created,
    }],
  });
  return created;
}

export class TracksView {
  constructor(tab, ws) {
    this.tab = tab; this.ws = ws;
    const st = tab.desc.state || {};
    this.filter = { vehicle: st.vehicle || '', from: st.from || '', to: st.to || '' };
    this.selectedId = st.selected || null;
    this.rows = []; this.detail = null;
    this.offs = [on('data-changed', (x) => { if (!x?.module || x.module === 'gps' || x.module === 'fleet') { this.stale = true; if (this.ws.active() === this.tab) this.load(); } })];
  }
  title() { const v = this.vehicles?.find((x) => x.id === this.filter.vehicle); return v ? `Trajets GPS — ${v.label}` : 'Suivi GPS des trajets'; }
  icon() { return 'route'; }
  serialize() { return { id: this.tab.id, kind: 'tracks', viewKey: 'tracks', state: { ...this.filter, selected: this.selectedId } }; }
  setVehicle(id) { this.filter.vehicle = id || ''; this.selectedId = null; this.render(); this.load(); }

  async mount(el) {
    this.el = el;
    el.innerHTML = '<div class="view tracks-view"><div class="empty">Chargement…</div></div>';
    el.addEventListener('change', (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) { this.filter[f.dataset.filter] = f.value; this.selectedId = null; this.load(); emit('tab-changed'); }
    });
    el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-track]');
      if (row) { this.select(row.dataset.track); return; }
      const c = e.target.closest('[data-cmd]');
      if (c) import('../core/commands.js').then((m) => m.run(c.dataset.cmd));
      const o = e.target.closest('[data-open-vehicle]');
      if (o) this.ws.open({ id: `rec:fleet:${o.dataset.openVehicle}`, kind: 'record', mode: 'view', module: 'fleet', recordId: o.dataset.openVehicle, viewKey: 'fleet' });
    });
    el.addEventListener('keydown', (e) => {
      const row = e.target.closest('[data-track]');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.select(row.dataset.track); }
    });
    this.vehicles = await loadOptions('fleet', 'Immatriculation');
    this.render();
    await this.load();
  }

  render() {
    const root = $('.tracks-view', this.el);
    root.innerHTML = `
      <div class="view-head"><h1>${icon('route', 20)} ${esc(this.title())}</h1>
        <span class="muted small">Traces des traceurs GPS ou des téléphones des chauffeurs, rattachées aux véhicules du parc.</span></div>
      <div class="gps-filters">
        <label>Véhicule<select data-filter="vehicle"><option value="">Tous les véhicules</option>${(this.vehicles || []).map((v) => `<option value="${esc(v.id)}" ${v.id === this.filter.vehicle ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label>Du<input type="date" data-filter="from" value="${esc(this.filter.from)}"></label>
        <label>Au<input type="date" data-filter="to" value="${esc(this.filter.to)}"></label>
        <span class="spacer"></span>
        ${can('fleet', 'update') ? `<button type="button" class="btn" data-cmd="gps.import">${icon('upload', 15)} Importer un trajet</button>` : ''}
      </div>
      <div class="gps-layout"><section class="panel gps-list" data-list><div class="empty">Chargement…</div></section><section class="panel gps-detail" data-detail></section></div>`;
    this.renderList(); this.renderDetail();
  }

  async load() {
    this.stale = false;
    const q = new URLSearchParams({ limit: '200' });
    for (const [k, v] of Object.entries(this.filter)) if (v) q.set(k, v);
    try {
      const r = await get(`/api/gps/tracks?${q}`);
      this.rows = r.rows; this.total = r.total; this.totals = r.totals; this.error = null;
    } catch (e) { this.rows = []; this.error = e.message; }
    if (this.selectedId && !this.rows.some((t) => t.id === this.selectedId)) this.selectedId = null;
    if (!this.selectedId && this.rows.length) this.selectedId = this.rows[0].id;
    this.renderList();
    await this.loadDetail();
    emit('tab-changed'); emit('context-changed');
  }

  renderList() {
    const box = $('[data-list]', this.el);
    if (!box) return;
    if (this.error) { box.innerHTML = `<div class="err">${esc(this.error)}</div>`; return; }
    if (!this.rows.length) {
      box.innerHTML = `<div class="empty">Aucun trajet ${this.filter.vehicle || this.filter.from || this.filter.to ? 'pour ces critères' : 'enregistré pour le moment'}.${can('fleet', 'update') ? ' Importez le fichier GPX du traceur ou du téléphone du chauffeur.' : ''}</div>`;
      return;
    }
    box.innerHTML = `<div class="gps-totals"><b>${this.total}</b> trajet(s) · <b>${esc(fmtKm(this.totals.distanceM))}</b> · ${esc(fmtDuration(this.totals.movingS))} de roulage${this.total > this.rows.length ? ` <span class="muted">(${this.rows.length} affichés)</span>` : ''}</div>
      <table class="mini wide-table gps-table"><thead><tr><th>Date</th>${this.filter.vehicle ? '' : '<th>Véhicule</th>'}<th>Chauffeur</th><th class="num">Distance</th><th class="num">Roulage</th><th class="num">Arrêts</th></tr></thead>
      <tbody>${this.rows.map((t) => `<tr data-track="${esc(t.id)}" tabindex="0" class="${t.id === this.selectedId ? 'sel' : ''}" aria-selected="${t.id === this.selectedId}">
        <td>${esc(dayFr(t.startedAt))}<br><span class="muted small">${esc(timeFr(t.startedAt))} → ${esc(timeFr(t.endedAt))}</span></td>
        ${this.filter.vehicle ? '' : `<td>${esc(t.vehicle || '—')}</td>`}
        <td>${esc(t.driver || '—')}${t.mission ? `<br><span class="muted small">${esc(t.mission)}</span>` : ''}</td><td class="num">${esc(fmtKm(t.distanceM))}</td><td class="num">${esc(fmtDuration(t.movingS))}</td><td class="num">${(t.stops || []).length}</td></tr>`).join('')}</tbody></table>`;
  }

  async select(id) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    $$rows(this.el).forEach((r) => { const on_ = r.dataset.track === id; r.classList.toggle('sel', on_); r.setAttribute('aria-selected', String(on_)); });
    await this.loadDetail();
    emit('context-changed');
  }

  async loadDetail() {
    this.detail = null;
    if (!this.selectedId) { this.renderDetail(); return; }
    const box = $('[data-detail]', this.el);
    if (box) box.innerHTML = '<div class="empty">Chargement du tracé…</div>';
    try { this.detail = await get(`/api/gps/tracks/${this.selectedId}`); } catch (e) { if (box) box.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    this.renderDetail();
  }

  detailHtml(t, { print = false } = {}) {
    const stats = [
      ['Départ', `${dayFr(t.startedAt)} à ${timeFr(t.startedAt)}`], ['Arrivée', `${timeFr(t.endedAt)}${t.durationS > 86400 ? ` (${dayFr(t.endedAt)})` : ''}`],
      ['Distance', fmtKm(t.distanceM)], ['Durée totale', fmtDuration(t.durationS)], ['Temps de roulage', fmtDuration(t.movingS)],
      ['Vitesse moyenne (en roulage)', kmh(avgKmh(t))], ['Vitesse maximale', kmh(t.maxSpeedKmh)], ['Arrêts de 5 min et plus', String((t.stops || []).length)],
    ];
    const who = [['Véhicule', `${t.vehicle || '—'}${t.vehicleModel ? ` — ${t.vehicleModel}` : ''}`], ['Chauffeur', t.driver || '—'], ['Mission', t.mission || '—'], ['Libellé', t.label || '—'], ['Source', `${SOURCE[t.source] || t.source}${t.fileName ? ` (${t.fileName})` : ''}`], ['Positions', String(t.pointCount)]];
    const dl = (list) => `<dl class="gps-stats">${list.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    return `${trackSvg(t, { title: `Trajet ${t.vehicle || ''}` })}
      <div class="gps-legend"><span class="lg-start"></span> Départ <span class="lg-end"></span> Arrivée <span class="lg-stop"></span> Arrêt (5 min et plus)</div>
      ${dl(stats)}${dl(who)}
      ${(t.stops || []).length ? `<h4>Arrêts</h4><table class="mini wide-table"><thead><tr><th>N°</th><th>Heure</th><th class="num">Durée</th><th>Position</th></tr></thead><tbody>${t.stops.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(timeFr(s.at * 1000))}</td><td class="num">${esc(fmtDuration(s.durationS))}</td><td>${print ? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}` : `<a href="https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=16/${s.lat}/${s.lon}" target="_blank" rel="noopener" title="Ouvrir sur OpenStreetMap (Internet nécessaire)">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</a>`}</td></tr>`).join('')}</tbody></table>` : ''}`;
  }

  renderDetail() {
    const box = $('[data-detail]', this.el);
    if (!box) return;
    const t = this.detail;
    if (!t) { box.innerHTML = this.rows.length ? '<div class="empty">Choisissez un trajet dans la liste.</div>' : ''; return; }
    box.innerHTML = `<div class="gps-detail-head"><h3>${esc(t.label || `Trajet du ${dayFr(t.startedAt)}`)}</h3><span class="spacer"></span>
        <button type="button" class="link" data-open-vehicle="${esc(t.vehicleId)}">Fiche du véhicule</button>
        <a class="link" href="${esc(osmLink(t))}" target="_blank" rel="noopener" title="Internet nécessaire">Voir sur OpenStreetMap</a></div>
      ${this.detailHtml(t)}`;
  }

  activate() { if (this.stale) this.load(); }
  refresh() { return this.load(); }
  destroy() { this.offs.forEach((f) => f()); }
  toolbar() { return [['gps.import'], ['gps.edit', 'gps.cancel'], ['file.print', 'file.pdf'], ['view.refresh'], ['gps.gpx']]; }
  supports(id) {
    if (id === 'view.refresh') return true;
    if (id === 'gps.import') return can('fleet', 'update');
    if (!this.detail) return false;
    return { 'gps.edit': can('fleet', 'update'), 'gps.cancel': can('fleet', 'cancel'), 'gps.gpx': can('fleet', 'export'), 'file.print': can('fleet', 'print'), 'file.pdf': can('fleet', 'print') }[id] ?? false;
  }
  labelFor() { return null; }
  async exec(id) {
    const t = this.detail;
    if (id === 'view.refresh') return this.load();
    if (id === 'gps.import') { const nid = await importTrackDialog(this.filter.vehicle); if (nid) { this.selectedId = nid; await this.load(); } return undefined; }
    if (!t) return undefined;
    if (id === 'gps.gpx') return download(`Trajet ${t.vehicle || ''} ${new Date(t.startedAt).toISOString().slice(0, 10)}.gpx`.replace(/[\\/:*?"<>|]+/g, '-'), await fetchBlob(`/api/gps/tracks/${t.id}/gpx`));
    if (id === 'file.print' || id === 'file.pdf') return printHtml(gpsDoc(`<div class="gps-print">${this.detailHtml(t, { print: true })}</div>`, `TRAJET GPS — ${t.vehicle || ''}`), { pdf: id === 'file.pdf' });
    if (id === 'gps.edit') {
      const r = await formDialog('Modifier le trajet', [{ name: 'label', label: 'Libellé', value: t.label || '' }, { name: 'driver', label: 'Chauffeur', value: t.driver || '' }], { ok: 'Enregistrer' });
      if (!r) return undefined;
      try { await patch(`/api/gps/tracks/${t.id}`, { label: r.label.trim() || null, driver: r.driver.trim() || null }); emit('toast', { type: 'success', message: 'Trajet modifié.' }); await this.load(); } catch (e) { emit('toast', { type: 'error', message: e.message }); }
      return undefined;
    }
    if (id === 'gps.cancel') {
      const r = await formDialog('Retirer ce trajet', [{ name: 'reason', label: 'Motif (conservé dans le journal d’audit)', required: true, type: 'textarea' }], { ok: 'Retirer le trajet', intro: 'Le trajet ne sera plus affiché ni compté. Il n’est pas effacé de la base : l’opération reste tracée.' });
      if (!r) return undefined;
      try { await post(`/api/gps/tracks/${t.id}/cancel`, { reason: r.reason.trim() }); emit('toast', { type: 'success', message: 'Trajet retiré.' }); this.selectedId = null; await this.load(); } catch (e) { emit('toast', { type: 'error', message: e.message }); }
    }
    return undefined;
  }
  panelContext() { return { kind: 'tracks' }; }
  status() { return this.total != null ? `${this.total} trajet(s) GPS` : 'Suivi GPS'; }
}

const $$rows = (el) => [...el.querySelectorAll('[data-track]')];


/** Ouvre l'onglet « Suivi GPS » (un seul), filtré sur un véhicule si fourni. */
export function openTracks(ws, vehicleId = '') {
  const existing = ws.find('view:tracks');
  if (existing) { ws.activate(existing.id); if (vehicleId !== undefined && existing.view.filter.vehicle !== vehicleId) existing.view.setVehicle(vehicleId); return existing; }
  return ws.open({ id: 'view:tracks', kind: 'tracks', viewKey: 'tracks', state: { vehicle: vehicleId } });
}
