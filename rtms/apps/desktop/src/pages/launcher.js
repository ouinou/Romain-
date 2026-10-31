'use strict';
const d = window.rtmsDesktop;
const $ = (id) => document.getElementById(id);
d.info().then((i) => { $('ver').textContent = i.version; });
$('srv').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('msg');
  $('go').disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Vérification du serveur…';
  try {
    const r = await d.testServer($('url').value);
    msg.className = 'msg ok';
    msg.textContent = `Serveur RTMS trouvé${r.version ? ` (version ${r.version})` : ''}. Ouverture…`;
    await d.useServer(r.origin);
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    $('go').disabled = false;
  }
});
$('demo').addEventListener('click', () => d.useDemo());
$('url').focus();
