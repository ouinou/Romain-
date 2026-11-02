'use strict';
// Outils réseau du poste : découverte du poste principal, empreinte de certificat, identifiant machine.
const dgram = require('node:dgram');
const os = require('node:os');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const DISCOVERY_PORT = 41730;
const PROBE = 'RTMS-DISCOVER/1';

/** Adresses de diffusion des réseaux locaux du poste (wifi, câble). */
function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || !i.netmask) continue;
      const ip = i.address.split('.').map(Number);
      const mask = i.netmask.split('.').map(Number);
      out.add(ip.map((b, k) => (b & mask[k]) | (~mask[k] & 255)).join('.'));
    }
  }
  return [...out];
}

/** Cherche les postes principaux RTMS du réseau local (réponse en moins de `ms`). */
function discover(ms = 1500, extraTargets = []) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    sock.on('error', () => { try { sock.close(); } catch { /* ignoré */ } resolve([...found.values()]); });
    sock.on('message', (msg, rinfo) => {
      try {
        const j = JSON.parse(msg.toString('utf8'));
        if (j.rtms !== 1 || !j.fingerprint) return;
        const key = j.fingerprint;
        const prev = found.get(key);
        const addresses = [...new Set([rinfo.address, ...(j.addresses || []), ...(prev ? prev.addresses : [])])];
        found.set(key, { name: String(j.name || '').slice(0, 80), company: String(j.company || '').slice(0, 120), version: String(j.version || '').slice(0, 20), port: Number(j.port) || 8443, fingerprint: String(j.fingerprint), address: prev ? prev.address : rinfo.address, addresses });
      } catch { /* réponse étrangère ignorée */ }
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      const send = () => { for (const a of [...broadcastAddresses(), ...extraTargets]) sock.send(PROBE, DISCOVERY_PORT, a, () => {}); };
      send();
      setTimeout(send, 400);
    });
    setTimeout(() => { try { sock.close(); } catch { /* ignoré */ } resolve([...found.values()]); }, ms);
  });
}

/** Empreinte SHA-256 « AA:BB:… » à partir du format Electron « sha256/base64 ». */
function electronFingerprintToHex(fp) {
  const b64 = String(fp || '').replace(/^sha256\//, '');
  return Buffer.from(b64, 'base64').toString('hex').toUpperCase().match(/.{2}/g)?.join(':') || '';
}

/** Lit le certificat présenté par un serveur (sans le valider) pour en afficher l'empreinte. */
function probeCertificate(host, port, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port, servername: /^\d+\.\d+\.\d+\.\d+$/.test(host) ? undefined : host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = s.getPeerCertificate();
      s.end();
      if (!c || !c.fingerprint256) return reject(new Error('Aucun certificat présenté.'));
      resolve({ fingerprint: c.fingerprint256.toUpperCase(), authorized: s.authorized, subject: c.subject && c.subject.CN });
    });
    s.on('timeout', () => { s.destroy(); reject(new Error('Le poste ne répond pas (délai dépassé).')); });
    s.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'Connexion refusée : RTMS n’est pas démarré sur ce poste, ou le pare-feu bloque.' : `Poste injoignable (${e.code || e.message}).`)));
  });
}

/** Identifiant stable de la machine (licence liée au poste principal). */
function machineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/);
      if (m) return m[1];
    }
    for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch { /* repli ci-dessous */ }
  return os.hostname();
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

module.exports = { discover, electronFingerprintToHex, probeCertificate, machineId, lanAddresses, broadcastAddresses, DISCOVERY_PORT };
