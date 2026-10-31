// Espace de travail multi-onglets. Chaque onglet garde son propre conteneur DOM :
// changer d'onglet ne perd ni la saisie en cours, ni le défilement, ni la sélection.
import { emit, on } from '../core/bus.js';
import { setActiveViewGetter } from '../core/commands.js';
import { $, debounce, h, uid } from '../core/dom.js';
import { loadTabs, saveTabs } from '../core/prefs.js';
import { confirmDialog } from './ModalManager.js';

const MAX_TABS = 20;
const factories = {};
export function registerView(kind, factory) { factories[kind] = factory; }

class Workspace {
  constructor() {
    this.tabs = [];
    this.activeId = null;
    this.history = [];
    this.persist = debounce(() => this.save(), 400);
    on('tab-changed', () => { emit('tabs', this.tabs); this.persist(); });
  }

  mount(el) { this.el = el; setActiveViewGetter(() => this.active()?.view ?? null); }

  active() { return this.tabs.find((t) => t.id === this.activeId) || null; }
  find(id) { return this.tabs.find((t) => t.id === id); }

  /** Crée (ou réactive) un onglet. desc = { id, kind, viewKey, module, recordId, mode, defaults, state } */
  open(desc, { activate = true } = {}) {
    const existing = desc.id && this.find(desc.id);
    if (existing) { if (activate) this.activate(existing.id); return existing; }
    if (this.tabs.length >= MAX_TABS) {
      emit('toast', { type: 'error', message: `${MAX_TABS} onglets ouverts au maximum. Fermez-en un pour continuer.` });
      return null;
    }
    const factory = factories[desc.kind];
    if (!factory) throw new Error(`Type d’onglet inconnu : ${desc.kind}`);
    const tab = { id: desc.id || `t-${uid()}`, kind: desc.kind, desc };
    tab.el = h(`<div class="tab-pane" data-tab="${tab.id}" hidden></div>`);
    this.el.appendChild(tab.el);
    tab.view = factory(tab, this);
    this.tabs.push(tab);
    tab.view.mount(tab.el);
    if (activate) this.activate(tab.id); else emit('tab-changed');
    return tab;
  }

  activate(id, { fromHistory = false } = {}) {
    const tab = this.find(id);
    if (!tab) return;
    const prev = this.active();
    if (prev && prev.id !== id) {
      prev.el.hidden = true;
      prev.view.deactivate?.();
      if (!fromHistory) this.history.push(prev.id);
      this.history = this.history.slice(-50);
    }
    this.activeId = id;
    tab.el.hidden = false;
    tab.view.activate?.();
    emit('tab-changed');
    emit('context-changed');
  }

  async close(id, { force = false } = {}) {
    const tab = this.find(id);
    if (!tab) return true;
    if (!force && tab.view.isDirty?.()) {
      this.activate(id);
      const ok = await confirmDialog(`Fermer « ${tab.view.title()} » sans enregistrer ?`, { title: 'Modifications non enregistrées', ok: 'Fermer sans enregistrer', danger: true, detail: 'Les saisies de cet onglet seront perdues.' });
      if (!ok) return false;
    }
    const idx = this.tabs.indexOf(tab);
    tab.view.destroy?.();
    tab.el.remove();
    this.tabs.splice(idx, 1);
    this.history = this.history.filter((x) => x !== id);
    if (this.activeId === id) {
      this.activeId = null;
      const back = this.history.pop();
      const next = this.find(back) || this.tabs[Math.min(idx, this.tabs.length - 1)];
      if (next) this.activate(next.id, { fromHistory: true });
      else { emit('tab-changed'); emit('context-changed'); }
    } else emit('tab-changed');
    return true;
  }

  async closeAll({ except } = {}) {
    for (const t of [...this.tabs]) if (t.id !== except) { if (!(await this.close(t.id))) return false; }
    return true;
  }

  /** Un formulaire de création devient la fiche de l'enregistrement créé. */
  rekey(tab, newId) {
    if (this.find(newId)) return;
    const old = tab.id;
    tab.id = newId;
    tab.desc.id = newId;
    tab.el.dataset.tab = newId;
    if (this.activeId === old) this.activeId = newId;
    this.history = this.history.map((x) => (x === old ? newId : x));
    emit('tab-changed');
  }

  back() {
    while (this.history.length) {
      const id = this.history.pop();
      if (this.find(id)) { this.activate(id, { fromHistory: true }); return; }
    }
  }
  cycle(step) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + step + this.tabs.length) % this.tabs.length].id);
  }
  move(id, toIndex) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [t] = this.tabs.splice(i, 1);
    this.tabs.splice(toIndex, 0, t);
    emit('tab-changed');
  }

  /** Après une écriture : les listes et le tableau de bord se rechargeront à leur prochain affichage. */
  invalidate(module) {
    for (const t of this.tabs) t.view.invalidate?.(module);
    const a = this.active();
    if (a && a.view.stale) a.view.refresh?.();
  }

  save() {
    const tabs = this.tabs.map((t) => t.view.serialize?.()).filter(Boolean);
    saveTabs({ tabs, active: this.tabs.findIndex((t) => t.id === this.activeId) });
  }
  restore() {
    const saved = loadTabs();
    if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return false;
    const opened = saved.tabs.map((d) => { try { return this.open(d, { activate: false }); } catch { return null; } });
    const target = opened[saved.active] || opened.find(Boolean);
    if (target) this.activate(target.id);
    return !!target;
  }
  reset() { for (const t of this.tabs) { t.view.destroy?.(); t.el.remove(); } this.tabs = []; this.activeId = null; this.history = []; if (this.el) this.el.innerHTML = ''; }
}

export const workspace = new Workspace();
export const paneOf = (tab) => $('.view', tab.el) || tab.el;
