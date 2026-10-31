// Menu contextuel (clic droit), maintenu dans les limites de l'écran.
import { clampToViewport, esc, h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { isEnabled, keyLabel, command, labelOf, run } from '../core/commands.js';

let open = null;
export function closeContextMenu() { if (open) { open.remove(); open = null; } }

/** items : identifiants de commandes, '-' pour un séparateur, ou { label, icon, action, disabled } */
export function showContextMenu(x, y, items) {
  closeContextMenu();
  const el = h(`<div class="menu-pop ctx-menu" role="menu"></div>`);
  items.forEach((it) => {
    if (it === '-') { el.appendChild(h('<div class="menu-sep"></div>')); return; }
    const c = typeof it === 'string' ? command(it) : null;
    const label = c ? labelOf(it) : it.label;
    const disabled = c ? !isEnabled(it) : !!it.disabled;
    const b = h(`<button type="button" class="menu-item" role="menuitem" ${c ? `data-cmd="${esc(it)}"` : ''} ${disabled ? 'disabled' : ''}><span class="mi-ico">${icon((c ? c.icon : it.icon) || 'chevron', 15)}</span><span class="mi-label">${esc(label)}</span><span class="mi-key">${esc(keyLabel(c ? c.key : ''))}</span></button>`);
    b.addEventListener('click', () => { closeContextMenu(); if (c) run(it); else it.action(); });
    el.appendChild(b);
  });
  document.body.appendChild(el);
  clampToViewport(el, x, y);
  open = el;
  const first = el.querySelector('.menu-item:not([disabled])');
  if (first) first.focus();
}
document.addEventListener('pointerdown', (e) => { if (open && !open.contains(e.target)) closeContextMenu(); });
window.addEventListener('blur', closeContextMenu);
