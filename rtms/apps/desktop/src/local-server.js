'use strict';
// Pilotage du serveur RTMS du poste principal (processus enfant, base PostgreSQL intégrée).
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

class LocalServer extends EventEmitter {
  constructor({ serverRoot, dataDir, port, deviceId, backupCopyDir }) {
    super();
    Object.assign(this, { serverRoot, dataDir, port, deviceId, backupCopyDir });
    this.proc = null;
    this.state = 'arrêté';
    this.info = null;
  }

  script() { return path.join(this.serverRoot, 'dist', 'local', 'server.js'); }

  env(extra = {}) {
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // le moteur Node d'Electron exécute le serveur : rien d'autre à installer
      RTMS_DATA_DIR: this.dataDir,
      RTMS_PORT: String(this.port),
      RTMS_WEB_ROOT: path.join(this.serverRoot, 'web'),
      RTMS_MIGRATIONS_DIR: path.join(this.serverRoot, 'prisma', 'migrations'),
      RTMS_DEVICE_ID: this.deviceId,
      RTMS_BACKUP_COPY_DIR: this.backupCopyDir || '',
      NODE_TLS_REJECT_UNAUTHORIZED: undefined,
      ...extra,
    };
  }

  run(args, onEvent) {
    const proc = spawn(process.execPath, [this.script(), ...args], { env: this.env(), cwd: this.serverRoot, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('RTMS_EVENT ')) { try { onEvent(JSON.parse(line.slice(11))); } catch { /* ignoré */ } }
      }
    });
    const logFile = path.join(this.dataDir, 'journal-serveur.log');
    fs.mkdirSync(this.dataDir, { recursive: true });
    const log = fs.createWriteStream(logFile, { flags: 'a' });
    proc.stderr.pipe(log);
    return proc;
  }

  start() {
    if (this.proc) return Promise.resolve(this.info);
    this.state = 'démarrage';
    this.emit('state', this.state);
    return new Promise((resolve, reject) => {
      const proc = this.run([], (ev) => {
        this.emit('event', ev);
        if (ev.event === 'ready') { this.state = 'actif'; this.info = ev; this.emit('state', this.state); resolve(ev); }
        if (ev.event === 'fatal') reject(new Error(ev.error));
      });
      this.proc = proc;
      proc.on('exit', (code) => {
        this.proc = null;
        this.state = 'arrêté';
        this.emit('state', this.state);
        if (code) reject(new Error(`Le serveur s’est arrêté (code ${code}). Voir journal-serveur.log.`));
      });
    });
  }

  command(cmd) { if (this.proc) this.proc.stdin.write(`${cmd}\n`); }

  stop() {
    if (!this.proc) return Promise.resolve();
    return new Promise((resolve) => {
      const p = this.proc;
      const t = setTimeout(() => { try { p.kill(); } catch { /* ignoré */ } }, 45_000);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      this.command('stop');
    });
  }

  /** Restauration : serveur arrêté, base actuelle conservée sous un autre nom. */
  async restore(file) {
    await this.stop();
    return new Promise((resolve, reject) => {
      let result = null;
      let error = null;
      const p = this.run(['--restore', file], (ev) => { if (ev.event === 'restore-done') result = ev; if (ev.event === 'fatal') error = ev.error; });
      p.on('exit', (code) => (code === 0 && result ? resolve(result) : reject(new Error(error || `Échec de la restauration (code ${code})`))));
    });
  }
}

module.exports = { LocalServer };
