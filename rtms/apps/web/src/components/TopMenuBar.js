// Barre de menus : Fichier, Édition, Affichage, Navigation, Transport, Transit,
// Import / Export, Commerce, Finance, Fenêtre, Rapports, Administration, Aide.
// Clic ou F10 pour ouvrir, flèches pour naviguer, Entrée pour exécuter, Échap pour fermer.
import { on } from '../core/bus.js';
import { command, isEnabled, keyLabel, labelOf, run } from '../core/commands.js';
import { $, $$, clampToViewport, esc, h } from '../core/dom.js';
import { icon } from '../core/icons.js';

let menus = () => [];
export function setMenus(fn) { menus = fn; }

export function mountTopMenuBar(el) {
  let openIdx = -1;
  let pop = null;
  let sub = null;

  const renderBar = () => {
    el.innerHTML = menus().map((m, i) => `<button type="button" class="mb-item ${i === openIdx ? 'open' : ''}" data-menu="${i}" aria-haspopup="true" aria-expanded="${i === openIdx}">${esc(m.label)}</button>`).join('');
  };
  const close = () => { pop?.remove(); sub?.remove(); pop = null; sub = null; openIdx = -1; renderBar(); };

  const itemHtml = (it, i) => {
    if (it === '-') return '<div class="menu-sep" role="separator"></div>';
    const c = it.cmd ? command(it.cmd) : null;
    const label = c ? labelOf(it.cmd) : it.label;
    const enabled = c ? isEnabled(it.cmd) : it.enabled === undefined ? true : !!(typeof it.enabled === 'function' ? it.enabled() : it.enabled);
    const checked = typeof it.checked === 'function' ? it.checked() : it.checked;
    const k = c ? c.key : it.key;
    return `<button type="button" class="menu-item" role="menuitem" data-i="${i}" ${enabled ? '' : 'disabled'} ${it.submenu ? 'aria-haspopup="true"' : ''}>
      <span class="mi-ico">${checked === true ? icon('check', 14) : checked === false ? '' : icon((c ? c.icon : it.icon) || 'chevron', 14, 'faint')}</span>
      <span class="mi-label">${esc(label)}</span><span class="mi-key">${it.submenu ? icon('chevron', 12) : esc(keyLabel(k || ''))}</span></button>`;
  };

  const openPop = (items, anchor, isSub = false) => {
    const box = h(`<div class="menu-pop ${isSub ? 'sub' : ''}" role="menu">${items.map(itemHtml).join('')}</div>`);
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    clampToViewport(box, isSub ? r.right - 2 : r.left, isSub ? r.top - 4 : r.bottom);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || b.disabled) return;
      const it = items[Number(b.dataset.i)];
      if (it.submenu) { showSub(it, b); return; }
      close();
      if (it.cmd) run(it.cmd); else it.action?.();
    });
    box.addEventListener('pointermove', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || isSub) return;
      const it = items[Number(b.dataset.i)];
      if (it.submenu && !b.disabled) showSub(it, b); else if (sub) { sub.remove(); sub = null; }
    });
    box.addEventListener('keydown', (e) => keyNav(e, box, items, isSub));
    return box;
  };
  const showSub = (it, anchor) => {
    sub?.remove();
    const items = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
    sub = openPop(items, anchor, true);
    sub.querySelector('.menu-item:not([disabled])')?.focus();
  };
  const open = (i, focusFirst = false) => {
    pop?.remove(); sub?.remove(); sub = null;
    openIdx = i;
    renderBar();
    const anchor = $(`[data-menu="${i}"]`, el);
    const m = menus()[i];
    pop = openPop(m.items(), anchor);
    if (focusFirst) pop.querySelector('.menu-item:not([disabled])')?.focus();
  };
  const keyNav = (e, box, items, isSub) => {
    const btns = $$('.menu-item:not([disabled])', box);
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0])?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1])?.focus(); }
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const it = items[Number(document.activeElement?.dataset.i)];
      if (!isSub && it?.submenu) showSub(it, document.activeElement);
      else open((openIdx + 1) % menus().length, true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (isSub) { sub.remove(); sub = null; pop.querySelector('.menu-item:not([disabled])')?.focus(); } else open((openIdx - 1 + menus().length) % menus().length, true);
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); $(`[data-menu="0"]`, el)?.focus(); }
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const i = Number(b.dataset.menu);
    if (openIdx === i) close(); else open(i);
  });
  // pointermove (et non pointerover) : redessiner la barre sous un pointeur immobile
  // ne doit pas changer le menu ouvert au clavier
  el.addEventListener('pointermove', (e) => {
    const b = e.target.closest('[data-menu]');
    if (b && openIdx >= 0 && Number(b.dataset.menu) !== openIdx) open(Number(b.dataset.menu));
  });
  el.addEventListener('keydown', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const i = Number(b.dataset.menu);
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i, true); }
    if (e.key === 'ArrowRight') { e.preventDefault(); $(`[data-menu="${(i + 1) % menus().length}"]`, el)?.focus(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); $(`[data-menu="${(i - 1 + menus().length) % menus().length}"]`, el)?.focus(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (openIdx < 0) return;
    if (el.contains(e.target) || pop?.contains(e.target) || sub?.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (openIdx >= 0 && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const i = openIdx; close(); $(`[data-menu="${i}"]`, el)?.focus(); }
  }, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  on('session', renderBar);
  renderBar();
  return { focus: () => $('[data-menu="0"]', el)?.focus(), close, isOpen: () => openIdx >= 0 };
}
