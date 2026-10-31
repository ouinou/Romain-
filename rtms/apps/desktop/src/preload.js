// Pont minimal et explicite entre la page et l'application de bureau.
// Aucune fonction Node n'est exposée : seulement ces quelques actions.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rtmsDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('rtms:info'),
  testServer: (url) => ipcRenderer.invoke('rtms:test-server', url),
  useServer: (origin) => ipcRenderer.invoke('rtms:use-server', origin),
  useDemo: () => ipcRenderer.invoke('rtms:use-demo'),
  changeServer: () => ipcRenderer.invoke('rtms:change-server'),
  retry: () => ipcRenderer.invoke('rtms:retry'),
  savePdf: (name) => ipcRenderer.invoke('rtms:save-pdf', name),
});
