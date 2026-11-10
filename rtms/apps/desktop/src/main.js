// RAHA TRANSPORT RTMS — application de bureau Windows (Electron), 100 % hors ligne.
//
// Trois rôles, choisis au premier lancement :
//  • « Poste principal » : ce poste héberge la base (PostgreSQL intégré) et le serveur RTMS.
//    Les autres postes s'y connectent par le câble ou le wifi de la box, sans Internet.
//  • « Poste de travail » : se connecte au poste principal (recherche automatique sur le réseau).
//  • « Démonstration » : données fictives, sans serveur.
'use strict';
const { app, BrowserWindow, Menu, Tray, Notification, dialog, ipcMain, nativeImage, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeServerUrl, isLocalHost } = require('./serverUrl');
const { discover, electronFingerprintToHex, probeCertificate, machineId, lanAddresses } = require('./net-utils');
const { LocalServer } = require('./local-server');

const APP_SCHEME = 'rtms';
const LOCAL = `${APP_SCHEME}://app`;
const WEB_ROOT = path.join(__dirname, '..', 'webapp');
const PAGES_ROOT = path.join(__dirname, 'pages');
const MAIN_PORT = 8443; // port par défaut ; le poste principal peut en prendre un autre si celui-ci est occupé
const mainPort = () => (server && server.info && server.info.port) || MAIN_PORT;
const HIDDEN_START = process.argv.includes('--hidden');
// Édition livrée aux clients : sans mode démonstration. RTMS_DEMO=1 le réactive (présentations, tests).
const DEMO_ENABLED = process.env.RTMS_DEMO === '1';

protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);

// ---------------------------------------------------------------- configuration du poste
const configPath = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; } }
function writeConfig(c) { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 }); }
const patchConfig = (p) => writeConfig({ ...readConfig(), ...p });

// Serveur embarqué : dans l'application installée, sous resources/server ; en développement, apps/api.
function serverPaths() {
  if (app.isPackaged) return { root: path.join(process.resourcesPath, 'server'), web: path.join(process.resourcesPath, 'server', 'web') };
  return { root: path.join(__dirname, '..', '..', 'api'), web: path.join(__dirname, '..', '..', 'web') };
}

let win = null;
let tray = null;
let server = null;
let quitting = false;
let allowedOrigin = null;
const pins = new Map(); // empreinte épinglée (hex) → raison

