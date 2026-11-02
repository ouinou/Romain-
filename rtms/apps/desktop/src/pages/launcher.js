'use strict';
const d = window.rtmsDesktop;
const $ = (id) => document.getElementById(id);
const clean = (e) => String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let pending = null;

d.info().then((i) => { $('ver').textContent = i.version; });
const say = (text, cls = '') => { $('msg').className = `msg ${cls}`; $('msg').textContent = text; };

async function scan() {
  $('scan').disabled = true;
  $('servers').innerHTML = '';
  say('Recherche sur le réseau local…');
  try {
    const list = await d.discover();
    if (!list.length) { say('Aucun poste principal trouvé. Vérifiez qu’il est allumé, que RTMS y est ouvert, que les deux postes sont sur la même box, et que le pare-feu du poste principal autorise RTMS.', 'err'); return; }
    say(`${list.length} poste(s) principal(aux) trouvé(s).`, 'ok');
    $('servers').innerHTML = list.map((s, i) => `<li><div><b>${esc(s.company || 'RTMS')}</b> — ${esc(s.name)}<br><small>${esc(s.address)} · version ${esc(s.version)}</small></div><button type="button" data-i="${i}">Choisir</button></li>`).join('');
    $('servers').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) check(`${list[Number(b.dataset.i)].address}:${list[Number(b.dataset.i)].port}`, list[Number(b.dataset.i)].fingerprint); };
  } catch (e) { say(clean(e), 'err'); } finally { $('scan').disabled = false; }
}

async function check(address, expectedFp) {
  say('Vérification du poste…');
  $('confirm').hidden = true;
  try {
    const r = await d.probe(address);
    if (expectedFp && r.fingerprint !== expectedFp) throw new Error('L’empreinte présentée ne correspond pas à celle annoncée sur le réseau : connexion refusée par sécurité.');
    if (r.trusted) { say('Serveur reconnu. Connexion…', 'ok'); return d.connect(r); }
    pending = r;
    $('fp').textContent = r.fingerprint;
    $('confirm').hidden = false;
    say(`Poste RTMS trouvé (version ${r.version}).`, 'ok');
  } catch (e) { say(clean(e), 'err'); }
}

$('scan').addEventListener('click', scan);
$('manual').addEventListener('submit', (e) => { e.preventDefault(); if ($('addr').value.trim()) check($('addr').value.trim()); });
$('trust').addEventListener('click', () => { if (pending) d.connect(pending); });
$('cancel').addEventListener('click', () => { pending = null; $('confirm').hidden = true; say(''); });
$('main').addEventListener('click', () => d.useMain());
$('demo').addEventListener('click', () => d.useDemo());
