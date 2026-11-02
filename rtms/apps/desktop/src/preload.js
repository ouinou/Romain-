// Pont minimal et explicite entre la page et l'application de bureau.
// Aucune fonction Node n'est exposée : seulement ces actions.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rtmsDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('rtms:info'),
  discover: () => ipcRenderer.invoke('rtms:discover'),
  probe: (address) => ipcRenderer.invoke('rtms:probe', address),
  connect: (target) => ipcRenderer.invoke('rtms:connect', target),
  useMain: () => ipcRenderer.invoke('rtms:use-main'),
  useDemo: () => ipcRenderer.invoke('rtms:use-demo'),
  changeServer: () => ipcRenderer.invoke('rtms:change-server'),
  retry: () => ipcRenderer.invoke('rtms:retry'),
  mainInfo: () => ipcRenderer.invoke('rtms:main-info'),
  firewall: () => ipcRenderer.invoke('rtms:firewall'),
  savePdf: (name) => ipcRenderer.invoke('rtms:save-pdf', name),
  exportTargets: () => ipcRenderer.invoke('rtms:export-targets'),
  chooseExportFolder: () => ipcRenderer.invoke('rtms:choose-export-folder'),
  writePdf: (id, name) => ipcRenderer.invoke('rtms:write-pdf', id, name),
  openFolder: (id) => ipcRenderer.invoke('rtms:open-folder', id),
  onServerLog: (fn) => ipcRenderer.on('rtms:server-log', (_e, m) => fn(String(m))),
});
