// Barre d'état : utilisateur, contexte de l'onglet, dernière opération, licence, connexion.
import { on } from '../core/bus.js';
import { activeView } from '../core/commands.js';
import { debounce, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { prefs } from '../core/prefs.js';
import { session } from '../core/session.js';
import { dialog } from './ModalManager.js';
import { operationLogHtml } from './NotificationCenter.js';

export function mountStatusBar(el) {
  let last = 'Prêt';
  let online = true;
  const render = () => {
    el.hidden = prefs().statusBar === false;
    const v = activeView();
    const lic = session.me?.license;
    el.innerHTML = `<span class="sb-item">${icon('users', 13)} ${esc(session.me ? `${session.me.user.fullName} · ${session.me.user.roleLabel}` : '')}</span>
      <span class="sb-item sb-ctx">${esc(v?.status?.() || '')}</span>
      <button type="button" class="sb-item sb-op" data-oplog title="Historique des opérations de la session">${icon('history', 13)} ${esc(last)}</button>
      ${lic && lic.state !== 'valid' && lic.state !== 'unconfigured' ? `<span class="sb-item sb-warn">Licence : ${esc(lic.state)}</span>` : ''}
      <span class="sb-item ${online ? '' : 'sb-warn'}">${icon('wifi', 13)} ${online ? 'Connecté au serveur' : 'Serveur injoignable'}</span>`;
  };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-oplog]')) showOperationLog(); });
  const r = debounce(render, 30);
  on('context-changed', r);
  on('tab-changed', r);
  on('prefs', r);
  on('license', r);
  on('operation', (op) => { last = `${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — ${op.message}`; r(); });
  on('connection', (v) => { online = v; r(); });
  render();
}

export function showOperationLog() {
  return dialog({ title: 'Historique des opérations (session)', body: `<div class="oplog">${operationLogHtml()}</div>`, width: 620 });
}