// ---------------------------------------------------------------- pages locales (rtms://app)
function mimeOf(p) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream';
}
function registerLocalProtocol() {
  protocol.handle(APP_SCHEME, (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'desktop/launcher.html';
    const root = rel.startsWith('desktop/') ? PAGES_ROOT : WEB_ROOT;
    if (rel.startsWith('desktop/')) rel = rel.slice('desktop/'.length);
    const file = path.normalize(path.join(root, rel));
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return new Response(fs.readFileSync(file), { headers: { 'content-type': mimeOf(file), 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" } });
    }
    return new Response('Introuvable', { status: 404 });
  });
}

// ---------------------------------------------------------------- certificat du poste principal
// Le poste principal présente un certificat auto-signé. Il est accepté uniquement si son empreinte
// est celle enregistrée lors de la première connexion (comme une clé SSH). Une empreinte différente
// bloque la connexion : quelqu'un pourrait se faire passer pour le poste principal.
function installCertificatePinning() {
  session.defaultSession.setCertificateVerifyProc((req, cb) => {
    const fp = electronFingerprintToHex(req.certificate.fingerprint);
    if (pins.has(fp)) return cb(0);
    const cfg = readConfig();
    let pinnedHost = null;
    try { pinnedHost = cfg.serverUrl ? new URL(cfg.serverUrl).hostname : null; } catch { /* ignoré */ }
    if (cfg.fingerprint && req.hostname === pinnedHost && req.verificationResult !== 'net::OK') {
      certMismatch = { host: req.hostname, expected: cfg.fingerprint, received: fp };
      return cb(-2);
    }
    return cb(-3); // vérification normale (certificat d'une autorité reconnue)
  });
}
let certMismatch = null;

// ---------------------------------------------------------------- proxy
// Un proxy configuré sous Windows (souvent en entreprise) ne sait pas joindre les postes du réseau
// local : pour une adresse locale, la connexion est directe. Sinon, réglages du système.
function applyProxyFor(hostname) {
  return session.defaultSession.setProxy(isLocalHost(hostname) ? { mode: 'direct' } : { mode: 'system' });
}

// ---------------------------------------------------------------- démarrage selon le rôle
async function loadStart() {
  const cfg = readConfig();
  certMismatch = null;
  pins.clear();
  if (cfg.mode === 'main') return startMain();
  if (cfg.mode === 'client' && cfg.serverUrl) {
    if (cfg.fingerprint) pins.set(cfg.fingerprint, 'poste principal');
    allowedOrigin = cfg.serverUrl;
    await applyProxyFor(new URL(cfg.serverUrl).hostname);
    return win.loadURL(cfg.serverUrl).catch(() => {});
  }
  if (cfg.mode === 'demo' && DEMO_ENABLED) { allowedOrigin = LOCAL; return win.loadURL(`${LOCAL}/demo.html`); }
  allowedOrigin = LOCAL;
  return win.loadURL(`${LOCAL}/desktop/launcher.html`);
}

async function startMain() {
  const cfg = readConfig();
  allowedOrigin = `https://127.0.0.1:${MAIN_PORT}`;
  win.loadURL(`${LOCAL}/desktop/starting.html`);
  const { root, web } = serverPaths();
  if (!server) {
    server = new LocalServer({ serverRoot: root, dataDir: path.join(app.getPath('userData'), 'donnees'), port: MAIN_PORT, deviceId: machineId(), backupCopyDir: cfg.backupCopyDir || '' });
    server.webRoot = web;
    const origEnv = server.env.bind(server);
    server.env = (extra) => ({ ...origEnv(extra), RTMS_WEB_ROOT: web });
    server.on('event', (ev) => {
      if (ev.event === 'log' && win) win.webContents.send('rtms:server-log', ev.message);
      if (ev.event === 'backup') notify('Sauvegarde RTMS terminée', `${path.basename(ev.file)} — ${Math.round(ev.size / 1024)} Ko`);
      if (ev.event === 'backup-error') notify('Sauvegarde RTMS en échec', ev.error);
    });
    server.on('state', () => updateTray());
  }
  try {
    const info = await server.start();
    pins.set(info.fingerprint, 'ce poste');
    updateTray();
    allowedOrigin = `https://127.0.0.1:${info.port}`;
    if (win && !win.isDestroyed()) win.loadURL(`https://127.0.0.1:${info.port}`);
  } catch (e) {
    const q = new URLSearchParams({ err: e.message, main: '1' });
    if (win && !win.isDestroyed()) win.loadURL(`${LOCAL}/desktop/offline.html?${q}`);
  }
}

// Poste de travail : si le poste principal a changé d'adresse (box, DHCP), on le retrouve par son empreinte.
async function rediscover() {
  const cfg = readConfig();
  if (cfg.mode !== 'client' || !cfg.fingerprint) return false;
  const list = await discover(1500);
  const hit = list.find((s) => s.fingerprint === cfg.fingerprint);
  if (!hit) return false;
  const origin = `https://${hit.address}:${hit.port}`;
  if (origin === cfg.serverUrl) return false;
  patchConfig({ serverUrl: origin });
  return true;
}

// ---------------------------------------------------------------- fenêtre
function createWindow() {
  const cfg = readConfig();
  win = new BrowserWindow({
    ...(cfg.bounds || { width: 1440, height: 900 }),
    minWidth: 1180, minHeight: 700, show: false,
    title: 'RAHA TRANSPORT MANAGEMENT SYSTEM (RTMS)',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#123f32',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: !app.isPackaged },
  });
  if (cfg.maximized) win.maximize();
  win.once('ready-to-show', () => { if (!(HIDDEN_START && cfg.mode === 'main')) win.show(); });
  win.on('page-title-updated', (e) => e.preventDefault());

  const allowed = (url) => {
    try { const o = new URL(url).origin; return o === allowedOrigin || url.startsWith(`${LOCAL}/`); } catch { return false; }
  };
  win.webContents.on('will-navigate', (e, url) => { if (!allowed(url)) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('did-fail-load', async (_e, code, desc, _url, isMain) => {
    if (!isMain || code === -3) return;
    if (readConfig().mode === 'client' && !certMismatch && (await rediscover())) return loadStart();
    const q = new URLSearchParams({ url: allowedOrigin || '', err: desc });
    if (certMismatch) { q.set('cert', '1'); q.set('expected', certMismatch.expected); q.set('received', certMismatch.received); }
    win.loadURL(`${LOCAL}/desktop/offline.html?${q}`);
  });

  win.on('close', (e) => {
    const c = readConfig();
    c.maximized = win.isMaximized();
    if (!c.maximized) c.bounds = win.getBounds();
    writeConfig(c);
    // Poste principal : fermer la fenêtre ne coupe pas les autres postes
    if (c.mode === 'main' && !quitting) {
      e.preventDefault();
      win.hide();
      if (!c.trayHintShown) { notify('RTMS reste actif', 'Le poste principal continue de servir les autres postes. Pour l’arrêter : icône RTMS près de l’horloge › Quitter.'); patchConfig({ trayHintShown: true }); }
    }
  });
  loadStart();
}

function showWindow() { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } }

function notify(title, body) { try { if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, '..', 'build', 'icon.png') }).show(); } catch { /* ignoré */ } }

