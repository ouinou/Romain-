// Point d'entrée RTMS : connexion, enregistrement des vues, des commandes,
// des menus et des raccourcis clavier.
import { emit, on } from './core/bus.js';
import { get, post } from './core/api.js';
import { activeView, allWithKeys, matchKey, register, run } from './core/commands.js';
import { $, esc } from './core/dom.js';
import { icon } from './core/icons.js';
import { PANEL_SECTIONS, PRESETS, SECTION_LABELS, applyWorkspace, clearSessionState, prefs, resetPrefsCache, saveWorkspace, setPrefs } from './core/prefs.js';
import { can, session } from './core/session.js';
import { VIEWS, viewByKey } from './config.js';
import { mountApplicationShell } from './components/ApplicationShell.js';
import { closeContextMenu } from './components/ContextMenu.js';
import { openViewTab, viewAllowed } from './components/LeftToolBar.js';
import { registerView, workspace } from './components/MainWorkspace.js';
import { alertDialog, closeTopDialog, confirmDialog, dialog, formDialog, hasOpenDialog } from './components/ModalManager.js';
import { mountToasts, notificationListHtml, notifications, refreshNotifications } from './components/NotificationCenter.js';
import { setCompanyInfo } from './components/PrintService.js';
import { showSection, togglePanel } from './components/RightPropertiesPanel.js';
import { showOperationLog } from './components/StatusBar.js';
import { setMenus } from './components/TopMenuBar.js';
import { AdminView } from './views/AdminView.js';
import { mountAuth } from './views/AuthScreen.js';
import { DashboardView } from './views/DashboardView.js';
import { ListView } from './views/ListView.js';
import { RecordView } from './views/RecordView.js';
import { ReportsView } from './views/ReportsView.js';
import { SettingsView } from './views/SettingsView.js';

const APP_VERSION = '2.1.0';

registerView('dashboard', (t, ws) => new DashboardView(t, ws));
registerView('list', (t, ws) => new ListView(t, ws));
registerView('record', (t, ws) => new RecordView(t, ws));
registerView('reports', (t, ws) => new ReportsView(t, ws));
registerView('settings', (t, ws) => new SettingsView(t, ws));
registerView('admin', (t, ws) => new AdminView(t, ws));

// ---------------------------------------------------------------- commandes
const view = (id, label, ic, key) => register({ id, label, icon: ic, key });
view('record.new', 'Nouveau', 'plus', 'Alt+N');
view('record.open', 'Ouvrir la fiche', 'eye');
view('record.edit', 'Modifier', 'pencil', 'F2');
view('record.duplicate', 'Dupliquer', 'copy');
view('record.status', 'Modifier le statut', 'tag');
view('record.validate', 'Valider', 'check');
view('record.cancel', 'Supprimer', 'ban', 'Suppr');
view('form.save', 'Enregistrer', 'save', 'Ctrl+S');
view('form.cancelEdit', 'Annuler la saisie', 'x');
view('file.print', 'Imprimer', 'printer', 'Ctrl+P');
view('file.pdf', 'Exporter PDF', 'pdf');
view('file.csv', 'Exporter Excel (CSV)', 'sheet');
view('view.filters', 'Filtres', 'filter');
view('view.columns', 'Colonnes…', 'columns');
view('view.refresh', 'Actualiser', 'refresh', 'F5');
view('edit.find', 'Rechercher dans la liste', 'search', 'Ctrl+F');
view('edit.selectAll', 'Tout sélectionner', 'check', 'Ctrl+A');
view('edit.deselect', 'Désélectionner', 'x');
view('transport.vehicle', 'Affecter un véhicule', 'car');
view('transport.driver', 'Affecter un chauffeur', 'steering');
view('transport.order', 'Ordre de mission', 'printer');
view('invoice.print', 'Imprimer la facture', 'receipt');

