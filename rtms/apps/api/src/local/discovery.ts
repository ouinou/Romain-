/**
 * Découverte du poste principal sur le réseau local (UDP, sans Internet ni serveur DNS).
 * Un poste envoie « RTMS-DISCOVER » en diffusion ; le poste principal répond avec son nom,
 * ses adresses, son port et l'empreinte de son certificat.
 */
import dgram from 'node:dgram';
import os from 'node:os';

export const DISCOVERY_PORT = 41730;
export const DISCOVERY_PROBE = 'RTMS-DISCOVER/1';

export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

export function startDiscoveryResponder(info: () => { name: string; port: number; fingerprint: string; version: string; company?: string }) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg, rinfo) => {
    if (msg.toString('utf8').trim() !== DISCOVERY_PROBE) return;
    const body = JSON.stringify({ rtms: 1, ...info(), addresses: lanAddresses() });
    sock.send(body, rinfo.port, rinfo.address);
  });
  sock.on('error', () => { /* port occupé : la saisie manuelle de l'adresse reste possible */ });
  sock.bind(DISCOVERY_PORT);
  return sock;
}
