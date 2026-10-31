// Paramètres : société, compte personnel, espace de travail, données du prototype.
import { emit } from '../core/bus.js';
import { get, post, put } from '../core/api.js';
import { $, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { PRESETS, applyWorkspace, deleteWorkspace, prefs } from '../core/prefs.js';
import { can, session } from '../core/session.js';
import { confirmDialog } from '../components/ModalManager.js';
import { MODEL_MENTIONS, setCompanyInfo } from '../components/PrintService.js';

const SECTIONS = [['company', 'Société', 'store'], ['account', 'Mon compte', 'key'], ['workspace', 'Espace de travail', 'panel'], ['legacy', 'Données du prototype', 'import']];
const formObj = (f) => Object.fromEntries(new FormData(f).entries());
const ok = (m) => `<div class="ok">${esc(m)}</div>`;
const err = (e) => `<div class="err">${esc(e.message)}${Array.isArray(e.body?.details) ? `<ul>${e.body.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>`;

export function readLegacy() {
  try { const d = JSON.parse(localStorage.getItem('rtms_data') || 'null'); return d && typeof d === 'object' && Object.keys(d).length ? d : null; } catch { return null; }
}

class SectionedView {
  constructor(tab, ws) { this.tab = tab; this.ws = ws; this.section = tab.desc.section || this.sections()[0]?.[0]; }
  serialize() { return { id: this.tab.id, kind: this.tab.kind, viewKey: this.tab.desc.viewKey, section: this.section }; }
  mount(el) {
    this.el = el;
    el.innerHTML = `<div class="view split-view"><nav class="subnav" aria-label="${esc(this.title())}"></nav><div class="subcontent"></div></div>`;
    el.addEventListener('click', (e) => {
      const s = e.target.closest('[data-section]');
      if (s) { this.section = s.dataset.section; this.ws.persist(); return this.show(); }
      const a = e.target.closest('[data-act]');
      if (a) this.action(a.dataset.act, a);
    });
    el.addEventListener('submit', (e) => e.preventDefault());
    this.show();
  }
  async show() {
    const secs = this.sections();
    if (!secs.find((s) => s[0] === this.section)) this.section = secs[0]?.[0];
    $('.subnav', this.el).innerHTML = secs.map(([k, l, ic]) => `<button type="button" data-section="${k}" class="${k === this.section ? 'active' : ''}">${icon(ic, 15)} ${esc(l)}</button>`).join('');
    const c = $('.subcontent', this.el);
    c.innerHTML = '<div class="empty">Chargement…</div>';
    try { c.innerHTML = await this.render(this.section); } catch (e) { c.innerHTML = err(e); }
    emit('context-changed');
  }
  refresh() { return this.show(); }
  supports(id) { return id === 'view.refresh'; }
  exec(id) { if (id === 'view.refresh') return this.show(); return undefined; }
  toolbar() { return [['view.refresh']]; }
  panelContext() { return { kind: this.tab.kind, section: this.section }; }
  status() { return `${this.title()} · ${this.sections().find((s) => s[0] === this.section)?.[1] ?? ''}`; }
}

export class SettingsView extends SectionedView {
  title() { return 'Paramètres'; }
  icon() { return 'settings'; }
  sections() { return SECTIONS.filter(([k]) => (k === 'company' ? can('settings') : k === 'legacy' ? can('settings', 'admin') && !!readLegacy() : true)); }

  async render(s) {
    if (s === 'company') {
      const c = await get('/api/admin/settings');
      setCompanyInfo(c);
      const sel = (n, opts, v) => `<select name="${n}" ${can('settings', 'admin') ? '' : 'disabled'}>${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      const ro = can('settings', 'admin') ? '' : 'readonly';
      return `<h2>Informations de l’entreprise</h2><div data-msg></div>
        <form class="form" data-form="company"><label class="wide">Raison sociale *<input name="name" value="${esc(c.name)}" required maxlength="200" ${ro}></label>
        <label>Téléphone<input name="phone" value="${esc(c.phone || '')}" maxlength="60" ${ro}></label><label>E-mail<input name="email" type="email" value="${esc(c.email || '')}" maxlength="200" ${ro}></label>
        <label class="wide">Adresse<input name="address" value="${esc(c.address || '')}" maxlength="300" ${ro}></label>
        <label>RCCM<input name="rccm" value="${esc(c.rccm || '')}" maxlength="80" ${ro}></label><label>N° contribuable<input name="taxId" value="${esc(c.taxId || '')}" maxlength="80" ${ro}></label>
        <label>Devise principale${sel('currency', ['FCFA', 'EUR', 'USD'], c.currency)}</label><label>Langue${sel('language', ['Français', 'English'], c.language)}</label></form>
        <p class="muted small">Ces mentions apparaissent dans le bandeau des factures et documents imprimés. Tant qu’elles sont vides, ce sont celles du modèle de facture fourni qui s’impriment.</p>
        ${can('settings', 'admin') ? `<div class="actions"><button type="button" class="btn secondary" data-act="model-mentions">Reprendre les mentions du modèle de facture</button><button type="button" class="btn" data-act="save-company">${icon('save', 15)} Enregistrer les paramètres</button></div>` : '<p class="muted small">Consultation seule pour votre profil.</p>'}`;
    }
    if (s === 'account') {
      return `<h2>Mon compte</h2><p>${esc(session.me.user.fullName)} · ${esc(session.me.user.roleLabel)}</p>
        <h3>Changer mon mot de passe</h3><div data-msg></div>
        <form class="form" data-form="pwd"><label>Mot de passe actuel<input name="current" type="password" autocomplete="current-password" required></label>
        <label>Nouveau mot de passe (12 caractères min.)<input name="next" type="password" autocomplete="new-password" minlength="12" required></label></form>
        <div class="actions"><button type="button" class="btn" data-act="change-password">${icon('key', 15)} Changer le mot de passe</button></div>
        <p class="muted small">Changer de mot de passe ferme vos autres sessions ouvertes.</p>`;
    }
    if (s === 'workspace') {
      const p = prefs();
      const names = [...Object.keys(PRESETS), ...Object.keys(p.custom)];
      return `<h2>Espace de travail</h2><p class="muted">La disposition (panneaux, colonnes, densité) est mémorisée pour votre compte sur ce poste.</p><div data-msg></div>
        <table class="mini wide-table"><thead><tr><th>Espace</th><th></th></tr></thead><tbody>${names.map((n) => `<tr><td>${esc(n)} ${n === p.workspace ? '<span class="pill green">actif</span>' : ''}</td><td class="num"><button type="button" class="btn secondary sm" data-act="ws-apply" data-name="${esc(n)}">Appliquer</button> ${p.custom[n] ? `<button type="button" class="btn secondary sm" data-act="ws-delete" data-name="${esc(n)}">Supprimer</button>` : ''}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Pour enregistrer la disposition actuelle sous un nom : menu Fenêtre › Espaces de travail › Enregistrer l’espace actuel.</p>`;
    }
    if (s === 'legacy') {
      const n = Object.values(readLegacy() || {}).reduce((a, rows) => a + (Array.isArray(rows) ? rows.length : 0), 0);
      return `<h2>Données du prototype sur ce poste</h2><div data-msg></div><p>${n} enregistrement(s) saisis dans l’ancienne version sont encore stockés dans ce navigateur. Vous pouvez les transférer sur le serveur : un aperçu est fait d’abord, rien n’est effacé localement.</p>
        <div class="actions start"><button type="button" class="btn secondary" data-act="import-preview">Aperçu</button><button type="button" class="btn" data-act="import-run">Transférer sur le serveur</button></div>`;
    }
    return '';
  }

  async action(act, btn) {
    const msg = $('[data-msg]', this.el);
    try {
      if (act === 'save-company') {
        const f = $('[data-form=company]', this.el);
        if (!f.reportValidity()) return;
        const r = await put('/api/admin/settings', formObj(f));
        setCompanyInfo(r);
        msg.innerHTML = ok('Paramètres enregistrés.');
        emit('operation', { message: 'Paramètres de la société enregistrés' });
      } else if (act === 'model-mentions') {
        const f = $('[data-form=company]', this.el);
        for (const k of ['name', 'rccm', 'taxId', 'phone', 'address']) if (f[k] && !f[k].value.trim()) f[k].value = MODEL_MENTIONS[k];
        msg.innerHTML = '<div class="notice">Mentions reprises du modèle de facture fourni (champs vides uniquement). Vérifiez-les puis enregistrez.</div>';
      } else if (act === 'change-password') {
        const f = $('[data-form=pwd]', this.el);
        if (!f.reportValidity()) return;
        await post('/api/auth/password', formObj(f));
        f.reset();
        msg.innerHTML = ok('Mot de passe changé. Vos autres sessions ont été fermées.');
      } else if (act === 'ws-apply') { applyWorkspace(btn.dataset.name); this.show(); }
      else if (act === 'ws-delete') { deleteWorkspace(btn.dataset.name); this.show(); }
      else if (act === 'import-preview' || act === 'import-run') {
        const dryRun = act === 'import-preview';
        if (!dryRun && !(await confirmDialog('Transférer les données de ce navigateur sur le serveur ?', { ok: 'Transférer' }))) return;
        const r = await post('/api/admin/import-legacy', { data: readLegacy(), dryRun });
        msg.innerHTML = `<div class="${dryRun ? 'notice' : 'ok'}">${dryRun ? 'Aperçu (rien n’a été enregistré)' : 'Transfert terminé'} :<ul>${r.report.map((m) => `<li>${esc(m.module)} : ${m.imported} ${dryRun ? 'à importer' : 'importé(s)'}, ${m.skipped} ignoré(s)${m.warnings.length ? `<ul>${m.warnings.slice(0, 20).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></div>`;
        if (!dryRun) { emit('data-changed', {}); emit('operation', { message: 'Transfert des données du prototype' }); }
      }
    } catch (e) { msg.innerHTML = err(e); }
  }
}
export { SectionedView, err as errorHtml, ok as okHtml, formObj };
