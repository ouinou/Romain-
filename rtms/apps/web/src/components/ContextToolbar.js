// Barre de commandes contextuelles (maquette RTMS) : icône + libellé ; ce qui ne tient pas
// dans la largeur passe dans « Plus d'actions ▾ ».
import { on } from '../core/bus.js';
import { isEnabled, keyLabel, command, labelOf, run, activeView } from '../core/commands.js';
import { $, debounce, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { prefs } from '../core/prefs.js';
import { showContextMenu } from './ContextMenu.js';

const PRIMARY = new Set(['record.new', 'form.save']);

export function mountContextToolbar(el) {
  let overflow = [];
  const btn = (id) => {
    const c = command(id);
    if (!c) return '';
    const label = labelOf(id);
    return `<button type="button" class="ctx-btn ${PRIMARY.has(id) ? 'primary' : ''} cmd-${id.replace('.', '-')}" data-cmd="${id}" ${isEnabled(id) ? '' : 'disabled'} title="${esc(label)}${c.key ? ` (${esc(keyLabel(c.key))})` : ''}">${icon(c.icon || 'chevron', 17)}${prefs().toolLabels !== false ? `<span>${esc(label)}</span>` : ''}</button>`;
  };
  const render = () => {
    const v = activeView();
    if (!v) { el.innerHTML = '<span class="ctx-title muted">Aucun onglet ouvert</span>'; return; }
    const groups = (v.toolbar?.() || []).map((g) => g.filter((id) => command(id)));
    let ids = groups.flat();
    overflow = [];
    const draw = () => {
      let i = 0;
      const shown = new Set(ids);
      el.innerHTML = groups.map((g) => {
        const items = g.filter((id) => shown.has(id));
        i += g.length;
        return items.length ? `<div class="ctx-group" role="group">${items.map(btn).join('')}</div>` : '';
      }).join('') + (overflow.length ? `<button type="button" class="ctx-btn more" data-more aria-haspopup="true">${prefs().toolLabels !== false ? '<span>Plus d’actions</span>' : '<span class="sr">Plus d’actions</span>'}${icon('more', 15)}</button>` : '');
    };
    draw();
    // Déplace les dernières commandes dans « Plus d'actions » jusqu'à ce que tout tienne
    while (el.scrollWidth > el.clientWidth + 2 && ids.length > 1) {
      overflow.unshift(ids.pop());
      draw();
    }
  };
  el.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (more) {
      const r = more.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 2, overflow);
      return;
    }
    const b = e.target.closest('[data-cmd]');
    if (b && !b.disabled) run(b.dataset.cmd);
  });
  const r = debounce(render, 16);
  on('context-changed', r);
  on('tab-changed', r);
  on('prefs', r);
  new ResizeObserver(() => r()).observe(el);
  render();
  void $;
}
