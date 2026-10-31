// Préférences d'espace de travail, par utilisateur, dans le navigateur.
// Uniquement de la mise en page : aucune donnée métier n'est stockée ici.
import { emit } from './bus.js';
import { userKey } from './session.js';

export const PANEL_SECTIONS = ['properties', 'history', 'documents', 'quick', 'notifications', 'activity'];
export const SECTION_LABELS = { properties: 'Détails', history: 'Historique', documents: 'Documents associés', quick: 'Actions rapides', notifications: 'Notifications', activity: 'Activités récentes' };

export const PRESETS = {
  Essentiel: { panelVisible: true, panelWidth: 340, panelTab: 'props', order: ['properties', 'quick', 'documents', 'notifications', 'activity', 'history'], hidden: [], collapsed: ['notifications', 'activity'], statusBar: true, toolLabels: true, density: 'compact', sidebarCollapsed: false },
  Saisie: { panelVisible: false, panelWidth: 340, panelTab: 'props', order: ['properties', 'quick', 'documents', 'notifications', 'activity', 'history'], hidden: [], collapsed: [], statusBar: true, toolLabels: true, density: 'normal', sidebarCollapsed: true },
  Contrôle: { panelVisible: true, panelWidth: 400, panelTab: 'history', order: ['properties', 'notifications', 'activity', 'documents', 'quick', 'history'], hidden: ['quick'], collapsed: [], statusBar: true, toolLabels: true, density: 'compact', sidebarCollapsed: false },
};

const read = (k, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? fallback; } catch { return fallback; }
};
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible : préférences non conservées */ } };

let current = null;
const key = () => `rtms.ws.${userKey()}`;

export function prefs() {
  if (!current) {
    const saved = read(key(), null);
    current = { ...structuredClone(PRESETS.Essentiel), workspace: 'Essentiel', columns: {}, pageSize: 25, custom: {}, floating: {}, ...(saved || {}) };
    // Sections ajoutées dans une version ultérieure : on les rajoute
    for (const s of PANEL_SECTIONS) if (!current.order.includes(s)) current.order.push(s);
  }
  return current;
}
export function setPrefs(patch, { silent = false } = {}) {
  Object.assign(prefs(), patch);
  write(key(), current);
  if (!silent) emit('prefs', current);
}
export function resetPrefsCache() { current = null; }

export function applyWorkspace(name) {
  const p = prefs();
  const preset = PRESETS[name] || p.custom[name];
  if (!preset) return;
  setPrefs({ ...structuredClone(preset), workspace: name });
}
export function saveWorkspace(name) {
  const p = prefs();
  const snap = { panelVisible: p.panelVisible, panelWidth: p.panelWidth, panelTab: p.panelTab, order: [...p.order], hidden: [...p.hidden], collapsed: [...p.collapsed], statusBar: p.statusBar, toolLabels: p.toolLabels, density: p.density, sidebarCollapsed: p.sidebarCollapsed };
  setPrefs({ custom: { ...p.custom, [name]: snap }, workspace: name });
}
export function deleteWorkspace(name) {
  const custom = { ...prefs().custom };
  delete custom[name];
  setPrefs({ custom, workspace: prefs().workspace === name ? 'Essentiel' : prefs().workspace });
}

// Onglets et brouillons : sessionStorage (effacés à la fermeture du navigateur et à la déconnexion)
const tabsKey = () => `rtms.tabs.${userKey()}`;
export const loadTabs = () => { try { return JSON.parse(sessionStorage.getItem(tabsKey()) || 'null'); } catch { return null; } };
export const saveTabs = (v) => { try { sessionStorage.setItem(tabsKey(), JSON.stringify(v)); } catch { /* ignoré */ } };
export const clearSessionState = () => { try { sessionStorage.clear(); } catch { /* ignoré */ } };
