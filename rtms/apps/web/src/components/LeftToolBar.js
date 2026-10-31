// Barre d'outils verticale : un outil par module, infobulle, pastille d'alertes,
// module actif signalé par la barre orange (comme le menu du prototype).
import { on } from '../core/bus.js';
import { esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { can } from '../core/session.js';
import { VIEWS } from '../config.js';
import { workspace } from './MainWorkspace.js';
import { notifications } from './NotificationCenter.js';

export const viewAllowed = (v) => {
  if (v.kind === 'list') return can(v.module);
  if (v.res === null) return true;
  return (Array.isArray(v.res) ? v.res : [v.res]).some((r) => can(r));
};

export function openViewTab(key) {
  const v = VIEWS.find((x) => x.key === key);
  if (!v || !viewAllowed(v)) return null;
  return workspace.open({ id: `view:${key}`, kind: v.kind, viewKey: key });
}

export function mountLeftToolBar(el) {
  const render = () => {
    const active = workspace.active();
    const activeKey = active?.view.tab.desc.viewKey;
    const counts = notifications().counts;
    let group = '';
    el.innerHTML = VIEWS.filter(viewAllowed).map((v) => {
      const sep = v.group !== group ? (group = v.group, '<div class="tool-sep" aria-hidden="true"></div>') : '';
      const n = v.module && !v.preset ? counts[v.module] : 0;
      return `${sep}<button type="button" class="tool ${v.key === activeKey ? 'active' : ''}" data-view="${v.key}" aria-label="${esc(v.label)}" data-tip="${esc(v.label)}">${icon(v.icon, 20)}${n ? `<span class="badge" aria-label="${n} alerte(s)">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
    }).join('').replace(/^<div class="tool-sep"[^>]*><\/div>/, '');
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) openViewTab(b.dataset.view); });
  on('tab-changed', render);
  on('notifications', render);
  on('session', render);
  render();
}