// ---------------------------------------------------------------- icône près de l'horloge (poste principal)
function updateTray() {
  const cfg = readConfig();
  if (cfg.mode !== 'main') { if (tray) { tray.destroy(); tray = null; } return; }
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 }));
    tray.on('click', showWindow);
  }
  const state = server ? server.state : 'arrêté';
  const addrs = lanAddresses();
  const fp = server && server.info ? server.info.fingerprint : '';
  tray.setToolTip(`RTMS — poste principal (${state})`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir RTMS', click: showWindow },
    { type: 'separator' },
    { label: `Poste principal : ${state}`, enabled: false },
    { label: addrs.length ? `Adresse : https://${addrs[0]}:${mainPort()}` : 'Aucun réseau détecté', enabled: false },
    { label: fp ? `Empreinte : ${fp.split(':').slice(0, 6).join(':')}…` : 'Empreinte : —', enabled: false },
    { label: 'Afficher les informations de connexion…', click: showMainInfo },
    { type: 'separator' },
    { label: 'Sauvegarder maintenant', enabled: state === 'actif', click: () => { server.command('backup'); notify('Sauvegarde RTMS', 'Sauvegarde en cours…'); } },
    { label: 'Ouvrir le dossier des sauvegardes', click: () => shell.openPath(path.join(app.getPath('userData'), 'donnees', 'sauvegardes')) },
    { label: cfg.backupCopyDir ? `Copie de sécurité : ${cfg.backupCopyDir}` : 'Choisir une copie de sécurité (clé USB, disque)…', click: chooseBackupCopyDir },
    { label: 'Restaurer une sauvegarde…', click: restoreFromTray },
    { type: 'separator' },
    ...(process.platform === 'win32' ? [{ label: 'Autoriser les autres postes (pare-feu Windows)…', click: openFirewall }] : []),
    { label: 'Démarrer avec Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { type: 'separator' },
    { label: 'Quitter (arrête le poste principal)', click: () => { quitting = true; app.quit(); } },
  ]));
}

async function showMainInfo() {
  const fp = server && server.info ? server.info.fingerprint : '—';
  const addrs = lanAddresses();
  await dialog.showMessageBox(win && win.isVisible() ? win : undefined, {
    type: 'info', title: 'Poste principal RTMS', message: 'Informations pour connecter les autres postes',
    detail: `Les autres postes trouvent ce poste automatiquement (bouton « Rechercher »).\n\nAdresse(s) à saisir si besoin :\n${addrs.map((a) => `   https://${a}:${mainPort()}`).join('\n') || '   (aucun réseau)'}\n\nEmpreinte du certificat (à comparer sur l’autre poste) :\n${fp}\n\nConseil : réservez une adresse IP fixe pour ce poste dans la box.`,
    buttons: ['OK'],
  });
}