const g = (id, label, ic, key, fn, enabled) => register({ id, label, icon: ic, key, global: fn, enabled });
let shell = null;
g('tab.close', 'Fermer l’onglet', 'x', 'Alt+W', () => workspace.close(workspace.activeId), () => !!workspace.active());
g('tab.closeAll', 'Fermer tous les onglets', 'x', null, () => workspace.closeAll(), () => workspace.tabs.length > 0);
g('tab.next', 'Onglet suivant', 'chevron', 'Alt+PgSuiv', () => workspace.cycle(1), () => workspace.tabs.length > 1);
g('tab.prev', 'Onglet précédent', 'back', 'Alt+PgPréc', () => workspace.cycle(-1), () => workspace.tabs.length > 1);
g('nav.back', 'Revenir à l’onglet précédent', 'back', 'Alt+Retour arrière', () => workspace.back(), () => workspace.history.length > 0);
g('search.global', 'Recherche globale', 'search', 'Ctrl+K', () => shell.search.focus());
g('view.togglePanel', 'Panneaux latéraux', 'panel', 'F4', () => togglePanel());
g('view.toggleStatus', 'Barre d’état', 'info', null, () => setPrefs({ statusBar: prefs().statusBar === false }));
g('view.toggleLabels', 'Libellés des commandes', 'info', null, () => setPrefs({ toolLabels: prefs().toolLabels === false }));
g('view.density', 'Tableaux compacts', 'columns', null, () => setPrefs({ density: prefs().density === 'normal' ? 'compact' : 'normal' }));
g('window.oplog', 'Historique des opérations', 'history', null, () => showOperationLog());
g('window.notifications', 'Centre de notifications', 'bell', null, () => showNotifications());
g('window.saveWs', 'Enregistrer l’espace actuel…', 'save', null, async () => {
  const r = await formDialog('Enregistrer l’espace de travail', [{ name: 'name', label: 'Nom de l’espace', required: true }], { ok: 'Enregistrer' });
  if (r?.name) { saveWorkspace(r.name.trim().slice(0, 40)); emit('toast', { type: 'success', message: `Espace « ${r.name} » enregistré.` }); }
});
g('window.resetWs', 'Réinitialiser l’espace', 'refresh', null, () => applyWorkspace('Essentiel'));
g('help.shortcuts', 'Raccourcis clavier', 'key', 'F1', () => showShortcuts());
g('help.about', 'À propos de RTMS', 'info', null, () => alertDialog(`RAHA TRANSPORT Management System — version ${APP_VERSION}. Interface organisée en espace de travail (menus, outils, onglets, panneaux) ; identité visuelle RAHA TRANSPORT.`, 'À propos'));
g('session.logout', 'Déconnexion', 'logout', null, () => logout());

const openNew = (key) => {
  const v = viewByKey(key);
  return workspace.open({ kind: 'record', mode: 'new', module: v.module, viewKey: key, values: { ...(v.preset || {}) } });
};
const newItem = (key) => { const v = viewByKey(key); return { label: v.newLabel, icon: 'plus', enabled: () => can(v.module, 'create'), action: () => openNew(key) }; };
const openItem = (key, label) => { const v = viewByKey(key); return { label: label || v.title || v.label, icon: v.icon, enabled: () => viewAllowed(v), action: () => openViewTab(key) }; };
function openSection(kind, section) {
  const t = openViewTab(kind);
  if (t && t.view.section !== section) { t.view.section = section; t.view.show(); }
}

