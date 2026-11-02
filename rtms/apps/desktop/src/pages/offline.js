'use strict';
const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
$('url').textContent = q.get('url') || '—';
$('err').textContent = q.get('err') || '—';
if (q.get('main')) {
  $('title').textContent = 'Le poste principal n’a pas pu démarrer';
  $('sub').textContent = 'La base de données ou le serveur RTMS de ce poste n’a pas démarré.';
  $('help').querySelector('p').textContent = 'Fermez puis rouvrez RTMS. Si le problème continue, transmettez le fichier « journal-serveur.log » (dossier des données RTMS) à votre prestataire.';
}
if (q.get('cert')) { $('certwarn').hidden = false; $('exp').textContent = q.get('expected'); $('rec').textContent = q.get('received'); }
$('retry').addEventListener('click', () => window.rtmsDesktop.retry());
$('change').addEventListener('click', () => window.rtmsDesktop.changeServer());
