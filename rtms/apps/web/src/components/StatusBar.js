// Barre d'état (maquette RTMS) : version, base, utilisateur, contexte, dernière opération,
// licence, connexion, date et heure.
import { on } from '../core/bus.js';
import { activeView } from '../core/commands.js';
import { debounce, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { prefs } from '../core/prefs.js';
import { session } from '../core/session.js';
import { dialog } from './ModalManager.js';
import { operationLogHtml } from './NotificationCenter.js';

export function mountStatusBar(el) {
  let last = '';
  let online = true;
  const clock = () => {
    const d = new Date();
    const date = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return `<span class="sb-item">${icon('calendar', 13)} ${esc(date.charAt(0).toUpperCase() + date.slice(1))}</span><span class="sb-item sb-time">${esc(d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}</span>`;
  };
  const render = () => {
    el.hidden = prefs().statusBar === false;
    const v = activeView();
    const me = session.me;
    const lic = me?.license;
    el.innerHTML = `<span class="sb-item sb-strong">RTMS v${esc(me?.version || '')}</span>
      <span class="sb-item">Base : ${esc(me?.instance || '—')}</span>
      <span class="sb-item">Utilisateur : ${esc(me ? me.user.fullName : '')}</span>
      <span class="sb-item sb-ctx">${esc(v?.status?.() || '')}</span>
      ${last ? `<button type="button" class="sb-item sb-op" data-oplog title="Historique des opérations de la session">${icon('history', 13)} ${esc(last)}</button>` : '<button type="button" class="sb-item sb-op" data-oplog title="Historique des opérations de la session">' + icon('history', 13) + ' Prêt</button>'}
      ${lic && lic.state !== 'valid' && lic.state !== 'unconfigured' ? `<span class="sb-item sb-warn">Licence : ${esc(lic.state)}</span>` : ''}
      <span class="sb-item ${online ? 'sb-ok' : 'sb-warn'}">${icon(online ? 'checkcircle' : 'xcircle', 14)} ${online ? 'Connecté' : 'Serveur injoignable'}</span>
      ${clock()}`;
  };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-oplog]')) showOperationLog(); });
  const r = debounce(render, 30);
  on('context-changed', r);
  on('tab-changed', r);
  on('prefs', r);
  on('license', r);
  on('session', r);
  on('operation', (op) => { last = `${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — ${op.message}`; r(); });
  on('connection', (v) => { online = v; r(); });
  setInterval(r, 30_000);
  render();
}

export function showOperationLog() {
  return dialog({ title: 'Historique des opérations (session)', body: `<div class="oplog">${operationLogHtml()}</div>`, width: 620 });
}