setMenus(() => [
  { label: 'Fichier', items: () => [
    { label: 'Nouveau', icon: 'plus', submenu: () => VIEWS.filter((v) => v.kind === 'list').map((v) => newItem(v.key)) },
    { label: 'Ouvrir', icon: 'folder', submenu: () => VIEWS.map((v) => openItem(v.key, v.label)) },
    '-', { cmd: 'form.save' }, '-', { cmd: 'tab.close' }, { cmd: 'tab.closeAll' }, '-', { cmd: 'file.print' }, { cmd: 'file.pdf' }, { cmd: 'file.csv' }, '-', { cmd: 'session.logout' }] },
  { label: 'Édition', items: () => [{ cmd: 'record.edit' }, { cmd: 'record.duplicate' }, { cmd: 'record.status' }, { cmd: 'record.validate' }, '-', { cmd: 'form.cancelEdit' }, { cmd: 'record.cancel' }, '-', { cmd: 'edit.selectAll' }, { cmd: 'edit.deselect' }, '-', { cmd: 'edit.find' }, { cmd: 'search.global' }] },
  { label: 'Affichage', items: () => [{ cmd: 'view.refresh' }, '-',
    { label: 'Panneaux latéraux', icon: 'panel', key: 'F4', checked: () => prefs().panelVisible, action: () => togglePanel() },
    { label: 'Barre d’état', checked: () => prefs().statusBar !== false, action: () => run('view.toggleStatus') },
    { label: 'Libellés des commandes', checked: () => prefs().toolLabels !== false, action: () => run('view.toggleLabels') },
    { label: 'Tableaux compacts', checked: () => prefs().density !== 'normal', action: () => run('view.density') },
    '-', { cmd: 'view.filters' }, { cmd: 'view.columns' }] },
  { label: 'Navigation', items: () => [{ cmd: 'nav.back' }, { cmd: 'tab.next' }, { cmd: 'tab.prev' }, '-', openItem('dashboard'), { cmd: 'search.global' }, '-',
    ...workspace.tabs.map((t) => ({ label: t.view.title(), icon: t.view.icon?.() || 'dashboard', checked: () => t.id === workspace.activeId, action: () => workspace.activate(t.id) }))] },
  { label: 'Transport', items: () => [newItem('transport'), openItem('transport'), '-', { cmd: 'transport.vehicle' }, { cmd: 'transport.driver' }, { cmd: 'record.status' }, '-', { cmd: 'transport.order' }, '-', openItem('fleet'), openItem('staff'), openItem('maintenance')] },
  { label: 'Transit', items: () => [newItem('transit'), openItem('transit'), '-', openItem('documents')] },
  { label: 'Import / Export', items: () => [newItem('import'), newItem('export'), '-', openItem('import'), openItem('export')] },
  { label: 'Commerce', items: () => [newItem('commerce'), openItem('commerce'), '-', newItem('clients'), openItem('clients'), newItem('suppliers'), openItem('suppliers')] },
  { label: 'Finance', items: () => [newItem('invoices'), openItem('invoices'), { label: 'Factures échues…', icon: 'bell', enabled: () => can('invoices'), action: () => showNotifications('invoices') }, { cmd: 'invoice.print' }, '-', newItem('finance'), openItem('finance')] },
  { label: 'Fenêtre', items: () => [
    ...PANEL_SECTIONS.map((s) => ({ label: SECTION_LABELS[s], checked: () => !prefs().hidden.includes(s), action: () => (prefs().hidden.includes(s) ? showSection(s) : setPrefs({ hidden: [...prefs().hidden, s] })) })),
    '-', { label: 'Espaces de travail', icon: 'panel', submenu: () => [
      ...Object.keys(PRESETS).map((n) => ({ label: n, checked: () => prefs().workspace === n, action: () => applyWorkspace(n) })),
      ...Object.keys(prefs().custom).map((n) => ({ label: n, checked: () => prefs().workspace === n, action: () => applyWorkspace(n) })),
      '-', { cmd: 'window.saveWs' }, { cmd: 'window.resetWs' }] },
    '-', { cmd: 'window.notifications' }, { cmd: 'window.oplog' }] },
  { label: 'Rapports', items: () => [openItem('reports', 'Rapports et statistiques'), openItem('dashboard'), '-', { cmd: 'file.print' }, { cmd: 'file.pdf' }] },
  { label: 'Administration', items: () => [
    { label: 'Utilisateurs', icon: 'users', enabled: () => can('users'), action: () => openSection('admin', 'users') },
    { label: 'Profils et permissions', icon: 'shield', enabled: () => can('users'), action: () => openSection('admin', 'permissions') },
    { label: 'Journal d’audit', icon: 'history', enabled: () => can('audit'), action: () => openSection('admin', 'audit') },
    { label: 'Licence', icon: 'key', enabled: () => can('license'), action: () => openSection('admin', 'license') },
    '-', { label: 'Paramètres de la société', icon: 'store', enabled: () => can('settings'), action: () => openSection('settings', 'company') },
    { label: 'Mon compte', icon: 'key', action: () => openSection('settings', 'account') }] },
  { label: 'Aide', items: () => [{ cmd: 'help.shortcuts' }, { cmd: 'help.about' }] },
]);

function showShortcuts() {
  const rows = allWithKeys().map((c) => `<tr><td><kbd>${esc(c.key)}</kbd></td><td>${esc(c.label)}</td></tr>`).join('');
  return dialog({ title: 'Raccourcis clavier', width: 520, body: `<table class="mini wide-table">${rows}
    <tr><td><kbd>F10</kbd></td><td>Accéder à la barre de menus</td></tr><tr><td><kbd>Entrée</kbd> / double-clic</td><td>Ouvrir la fiche sélectionnée</td></tr>
    <tr><td><kbd>↑</kbd> <kbd>↓</kbd> (+ Maj)</td><td>Parcourir / étendre la sélection</td></tr><tr><td><kbd>Ctrl</kbd>+clic</td><td>Sélection multiple</td></tr>
    <tr><td><kbd>Échap</kbd></td><td>Fermer la fenêtre ou le menu ouvert</td></tr></table>
    <p class="muted small">Sur macOS, Ctrl correspond à ⌘. Dans un navigateur, certains raccourcis (Ctrl+W, Ctrl+N) restent réservés au navigateur, d’où Alt+W et Alt+N.</p>` });
}

