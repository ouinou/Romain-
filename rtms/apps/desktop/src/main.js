// RAHA TRANSPORT RTMS — application de bureau Windows (Electron).
// Le poste n'accède jamais directement à la base : il affiche l'application servie par
// le serveur central RTMS (HTTPS). Un mode démonstration hors ligne est fourni.
'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_SCHEME = 'rtms';
const LOCAL = `${APP_SCHEME}://app`;
const WEB_ROOT = path.join(__dirname, '..', 'webapp');
const PAGES_ROOT = path.join(__dirname, 'pages');

// Fichiers locaux servis par un protocole sécurisé (les modules ES ne fonctionnent pas en file://)
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);

const configPath = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function writeConfig(c) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
}

const { normalizeServerUrl } = require('./serverUrl');

let win = null;
let allowedOrigin = null;

function mimeOf(p) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream';
}
function registerLocalProtocol() {
  protocol.handle(APP_SCHEME, (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'launcher.html';
    // Pages de l'application de bureau (lanceur, hors ligne) puis copie de l'application web (démo)
    const roots = rel.startsWith('desktop/') ? [PAGES_ROOT] : [WEB_ROOT];
    if (rel.startsWith('desktop/')) rel = rel.slice('desktop/'.length);
    for (const root of roots) {
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) break; // pas de sortie du dossier
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return new Response(fs.readFileSync(file), { headers: { 'content-type': mimeOf(file), 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: http:" } });
      }
    }
    return new Response('Introuvable', { status: 404 });
  });
}

function loadStart() {
  const cfg = readConfig();
  if (cfg.mode === 'server' && cfg.serverUrl) {
    allowedOrigin = cfg.serverUrl;
    win.loadURL(cfg.serverUrl).catch(() => {});
  } else if (cfg.mode === 'demo') {
    allowedOrigin = LOCAL;
    win.loadURL(`${LOCAL}/demo.html`);
  } else {
    allowedOrigin = LOCAL;
    win.loadURL(`${LOCAL}/desktop/launcher.html`);
  }
}

function createWindow() {
  const cfg = readConfig();
  const b = cfg.bounds || { width: 1440, height: 900 };
  win = new BrowserWindow({
    ...b,
    minWidth: 1180,
    minHeight: 700,
    show: false,
    title: 'RAHA TRANSPORT MANAGEMENT SYSTEM (RTMS)',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#123f32',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  if (cfg.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Le titre de la fenêtre reste celui de l'application, quel que soit le document
  win.on('page-title-updated', (e) => e.preventDefault());

  // Navigation limitée au serveur choisi et aux pages locales
  const allowed = (url) => {
    try { const o = new URL(url).origin; return o === allowedOrigin || url.startsWith(`${LOCAL}/`); } catch { return false; }
  };
  win.webContents.on('will-navigate', (e, url) => { if (!allowed(url)) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 : navigation interrompue
    const q = new URLSearchParams({ url: allowedOrigin || '', err: desc });
    win.loadURL(`${LOCAL}/desktop/offline.html?${q}`);
  });

  const saveBounds = () => {
    const c = readConfig();
    c.maximized = win.isMaximized();
    if (!c.maximized) c.bounds = win.getBounds();
    writeConfig(c);
  };
  win.on('close', saveBounds);
  loadStart();
}

// ---------------------------------------------------------------- échanges avec la page
const fromTrusted = (e) => {
  try { const u = new URL(e.senderFrame.url); return u.origin === allowedOrigin || u.protocol === `${APP_SCHEME}:`; } catch { return false; }
};
ipcMain.handle('rtms:test-server', async (e, input) => {
  if (!fromTrusted(e)) throw new Error('Refusé');
  const origin = normalizeServerUrl(input);
  const res = await net.fetch(`${origin}/readyz`, { method: 'GET' });
  if (!res.ok) throw new Error(`Le serveur répond, mais n’est pas prêt (code ${res.status}).`);
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error('Ce serveur ne semble pas être un serveur RTMS.');
  return { origin, version: body.version || '' };
});
ipcMain.handle('rtms:use-server', (e, origin) => {
  if (!fromTrusted(e)) throw new Error('Refusé');
  const o = normalizeServerUrl(origin);
  writeConfig({ ...readConfig(), mode: 'server', serverUrl: o });
  loadStart();
  return true;
});
ipcMain.handle('rtms:use-demo', (e) => {
  if (!fromTrusted(e)) throw new Error('Refusé');
  writeConfig({ ...readConfig(), mode: 'demo' });
  loadStart();
  return true;
});
ipcMain.handle('rtms:change-server', (e) => {
  if (!fromTrusted(e)) throw new Error('Refusé');
  const c = readConfig();
  delete c.mode; delete c.serverUrl;
  writeConfig(c);
  loadStart();
  return true;
});
ipcMain.handle('rtms:retry', (e) => { if (!fromTrusted(e)) throw new Error('Refusé'); loadStart(); return true; });
ipcMain.handle('rtms:info', () => ({ version: app.getVersion(), mode: readConfig().mode || null, server: readConfig().serverUrl || null }));

/** Vrai fichier PDF A4 à partir de l'aperçu d'impression préparé par l'application. */
ipcMain.handle('rtms:save-pdf', async (e, suggestedName) => {
  if (!fromTrusted(e)) throw new Error('Refusé');
  const name = String(suggestedName || 'document').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Enregistrer le PDF',
    defaultPath: path.join(app.getPath('documents'), `${name}.pdf`),
    filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { saved: false };
  const pdf = await e.sender.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
  fs.writeFileSync(filePath, pdf);
  shell.openPath(filePath);
  return { saved: true, path: filePath };
});

// ---------------------------------------------------------------- cycle de vie
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // l'application a sa propre barre de menus
    // Aucune permission matérielle (caméra, micro, position, notifications système...)
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    registerLocalProtocol();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}