async function chooseBackupCopyDir() {
  const r = await dialog.showOpenDialog({ title: 'Dossier de copie des sauvegardes (clé USB ou disque externe)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  patchConfig({ backupCopyDir: r.filePaths[0] });
  if (server) { server.backupCopyDir = r.filePaths[0]; await server.stop(); await startMain(); }
  updateTray();
}

async function restoreFromTray() {
  const dir = path.join(app.getPath('userData'), 'donnees', 'sauvegardes');
  const r = await dialog.showOpenDialog({ title: 'Choisir la sauvegarde à restaurer', defaultPath: dir, filters: [{ name: 'Sauvegarde RTMS', extensions: ['rtmsbak'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return;
  const ok = await dialog.showMessageBox({ type: 'warning', title: 'Restaurer une sauvegarde', message: `Restaurer « ${path.basename(r.filePaths[0])} » ?`,
    detail: 'Le logiciel sera indisponible pour tous les postes pendant quelques instants. Les saisies faites après cette sauvegarde ne figureront plus dans RTMS (la base actuelle est conservée à part, pour un retour arrière par un technicien).',
    buttons: ['Restaurer', 'Annuler'], defaultId: 1, cancelId: 1 });
  if (ok.response !== 0) return;
  try {
    if (win && !win.isDestroyed()) win.loadURL(`${LOCAL}/desktop/starting.html?restore=1`);
    const res = await server.restore(r.filePaths[0]);
    await dialog.showMessageBox({ type: 'info', title: 'Restauration terminée', message: 'Restauration réussie', detail: `${res.rows} éléments restaurés (sauvegarde du ${new Date(res.backupDate).toLocaleString('fr-FR')}). Journal d’audit vérifié.` });
  } catch (e) {
    await dialog.showMessageBox({ type: 'error', title: 'Restauration impossible', message: 'La restauration a échoué ; la base actuelle est intacte.', detail: e.message });
  }
  await startMain();
}

/** Règles de pare-feu (une seule fois, demande d'autorisation Windows) : réseau local uniquement. */
function openFirewall() {
  const rules = [
    `netsh advfirewall firewall add rule name="RTMS poste principal (HTTPS)" dir=in action=allow protocol=TCP localport=${MAIN_PORT}-${MAIN_PORT + 9} remoteip=localsubnet profile=any`,
    'netsh advfirewall firewall add rule name="RTMS poste principal (découverte)" dir=in action=allow protocol=UDP localport=41730 remoteip=localsubnet profile=any',
  ].join(' & ');
  const ps = `Start-Process -FilePath cmd.exe -ArgumentList '/c ${rules.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden`;
  require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err) => {
    notify('Pare-feu Windows', err ? 'Autorisation annulée ou refusée.' : 'Les autres postes du réseau local peuvent se connecter.');
  });
}

// ---------------------------------------------------------------- échanges avec les pages
const fromTrusted = (e) => {
  try { const u = new URL(e.senderFrame.url); return u.origin === allowedOrigin || u.protocol === `${APP_SCHEME}:`; } catch { return false; }
};
const guard = (fn) => async (e, ...args) => { if (!fromTrusted(e)) throw new Error('Refusé'); return fn(e, ...args); };

ipcMain.handle('rtms:info', () => { const c = readConfig(); return { version: app.getVersion(), mode: c.mode || null, server: c.serverUrl || null, platform: process.platform, demo: DEMO_ENABLED }; });
ipcMain.handle('rtms:discover', guard(() => discover(1800)));

/** Vérifie un poste (découvert ou saisi) : adresse, certificat, réponse RTMS. */
ipcMain.handle('rtms:probe', guard(async (_e, input) => {
  const origin = normalizeServerUrl(/^https?:\/\//.test(String(input)) ? input : `https://${String(input).trim()}${/:\d+$/.test(String(input).trim()) ? '' : `:${MAIN_PORT}`}`);
  const u = new URL(origin);
  if (u.protocol !== 'https:') throw new Error('Le poste principal RTMS utilise https://');
  const cert = await probeCertificate(u.hostname, Number(u.port || 443));
  await applyProxyFor(u.hostname);
  pins.set(cert.fingerprint, 'vérification');
  try {
    const res = await net.fetch(`${origin}/readyz`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error('Ce poste répond mais n’est pas un serveur RTMS prêt.');
    return { origin, fingerprint: cert.fingerprint, trusted: cert.authorized, version: body.version || '' };
  } finally { pins.delete(cert.fingerprint); }
}));
ipcMain.handle('rtms:connect', guard((_e, { origin, fingerprint, trusted }) => {
  const o = normalizeServerUrl(origin);
  writeConfig({ ...readConfig(), mode: 'client', serverUrl: o, fingerprint: trusted ? null : String(fingerprint || '').toUpperCase() || null });
  updateTray();
  loadStart();
  return true;
}));
ipcMain.handle('rtms:use-main', guard(() => {
  patchConfig({ mode: 'main' });
  if (process.platform === 'win32' || app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  loadStart();
  return true;
}));
ipcMain.handle('rtms:use-demo', guard(() => { if (!DEMO_ENABLED) throw new Error('Mode démonstration non disponible'); patchConfig({ mode: 'demo' }); loadStart(); return true; }));
ipcMain.handle('rtms:change-server', guard(async () => {
  const c = readConfig();
  if (c.mode === 'main' && server) { await server.stop(); }
  delete c.mode; delete c.serverUrl; delete c.fingerprint;
  writeConfig(c);
  updateTray();
  loadStart();
  return true;
}));
ipcMain.handle('rtms:retry', guard(async () => { if (readConfig().mode === 'client') await rediscover(); loadStart(); return true; }));
ipcMain.handle('rtms:main-info', guard(() => ({ state: server ? server.state : 'arrêté', fingerprint: server && server.info ? server.info.fingerprint : null, addresses: lanAddresses(), port: mainPort() })));
ipcMain.handle('rtms:firewall', guard(() => { if (process.platform === 'win32') openFirewall(); return process.platform === 'win32'; }));

/** Vrai fichier PDF A4 à partir de l'aperçu d'impression préparé par l'application. */
ipcMain.handle('rtms:save-pdf', guard(async (e, suggestedName) => {
  const name = String(suggestedName || 'document').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
  const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Enregistrer le PDF', defaultPath: path.join(app.getPath('desktop'), `${name}.pdf`), filters: [{ name: 'Document PDF', extensions: ['pdf'] }] });
  if (canceled || !filePath) return { saved: false };
  const pdf = await e.sender.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
  fs.writeFileSync(filePath, pdf);
  shell.openPath(filePath);
  return { saved: true, path: filePath };
}));

// ---------------------------------------------------------------- export de factures (Bureau, clé USB)
// La page ne fournit jamais de chemin : elle choisit parmi des destinations proposées ici
// (identifiants opaques). Une page compromise ne peut donc pas écrire ailleurs sur le disque.
const exportDirs = new Map();
const newExportId = (dir, removable = false) => { const id = require('node:crypto').randomBytes(9).toString('hex'); exportDirs.set(id, { dir, removable }); return id; };

ipcMain.handle('rtms:export-targets', guard(async () => {
  exportDirs.clear();
  const out = [
    { label: 'Bureau', detail: app.getPath('desktop'), kind: 'local', id: newExportId(app.getPath('desktop')) },
    { label: 'Documents', detail: app.getPath('documents'), kind: 'local', id: newExportId(app.getPath('documents')) },
  ];
  for (const d of await removableDrives()) out.push({ label: `Clé USB ${d.label}`, detail: d.path, kind: 'usb', id: newExportId(d.path, true) });
  return out;
}));
ipcMain.handle('rtms:choose-export-folder', guard(async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choisir le dossier d’export', defaultPath: app.getPath('desktop'), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : newExportId(r.filePaths[0]);
}));
ipcMain.handle('rtms:write-pdf', guard(async (e, id, suggestedName) => {
  const target = exportDirs.get(String(id));
  if (!target) throw new Error('Destination inconnue : rouvrez la fenêtre d’export.');
  const base = target.dir;
  if (target.removable && !fs.existsSync(base)) throw new Error('Clé USB introuvable : a-t-elle été retirée ?');
  const folder = path.join(base, 'Factures RTMS');
  fs.mkdirSync(folder, { recursive: true });
  const name = String(suggestedName || 'Facture').replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').slice(0, 120) || 'Facture';
  let file = path.join(folder, `${name}.pdf`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(folder, `${name} (${i}).pdf`);
  const pdf = await e.sender.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
  fs.writeFileSync(file, pdf);
  return { file, folder };
}));
ipcMain.handle('rtms:open-folder', guard(async (_e, id) => {
  const target = exportDirs.get(String(id));
  if (target) shell.openPath(path.join(target.dir, 'Factures RTMS'));
}));

/** Clés USB et disques amovibles branchés. */
function removableDrives() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // DriveType 2 = amovible (clé USB, carte SD)
      const ps = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { $_.DeviceID + '|' + $_.VolumeName }";
      require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [dev, vol] = l.split('|'); return { path: `${dev}\\`, label: `(${dev})${vol ? ` — ${vol}` : ''}` }; }));
      });
      return;
    }
    const user = require('node:os').userInfo().username;
    const roots = [`/media/${user}`, `/run/media/${user}`, '/Volumes'];
    const found = [];
    for (const r of roots) { try { for (const n of fs.readdirSync(r)) { const p = path.join(r, n); if (fs.statSync(p).isDirectory()) found.push({ path: p, label: n }); } } catch { /* absent */ } }
    resolve(found);
  });
}

// ---------------------------------------------------------------- cycle de vie
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    installCertificatePinning();
    // Nom du poste, affiché dans « Personnes connectées » (information d'affichage, pas d'authentification)
    const poste = require('node:os').hostname().replace(/[^\w .-]/g, '').slice(0, 60);
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*/api/*'] }, (d, cb) => cb({ requestHeaders: { ...d.requestHeaders, 'x-rtms-poste': poste } }));
    registerLocalProtocol();
    createWindow();
    updateTray();
  });
  app.on('before-quit', (e) => {
    quitting = true;
    if (server && server.proc) {
      e.preventDefault();
      server.stop().finally(() => { server = null; app.quit(); });
    }
  });
  app.on('window-all-closed', () => { if (readConfig().mode !== 'main') app.quit(); });
}
