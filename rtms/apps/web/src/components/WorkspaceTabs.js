// Barre d'onglets : activation, fermeture (bouton, clic molette), réorganisation
// par glisser-déposer, menu contextuel, défilement si trop d'onglets.
import { on } from '../core/bus.js';
import { esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { showContextMenu } from './ContextMenu.js';
import { workspace } from './MainWorkspace.js';

export function mountWorkspaceTabs(el) {
  const render = () => {
    el.innerHTML = workspace.tabs.map((t) => {
      const v = t.view;
      const active = t.id === workspace.activeId;
      return `<div class="wtab ${active ? 'active' : ''} ${v.isDirty?.() ? 'dirty' : ''}" role="tab" aria-selected="${active}" draggable="true" data-id="${t.id}" title="${esc(v.title())}">
        ${icon(v.icon?.() || 'dashboard', 14)}<span class="wtab-label">${esc(v.title())}</span><span class="wtab-dot" aria-hidden="true"></span>
        <button type="button" class="wtab-x" data-close="${t.id}" aria-label="Fermer l’onglet ${esc(v.title())}">${icon('x', 12)}</button></div>`;
    }).join('') || '<div class="wtab-empty">Aucun onglet ouvert — choisissez un module dans la barre d’outils.</div>';
    const a = el.querySelector('.wtab.active');
    if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  on('tabs', render);
  on('tab-title', render);
  render();

  el.addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]');
    if (x) { workspace.close(x.dataset.close); return; }
    const t = e.target.closest('.wtab');
    if (t) workspace.activate(t.dataset.id);
  });
  el.addEventListener('auxclick', (e) => { const t = e.target.closest('.wtab'); if (t && e.button === 1) workspace.close(t.dataset.id); });
  el.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.wtab');
    if (!t) return;
    e.preventDefault();
    const id = t.dataset.id;
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Fermer', icon: 'x', action: () => workspace.close(id) },
      { label: 'Fermer les autres onglets', icon: 'x', action: () => workspace.closeAll({ except: id }) },
      { label: 'Fermer tous les onglets', icon: 'x', action: () => workspace.closeAll() },
      '-',
      { label: 'Actualiser', icon: 'refresh', action: () => workspace.find(id)?.view.refresh?.() },
    ]);
  });
  let dragId = null;
  el.addEventListener('dragstart', (e) => { const t = e.target.closest('.wtab'); if (t) { dragId = t.dataset.id; e.dataTransfer.effectAllowed = 'move'; } });
  el.addEventListener('dragover', (e) => { if (dragId) e.preventDefault(); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const t = e.target.closest('.wtab');
    if (dragId && t && t.dataset.id !== dragId) workspace.move(dragId, workspace.tabs.findIndex((x) => x.id === t.dataset.id));
    dragId = null;
  });
}
