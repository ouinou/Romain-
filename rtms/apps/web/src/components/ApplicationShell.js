// Coque de l'application : (1) barre de menus et recherche, (2) barre de commandes
// contextuelles, (3) barre d'outils verticale, (4) onglets + espace de travail,
// (5) panneaux droits redimensionnables, (6) barre d'état.
import { $ } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { mountContextToolbar } from './ContextToolbar.js';
import { mountGlobalSearch } from './GlobalSearch.js';
import { mountLeftToolBar } from './LeftToolBar.js';
import { workspace } from './MainWorkspace.js';
import { mountRightPanel } from './RightPropertiesPanel.js';
import { mountStatusBar } from './StatusBar.js';
import { mountTopMenuBar } from './TopMenuBar.js';
import { mountWorkspaceTabs } from './WorkspaceTabs.js';

export function mountApplicationShell(root) {
  root.innerHTML = `
    <header class="appbar">
      <div class="brand-mini" title="RAHA TRANSPORT Management System"><strong>RAHA TRANSPORT</strong><small>RTMS</small></div>
      <nav class="menubar" role="menubar" aria-label="Menu principal"></nav>
      <div class="appbar-right">
        <div class="gs-host"></div>
        <button type="button" class="icon-btn bell" data-bell aria-label="Notifications" title="Notifications">${icon('bell', 17)}<span class="badge" data-bell-count hidden></span></button>
        <span class="who" data-who></span>
        <button type="button" class="icon-btn" data-cmd="session.logout" title="Déconnexion">${icon('logout', 16)}</button>
      </div>
    </header>
    <div class="ctxbar" role="toolbar" aria-label="Commandes du module"></div>
    <div class="body">
      <aside class="toolrail" role="toolbar" aria-orientation="vertical" aria-label="Modules"></aside>
      <main class="work">
        <div class="wtabs" role="tablist" aria-label="Onglets ouverts"></div>
        <div class="panes"></div>
      </main>
      <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Redimensionner le panneau" title="Glisser pour redimensionner · double-clic pour masquer"></div>
      <aside class="rpanel" aria-label="Panneaux"></aside>
    </div>
    <footer class="statusbar" role="status"></footer>`;
  const menu = mountTopMenuBar($('.menubar', root));
  mountContextToolbar($('.ctxbar', root));
  mountLeftToolBar($('.toolrail', root));
  workspace.mount($('.panes', root));
  mountWorkspaceTabs($('.wtabs', root));
  mountRightPanel($('.rpanel', root), $('.splitter', root));
  mountStatusBar($('.statusbar', root));
  const search = mountGlobalSearch($('.gs-host', root));
  return { menu, search };
}
