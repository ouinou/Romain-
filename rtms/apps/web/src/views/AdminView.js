// Administration : utilisateurs, permissions par profil, journal d'audit, licence.
import { emit } from '../core/bus.js';
import { get, patch, post, put } from '../core/api.js';
import { $, $$, dateTimeFr, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { can, session } from '../core/session.js';
import { confirmDialog, dialog, formDialog } from '../components/ModalManager.js';
import { SectionedView, errorHtml, okHtml } from './SettingsView.js';

const RES_LABELS = { transport: 'Transport', transit: 'Transit', importexport: 'Import / Export', commerce: 'Commerce', clients: 'Clients / fournisseurs', fleet: 'Parc', staff: 'Personnel', maintenance: 'Maintenance', invoices: 'Facturation', finance: 'Finance', documents: 'Documents', dashboard: 'Tableau de bord', reports: 'Rapports', settings: 'Paramètres', audit: 'Journal d’audit', users: 'Utilisateurs', license: 'Licence' };
const ACT_LABELS = { read: 'Consulter', create: 'Créer', update: 'Modifier', validate: 'Valider', cancel: 'Annuler', export: 'Exporter', print: 'Imprimer', admin: 'Administrer' };

export class AdminView extends SectionedView {
  title() { return 'Administration'; }
  icon() { return 'shield'; }
  sections() {
    return [['users', 'Utilisateurs', 'users'], ['permissions', 'Profils et permissions', 'shield'], ['audit', 'Journal d’audit', 'history'], ['license', 'Licence', 'key']]
      .filter(([k]) => (k === 'permissions' ? can('users') : can(k)));
  }

  async render(s) {
    if (s === 'users') {
      const [users, perms] = await Promise.all([get('/api/admin/users'), get('/api/admin/permissions')]);
      this.roles = perms.roles;
      const admin = can('users', 'admin');
      return `<h2>Utilisateurs</h2><div data-msg></div>
        <div class="grid-wrap"><table class="grid dense"><thead><tr><th>Nom</th><th>E-mail</th><th>Profil</th><th>MFA</th><th>État</th><th>Dernière connexion</th>${admin ? '<th>Actions</th>' : ''}</tr></thead><tbody>
        ${users.map((u) => {
          const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
          const self = u.id === session.me.user.id;
          return `<tr><td>${esc(u.fullName)}</td><td>${esc(u.email)}</td>
            <td>${admin && !self ? `<select data-role="${esc(u.id)}" aria-label="Profil de ${esc(u.fullName)}">${Object.entries(this.roles).map(([k, v]) => `<option value="${esc(k)}" ${k === u.roleKey ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : esc(this.roles[u.roleKey] || u.roleKey)}</td>
            <td>${u.mfaEnabled ? 'Activée' : '—'}</td>
            <td><span class="pill ${u.status !== 'active' ? 'gray' : locked ? 'orange' : 'green'}">${u.status !== 'active' ? 'Désactivé' : locked ? 'Verrouillé' : 'Actif'}</span></td>
            <td>${esc(dateTimeFr(u.lastLoginAt))}</td>
            ${admin ? `<td class="row-actions">${self ? '<span class="muted small">vous</span>' : `
              ${locked ? `<button type="button" class="btn secondary sm" data-act="unlock" data-id="${esc(u.id)}">Déverrouiller</button>` : ''}
              ${u.mfaEnabled ? `<button type="button" class="btn secondary sm" data-act="reset-mfa" data-id="${esc(u.id)}" data-name="${esc(u.fullName)}">Réinitialiser MFA</button>` : ''}
              <button type="button" class="btn secondary sm" data-act="${u.status === 'active' ? 'disable' : 'enable'}" data-id="${esc(u.id)}" data-name="${esc(u.fullName)}">${u.status === 'active' ? 'Désactiver' : 'Réactiver'}</button>`}</td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>
        ${admin ? `<div class="actions start"><button type="button" class="btn" data-act="add-user">${icon('plus', 15)} Ajouter un utilisateur</button></div>` : ''}`;
    }
    if (s === 'permissions') {
      const p = await get('/api/admin/permissions');
      this.perm = p;
      this.role = this.role && this.role in p.roles ? this.role : Object.keys(p.roles).find((r) => r !== 'admin');
      const grants = new Set(p.grants.filter((g) => g.startsWith(`${this.role}:`)).map((g) => g.slice(this.role.length + 1)));
      const editable = can('users', 'admin') && this.role !== 'admin';
      return `<h2>Profils et permissions</h2><div data-msg></div>
        <div class="list-bar"><label>Profil <select data-pick-role>${Object.entries(p.roles).map(([k, v]) => `<option value="${esc(k)}" ${k === this.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        ${this.role === 'admin' ? '<span class="muted small">Les droits Administrateur ne sont pas modifiables (protection contre le verrouillage).</span>' : ''}</div>
        <div class="grid-wrap"><table class="grid dense perm-grid"><thead><tr><th>Ressource</th>${p.actions.map((a) => `<th class="c">${esc(ACT_LABELS[a] || a)}</th>`).join('')}</tr></thead><tbody>
        ${p.resources.map((r) => `<tr><td>${esc(RES_LABELS[r] || r)}</td>${p.actions.map((a) => `<td class="c"><input type="checkbox" data-grant="${esc(r)}:${esc(a)}" ${grants.has(`${r}:${a}`) ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="${esc(RES_LABELS[r] || r)} — ${esc(ACT_LABELS[a] || a)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${editable ? `<div class="actions start"><button type="button" class="btn" data-act="save-perms">${icon('save', 15)} Enregistrer les permissions</button></div>` : ''}`;
    }
    if (s === 'audit') {
      return `<h2>Journal d’audit</h2><div data-msg></div>
        <div class="actions start"><button type="button" class="btn secondary" data-act="verify-audit">${icon('shield', 15)} Vérifier l’intégrité</button><button type="button" class="btn secondary" data-act="load-audit">${icon('history', 15)} Afficher les 100 dernières opérations</button></div><div data-audit></div>`;
    }
    if (s === 'license') {
      const l = await get('/api/admin/license');
      return `<h2>Licence</h2><div data-msg></div>
        <table class="kv"><tr><th>État</th><td><span class="pill ${l.state === 'valid' ? 'green' : 'orange'}">${esc(l.state)}</span> ${esc(l.reason || '')}</td></tr>
        ${l.customer ? `<tr><th>Titulaire</th><td>${esc(l.customer)}</td></tr><tr><th>Offre</th><td>${esc(l.plan)} · ${esc(l.maxUsers)} utilisateurs</td></tr><tr><th>Fin d’abonnement</th><td>${esc(dateTimeFr(l.expiresAt))}</td></tr>` : ''}
        <tr><th>Identifiant d’installation</th><td><code>${esc(l.installationId || '—')}</code></td></tr><tr><th>Application</th><td>${esc(l.enforcement)}</td></tr></table>
        ${can('license', 'admin') ? `<form class="form" data-form="lic"><label class="wide">Clé de licence<input name="licenseKey" placeholder="RTMS-XXXXX-XXXXX-XXXXX-XXXXX" maxlength="64" required></label></form><div class="actions start"><button type="button" class="btn" data-act="activate">${icon('key', 15)} Activer</button></div>` : ''}`;
    }
    return '';
  }

  mount(el) {
    super.mount(el);
    el.addEventListener('change', async (e) => {
      if (e.target.matches('[data-pick-role]')) { this.role = e.target.value; return this.show(); }
      if (e.target.matches('[data-role]')) {
        const ok = await confirmDialog(`Changer le profil de cet utilisateur en « ${this.roles[e.target.value]} » ?`, { detail: 'Ses sessions en cours seront fermées.' });
        if (!ok) return this.show();
        try { await patch(`/api/admin/users/${e.target.dataset.role}`, { roleKey: e.target.value }); emit('operation', { message: 'Profil utilisateur modifié' }); emit('toast', { type: 'success', message: 'Profil modifié.' }); } catch (x) { emit('toast', { type: 'error', message: x.message }); }
        return this.show();
      }
      return undefined;
    });
  }

  async action(act, btn) {
    const msg = $('[data-msg]', this.el);
    const id = btn.dataset.id;
    try {
      if (act === 'add-user') {
        const r = await formDialog('Nouvel utilisateur', [
          { name: 'fullName', label: 'Nom complet', required: true },
          { name: 'email', label: 'E-mail', type: 'email', required: true },
          { name: 'roleKey', label: 'Profil', type: 'select', options: Object.entries(this.roles) },
        ], { ok: 'Créer' });
        if (!r) return;
        const u = await post('/api/admin/users', r);
        await dialog({ title: 'Utilisateur créé', body: `<p>Mot de passe provisoire à transmettre en main propre :</p><p class="secret">${esc(u.temporaryPassword)}</p><p class="muted small">Il ne sera plus affiché. L’utilisateur devra le changer.</p>`, actions: [{ label: 'J’ai noté le mot de passe', value: true }] });
        emit('operation', { message: `Utilisateur créé : ${r.fullName}` });
        return this.show();
      }
      if (act === 'unlock') { await patch(`/api/admin/users/${id}`, { unlock: true }); emit('toast', { type: 'success', message: 'Compte déverrouillé.' }); return this.show(); }
      if (act === 'reset-mfa') {
        if (!(await confirmDialog(`Réinitialiser la double authentification de ${btn.dataset.name} ?`, { ok: 'Réinitialiser', danger: true, detail: 'À utiliser si le téléphone est perdu. La personne devra la reconfigurer à sa prochaine connexion.' }))) return;
        await patch(`/api/admin/users/${id}`, { resetMfa: true });
        emit('operation', { message: `MFA réinitialisée : ${btn.dataset.name}` });
        return this.show();
      }
      if (act === 'disable' || act === 'enable') {
        if (act === 'disable' && !(await confirmDialog(`Désactiver le compte de ${btn.dataset.name} ?`, { ok: 'Désactiver', danger: true, detail: 'Ses sessions sont fermées immédiatement. Ses données et son historique sont conservés.' }))) return;
        await patch(`/api/admin/users/${id}`, { status: act === 'disable' ? 'disabled' : 'active' });
        emit('operation', { message: `Compte ${act === 'disable' ? 'désactivé' : 'réactivé'} : ${btn.dataset.name}` });
        return this.show();
      }
      if (act === 'save-perms') {
        const grants = $$('[data-grant]:checked', this.el).map((c) => c.dataset.grant);
        await put(`/api/admin/permissions/${this.role}`, { grants });
        msg.innerHTML = okHtml(`Permissions du profil « ${this.perm.roles[this.role]} » enregistrées.`);
        emit('operation', { message: `Permissions modifiées : ${this.perm.roles[this.role]}` });
        return undefined;
      }
      if (act === 'verify-audit') {
        const r = await get('/api/admin/audit/verify');
        msg.innerHTML = r.intact ? okHtml('Journal intègre : aucune modification détectée.') : `<div class="err">Altération détectée à partir de l’entrée n° ${esc(r.firstBrokenId)}. Prévenez immédiatement l’administrateur.</div>`;
        return undefined;
      }
      if (act === 'load-audit') {
        const rows = await get('/api/admin/audit?limit=100');
        $('[data-audit]', this.el).innerHTML = `<div class="grid-wrap"><table class="grid dense"><thead><tr><th>Date</th><th>Action</th><th>Objet</th><th>IP</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(dateTimeFr(r.at))}</td><td>${esc(r.action)}</td><td>${esc(r.entity)} ${esc(r.entityId || '')}</td><td>${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>`;
        return undefined;
      }
      if (act === 'activate') {
        const f = $('[data-form=lic]', this.el);
        if (!f.reportValidity()) return;
        const l = await post('/api/admin/license/activate', { licenseKey: new FormData(f).get('licenseKey') });
        session.me.license = l;
        emit('license', l);
        return this.show();
      }
    } catch (e) { msg.innerHTML = errorHtml(e); }
    return undefined;
  }
}
