// Utilitaires DOM partagés. Toute valeur affichée passe par esc() : aucune donnée
// saisie n'est jamais injectée telle quelle dans le HTML.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const money = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('fr-FR'));
export const dateFr = (v) => {
  if (!v) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
};
export const dateTimeFr = (v) => (v ? new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const uid = () => Math.random().toString(36).slice(2, 10);

/** Garde une boîte flottante entièrement visible dans la fenêtre. */
export function clampToViewport(el, x, y, margin = 8) {
  const r = el.getBoundingClientRect();
  const nx = Math.max(margin, Math.min(x, window.innerWidth - r.width - margin));
  const ny = Math.max(margin, Math.min(y, window.innerHeight - r.height - margin));
  el.style.left = `${nx}px`;
  el.style.top = `${ny}px`;
}

/** Échappement CSV identique au serveur (neutralise =, +, -, @ en tête de cellule). */
export function csvCell(v) {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Déplacement d'une boîte par sa poignée, borné à l'écran (suivi au niveau du document). */
export function makeDraggable(handle, box, onEnd) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.button !== 0) return;
    e.preventDefault();
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => clampToViewport(box, ev.clientX - dx, ev.clientY - dy);
    const up = () => { document.removeEventListener('pointermove', move); if (onEnd) onEnd(box.getBoundingClientRect()); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  });
}
