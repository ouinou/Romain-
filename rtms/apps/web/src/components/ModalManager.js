// Fenêtres modales et boîtes de dialogue. Déplaçables par leur barre de titre,
// toujours maintenues dans la fenêtre, fermées par Échap, focus sur le 1er champ.
import { $, clampToViewport, esc, h, makeDraggable } from '../core/dom.js';
import { icon } from '../core/icons.js';

const stack = [];

export function dialog({ title, body, actions = [{ label: 'Fermer', value: null, secondary: true }], width = 480, onMount }) {
  return new Promise((resolve) => {
    const layer = h(`<div class="dlg-layer" role="presentation"></div>`);
    const box = h(`<div class="dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="width:min(${width}px,calc(100vw - 32px))">
      <div class="dlg-head"><span>${esc(title)}</span><button type="button" class="icon-btn" data-close title="Fermer (Échap)">${icon('x', 16)}</button></div>
      <div class="dlg-body"></div>
      <div class="dlg-actions">${actions.map((a, i) => `<button type="button" class="btn ${a.secondary ? 'secondary' : ''} ${a.danger ? 'danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>`);
    const bodyEl = $('.dlg-body', box);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    layer.appendChild(box);
    document.body.appendChild(layer);
    const prevFocus = document.activeElement;
    const close = (v) => {
      stack.splice(stack.indexOf(close), 1);
      layer.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    stack.push(close);
    clampToViewport(box, (window.innerWidth - box.offsetWidth) / 2, Math.max(40, (window.innerHeight - box.offsetHeight) / 3));

    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return close(null);
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const a = actions[Number(b.dataset.i)];
      if (a.validate) {
        const ok = await a.validate(bodyEl);
        if (!ok) return;
      }
      close(typeof a.value === 'function' ? a.value(bodyEl) : a.value);
    });
    bodyEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        const primary = actions.findIndex((a) => !a.secondary);
        if (primary >= 0) $(`[data-i="${primary}"]`, box).click();
      }
    });
    // Déplacement par la barre de titre, borné à l'écran
    makeDraggable($('.dlg-head', box), box);
    if (onMount) onMount(bodyEl, close);
    const first = bodyEl.querySelector('input:not([type=hidden]),select,textarea') || $('.dlg-actions .btn:not(.secondary)', box) || $('.dlg-actions .btn', box);
    if (first) setTimeout(() => first.focus(), 0);
  });
}

export const hasOpenDialog = () => stack.length > 0;
export function closeTopDialog() { const c = stack[stack.length - 1]; if (c) c(null); }

export function confirmDialog(message, { title = 'Confirmation', ok = 'Confirmer', danger = false, detail = '' } = {}) {
  return dialog({
    title,
    body: `<p class="dlg-msg">${esc(message)}</p>${detail ? `<p class="dlg-detail">${esc(detail)}</p>` : ''}`,
    actions: [{ label: 'Annuler', value: false, secondary: true }, { label: ok, value: true, danger }],
  }).then((v) => v === true);
}

export function alertDialog(message, title = 'Information') {
  return dialog({ title, body: `<p class="dlg-msg">${esc(message)}</p>`, actions: [{ label: 'OK', value: true }] });
}

/** Petit formulaire : fields = [{ name, label, type, options, value, required }] */
export function formDialog(title, fields, { ok = 'Valider', intro = '' } = {}) {
  const body = h(`<form class="form dlg-form" novalidate>${intro ? `<p class="dlg-detail wide">${esc(intro)}</p>` : ''}${fields.map((f) => {
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'select') input = `<select name="${esc(f.name)}" ${req}>${f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    else if (f.type === 'textarea') input = `<textarea name="${esc(f.name)}" rows="3" ${req}>${esc(f.value ?? '')}</textarea>`;
    else input = `<input name="${esc(f.name)}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.list ? `list="${esc(f.list)}"` : ''} ${req}>`;
    return `<label class="${f.wide !== false ? 'wide' : ''}">${esc(f.label)}${input}</label>`;
  }).join('')}</form>`);
  return dialog({
    title, body, width: 460,
    actions: [{ label: 'Annuler', value: null, secondary: true }, {
      label: ok,
      validate: (el) => $('form', el).reportValidity(),
      value: (el) => Object.fromEntries(new FormData($('form', el)).entries()),
    }],
  });
}
