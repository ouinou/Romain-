// Barre latérale des modules (maquette RTMS) : icône + libellé, module actif en orange,
// pastille d'alertes, repliable en barre d'icônes (« ») avec infobulles.
import { on } from '../core/bus.js';
import { esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { prefs, setPrefs } from '../core/prefs.js';
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

export function toggleSidebar(force) {
  setPrefs({ sidebarCollapsed: force ?? !prefs().sidebarCollapsed });
}

export function mountLeftToolBar(el) {
  const render = () => {
    const collapsed = !!prefs().sidebarCollapsed;
    document.body.classList.toggle('rail-collapsed', collapsed);
    const activeKey = workspace.active()?.view.tab.desc.viewKey;
    const counts = notifications().counts;
    const toggle = (cls) => `<button type="button" class="rail-toggle ${cls}" data-toggle-rail title="${collapsed ? 'Déplier' : 'Replier'} la barre latérale" aria-label="${collapsed ? 'Déplier' : 'Replier'} la barre latérale">${icon(collapsed ? 'chevronsr' : 'chevronsl', 17)}</button>`;
    el.innerHTML = `${toggle('top')}<div class="rail-items">${VIEWS.filter(viewAllowed).map((v) => {
      const n = v.module && !v.preset ? counts[v.module] : 0;
      return `<button type="button" class="tool ${v.key === activeKey ? 'active' : ''}" data-view="${v.key}" aria-label="${esc(v.label)}" data-tip="${esc(v.label)}" ${v.key === activeKey ? 'aria-current="page"' : ''}>
        ${icon(v.icon, 20)}<span class="tool-label">${esc(v.label)}</span>${n ? `<span class="badge" aria-label="${n} alerte(s)">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
    }).join('')}</div>${toggle('bottom')}`;
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-toggle-rail]')) return toggleSidebar();
    const b = e.target.closest('[data-view]');
    if (b) openViewTab(b.dataset.view);
    return undefined;
  });
  on('tab-changed', render);
  on('notifications', render);
  on('session', render);
  on('prefs', render);
  render();
}