function showNotifications(module) {
  const items = notifications().items.filter((n) => !module || n.module === module);
  return dialog({ title: module === 'invoices' ? 'Factures échues' : 'Centre de notifications', width: 560, body: `<div class="notif-dlg">${notificationListHtml(items, 'Aucune alerte en cours.')}</div>`, onMount: (el, close) => {
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-open-record]'); if (b) { close(null); const [m, id] = b.dataset.openRecord.split(':'); workspace.open({ id: `rec:${m}:${id}`, kind: 'record', mode: 'view', module: m, recordId: id, viewKey: VIEWS.find((v) => v.module === m)?.key }); } });
  } });
}

// ---------------------------------------------------------------- raccourcis
const typing = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
document.addEventListener('keydown', (e) => {
  if (!session.me || session.me.state !== 'active' || $('#app').classList.contains('hidden')) return;
  if (e.key === 'Escape') { closeContextMenu(); if (hasOpenDialog()) { e.preventDefault(); closeTopDialog(); } return; }
  if (hasOpenDialog()) return;
  if (e.key === 'F10') { e.preventDefault(); shell.menu.focus(); return; }
  for (const c of allWithKeys()) {
    if (!matchKey(e, c.key)) continue;
    // Dans un champ de saisie, seuls les raccourcis avec modificateur ou touches F agissent
    if (typing(e.target) && !/^(Ctrl|Alt|F\d)/.test(c.key)) continue;
    if (typing(e.target) && ['edit.selectAll'].includes(c.id)) continue;
    e.preventDefault();
    run(c.id);
    return;
  }
});
// Liens « ouvrir l'enregistrement » partout dans l'appli (alertes du tableau de bord…)
document.addEventListener('click', (e) => {
  const b = e.target.closest('.panes [data-open-record], [data-bell], .appbar [data-cmd]');
  if (!b) return;
  if (b.matches('[data-bell]')) return showNotifications();
  if (b.matches('[data-cmd]')) return run(b.dataset.cmd);
  const [m, id] = b.dataset.openRecord.split(':');
  return workspace.open({ id: `rec:${m}:${id}`, kind: 'record', mode: 'view', module: m, recordId: id, viewKey: VIEWS.find((v) => v.module === m)?.key });
});
window.addEventListener('pagehide', () => { if (session.me) workspace.save(); });
window.addEventListener('beforeunload', (e) => {
  if (session.me) workspace.save(); if (workspace.tabs.some((t) => t.view.isDirty?.())) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- session
let notifTimer = null;
const auth = mountAuth(enterApp);
mountToasts();

async function enterApp(me) {
  session.me = me;
  session.perms = new Set(me.permissions);
  resetPrefsCache();
  if (!prefs().floating) setPrefs({ floating: {} }, { silent: true });
  try { const defs = await get('/api/modules'); session.defs = Object.fromEntries(defs.map((d) => [d.key, d])); } catch { session.defs = {}; }
  if (can('settings')) get('/api/admin/settings').then(setCompanyInfo).catch(() => {});
  $('#app').classList.remove('hidden');
  if (!shell) shell = mountApplicationShell($('#app'));
  $('[data-who]').textContent = `${me.user.fullName} · ${me.user.roleLabel}`;
  emit('session', me);
  emit('prefs', prefs());
  if (!workspace.restore()) openViewTab('dashboard') || openViewTab('settings');
  await refreshNotifications();
  clearInterval(notifTimer);
  notifTimer = setInterval(refreshNotifications, 5 * 60_000);
  if (me.license && !['valid', 'unconfigured'].includes(me.license.state) && me.license.enforcement === 'enforce') {
    emit('toast', { type: 'error', message: `Licence ${me.license.state} : le logiciel est en consultation seule.` });
  }
}

async function logout(message) {
  if (!message && workspace.tabs.some((t) => t.view.isDirty?.()) && !(await confirmDialog('Des saisies ne sont pas enregistrées. Se déconnecter quand même ?', { ok: 'Se déconnecter', danger: true }))) return;
  try { await post('/api/auth/logout', {}); } catch { /* déjà déconnecté */ }
  clearInterval(notifTimer);
  clearSessionState();
  workspace.reset();
  session.me = null;
  session.perms = new Set();
  $('#app').classList.add('hidden');
  auth.show(message);
}

on('session-expired', () => logout('Votre session a expiré. Reconnectez-vous.'));
on('data-changed', (d) => { workspace.invalidate(d?.module); refreshNotifications(); });
on('notifications', (s) => {
  const n = s.items.length;
  const b = document.querySelector('[data-bell-count]');
  if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); }
});
on('license-blocked', (d) => emit('toast', { type: 'error', message: d?.message || 'Licence invalide : consultation seule.' }));

get('/api/auth/me').then((me) => (me.state === 'active' ? enterApp(me) : auth.after(me))).catch(() => auth.show());
void icon; void activeView;
