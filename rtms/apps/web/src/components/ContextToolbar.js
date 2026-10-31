// Barre de commandes contextuelles : change selon l'onglet actif (module, fiche...).
import { on } from '../core/bus.js';
import { isEnabled, keyLabel, command, labelOf, run, activeView } from '../core/commands.js';
import { debounce, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { prefs } from '../core/prefs.js';

export function mountContextToolbar(el) {
  const render = () => {
    const v = activeView();
    if (!v) { el.innerHTML = '<span class="ctx-title muted">Aucun onglet ouvert</span>'; return; }
    const groups = v.toolbar?.() || [];
    const labels = prefs().toolLabels !== false;
    el.innerHTML = `<span class="ctx-title">${icon(v.icon?.() || 'dashboard', 16)} ${esc(v.title())}</span>${groups.map((g) => `<div class="ctx-group" role="group">${g.map((id) => {
      const c = command(id);
      if (!c) return '';
      const label = labelOf(id);
      const primary = id === 'record.new' || id === 'form.save';
      return `<button type="button" class="ctx-btn ${primary ? 'primary' : ''}" data-cmd="${id}" ${isEnabled(id) ? '' : 'disabled'} title="${esc(label)}${c.key ? ` (${esc(keyLabel(c.key))})` : ''}">${icon(c.icon || 'chevron', 16)}${labels ? `<span>${esc(label)}</span>` : ''}</button>`;
    }).join('')}</div>`).join('')}`;
    // Trop de commandes pour la largeur : seules les actions principales gardent leur libellé
    el.classList.remove('compact');
    el.scrollLeft = 0;
    if (el.scrollWidth > el.clientWidth + 2) el.classList.add('compact');
  };
  new ResizeObserver(() => render()).observe(el);
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b && !b.disabled) run(b.dataset.cmd); });
  const r = debounce(render, 16);
  on('context-changed', r);
  on('tab-changed', r);
  on('prefs', r);
  render();
}
