// Registre central des commandes : la barre de menus, la barre contextuelle,
// les menus contextuels, les raccourcis et les actions rapides appellent tous
// les mêmes commandes. Une commande s'adresse à la vue de l'onglet actif.
import { emit } from './bus.js';

const registry = new Map();
let activeViewGetter = () => null;

export function setActiveViewGetter(fn) { activeViewGetter = fn; }
export const activeView = () => activeViewGetter();

/**
 * def = { id, label, icon?, key?, global?: () => void, enabled?: () => bool }
 * Sans `global`, la commande est déléguée à view.exec(id) si view.supports(id).
 */
export function register(def) { registry.set(def.id, def); }
export const command = (id) => registry.get(id);

export function isEnabled(id) {
  const c = registry.get(id);
  if (!c) return false;
  if (c.global) return c.enabled ? !!c.enabled() : true;
  const v = activeView();
  return !!(v && v.supports && v.supports(id));
}

export async function run(id, arg) {
  const c = registry.get(id);
  if (!c || !isEnabled(id)) return false;
  try {
    if (c.global) await c.global(arg);
    else await activeView().exec(id, arg);
  } catch (e) {
    emit('toast', { type: 'error', message: e.message || String(e) });
  }
  emit('context-changed');
  return true;
}

/** Libellé dynamique (ex. « Nouvelle facture » selon la vue active). */
export function labelOf(id) {
  const c = registry.get(id);
  if (!c) return id;
  const v = activeView();
  return (v && v.labelFor && v.labelFor(id)) || c.label;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const keyLabel = (k) => (k ? (isMac ? k.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Maj\+/g, '⇧') : k) : '');

/** Raccourcis : « Ctrl+S » correspond à Ctrl (Windows) ou Cmd (macOS). */
export function matchKey(e, k) {
  if (!k) return false;
  const parts = k.split('+');
  const main = parts.pop();
  const want = { ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt'), shift: parts.includes('Maj') };
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl !== want.ctrl || e.altKey !== want.alt || e.shiftKey !== want.shift) return false;
  const map = { Suppr: 'Delete', 'Entrée': 'Enter', Échap: 'Escape', '←': 'ArrowLeft', '→': 'ArrowRight', PgPréc: 'PageUp', PgSuiv: 'PageDown', 'Retour arrière': 'Backspace' };
  const target = map[main] || main;
  return e.key.toLowerCase() === target.toLowerCase() || e.code === `Key${target.toUpperCase()}`;
}

export function allWithKeys() { return [...registry.values()].filter((c) => c.key); }
