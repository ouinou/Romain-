// Recherche globale (Ctrl+K) : clients, fournisseurs, factures, missions, véhicules,
// chauffeurs, dossiers, documents… résultats groupés par catégorie, navigation au clavier.
import { get } from '../core/api.js';
import { $, $$, debounce, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { viewForRecord } from '../config.js';
import { workspace } from './MainWorkspace.js';

export function mountGlobalSearch(el) {
  el.innerHTML = `<label class="gsearch">${icon('search', 15)}<input type="search" placeholder="Rechercher partout…" aria-label="Recherche globale" autocomplete="off" maxlength="100"><kbd>Ctrl K</kbd></label><div class="gs-results menu-pop" hidden role="listbox"></div>`;
  const input = $('input', el);
  const box = $('.gs-results', el);
  let seq = 0;
  const close = () => { box.hidden = true; };
  const openRecord = (b) => {
    const [module, id, sub] = b.dataset.rec.split(':');
    const viewKey = viewForRecord(module, module === 'clients' ? { 'Type (Client/Fournisseur)': sub } : module === 'importexport' ? { 'Type (Import/Export)': sub } : {});
    workspace.open({ id: `rec:${module}:${id}`, kind: 'record', mode: 'view', module, recordId: id, viewKey });
    close();
    input.blur();
  };
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    const my = ++seq;
    try {
      const r = await get(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      box.innerHTML = r.groups.length ? r.groups.map((g) => {
        const sub = g.key.split(':')[1] || '';
        return `<div class="gs-group">${esc(g.label)}</div>${g.items.map((it) => `<button type="button" class="gs-item" role="option" data-rec="${esc(g.module)}:${esc(it.id)}:${esc(sub)}"><span class="gs-t">${esc(it.title || it.reference || '—')}</span><span class="gs-s">${esc(it.subtitle || '')}</span></button>`).join('')}`;
      }).join('') : `<div class="gs-empty">Aucun résultat pour « ${esc(q)} ».</div>`;
      box.hidden = false;
    } catch (e) { box.innerHTML = `<div class="gs-empty">${esc(e.message)}</div>`; box.hidden = false; }
  }, 200);
  input.addEventListener('input', search);
  input.addEventListener('focus', () => { if (box.innerHTML && input.value.trim().length >= 2) box.hidden = false; });
  input.addEventListener('keydown', (e) => {
    const items = $$('.gs-item', box);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0])?.focus(); }
    if (e.key === 'Enter' && items[0]) { e.preventDefault(); openRecord(items[0]); }
    if (e.key === 'Escape') { close(); input.blur(); }
  });
  box.addEventListener('keydown', (e) => {
    const items = $$('.gs-item', box);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[i + 1]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || input).focus(); }
    if (e.key === 'Escape') { close(); input.focus(); }
  });
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-rec]'); if (b) openRecord(b); });
  document.addEventListener('pointerdown', (e) => { if (!el.contains(e.target)) close(); });
  return { focus: () => { input.focus(); input.select(); } };
}
