// Connexion, vérification et enrôlement MFA (écran inchangé par rapport à la v2.0).
import { post } from '../core/api.js';
import { session } from '../core/session.js';
import { $, esc } from '../core/dom.js';

export function mountAuth(onReady) {
  const root = $('#loginbg');
  const box = (msg) => { $('#loginerr').innerHTML = msg ? `<div class="err">${esc(msg)}</div>` : ''; };
  const errorBox = (e) => `<div class="err">${esc(e.message)}${Array.isArray(e.body?.details) ? `<ul>${e.body.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>`;
  let me = null;

  const show = (msg) => {
    session.me = null;
    root.classList.remove('hidden');
    ['mfaform', 'enroll', 'recovery'].forEach((id) => $(`#${id}`).classList.add('hidden'));
    $('#loginform').classList.remove('hidden');
    $('#loginform').reset();
    box(msg);
    setTimeout(() => $('#loginform [name=email]').focus(), 0);
  };
  const after = async (m) => {
    me = m;
    // Session partielle (MFA en cours) : le jeton CSRF est nécessaire aux appels suivants
    session.me = m;
    box('');
    $('#loginform').classList.add('hidden');
    if (m.state === 'mfa_pending') { $('#mfaform').classList.remove('hidden'); $('#mfaform').code.focus(); return; }
    if (m.state === 'mfa_enroll') {
      const s = await post('/api/auth/mfa/setup');
      $('#qrimg').src = `data:image/svg+xml;base64,${btoa(s.qrSvg)}`;
      $('#mfasecret').textContent = s.secret;
      $('#enroll').classList.remove('hidden');
      return;
    }
    root.classList.add('hidden');
    onReady(m);
  };

  $('#loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await after(await post('/api/auth/login', { email: f.email.value.trim(), password: f.password.value })); } catch (err) { $('#loginerr').innerHTML = errorBox(err); f.password.value = ''; }
  });
  $('#mfaform').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await after(await post('/api/auth/mfa/verify', { code: e.target.code.value.trim() })); } catch (err) { $('#loginerr').innerHTML = errorBox(err); e.target.code.value = ''; if (err.status === 401 && err.body.code !== 'mfa_invalide') show(err.message); }
  });
  $('#enrollform').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await post('/api/auth/mfa/enable', { code: e.target.code.value.trim() });
      me = r;
      session.me = r;
      $('#enroll').classList.add('hidden');
      $('#codes').innerHTML = r.recoveryCodes.map((c) => `<span>${esc(c)}</span>`).join('');
      $('#recovery').classList.remove('hidden');
    } catch (err) { $('#loginerr').innerHTML = errorBox(err); }
  });
  $('#recovery [data-act=enter-app]').addEventListener('click', () => { root.classList.add('hidden'); onReady(me); });
  root.addEventListener('click', (e) => { if (e.target.closest('[data-act=auth-cancel]')) { post('/api/auth/logout').catch(() => {}); show(); } });

  return { show, after };
}
