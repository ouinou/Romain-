'use strict';
/**
 * Adresse du serveur RTMS : https obligatoire. http n'est accepté que sur le réseau local
 * (essais), jamais sur Internet : identifiants et données circuleraient en clair.
 */
function normalizeServerUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new Error('Adresse invalide. Exemple : https://rtms.raha-transport.cm'); }
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('L’adresse doit commencer par https://');
  if (u.username || u.password) throw new Error('L’adresse ne doit pas contenir d’identifiants.');
  const local = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname);
  if (u.protocol === 'http:' && !local) throw new Error('Connexion non chiffrée refusée : utilisez une adresse https://');
  return u.origin;
}
module.exports = { normalizeServerUrl };
