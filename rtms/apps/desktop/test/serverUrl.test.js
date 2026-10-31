'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeServerUrl } = require('../src/serverUrl');

test('accepte une adresse https et n’en garde que l’origine', () => {
  assert.strictEqual(normalizeServerUrl(' https://rtms.raha-transport.cm/connexion?x=1 '), 'https://rtms.raha-transport.cm');
  assert.strictEqual(normalizeServerUrl('https://10.0.0.5:8443'), 'https://10.0.0.5:8443');
});
test('http uniquement sur le réseau local', () => {
  assert.strictEqual(normalizeServerUrl('http://192.168.1.20:3000'), 'http://192.168.1.20:3000');
  assert.strictEqual(normalizeServerUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => normalizeServerUrl('http://rtms.exemple.com'), /non chiffrée/);
  assert.throws(() => normalizeServerUrl('http://192.168.1.20.attaquant.com'), /non chiffrée/);
});
test('refuse les autres schémas, les identifiants et les adresses invalides', () => {
  assert.throws(() => normalizeServerUrl('file:///C:/Windows'), /https/);
  assert.throws(() => normalizeServerUrl('javascript:alert(1)'), /https/);
  assert.throws(() => normalizeServerUrl('https://user:pass@rtms.cm'), /identifiants/);
  assert.throws(() => normalizeServerUrl('pas une adresse'), /invalide/);
});
