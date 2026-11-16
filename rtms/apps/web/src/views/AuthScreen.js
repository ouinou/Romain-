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
    ['mfaform', 'enroll', 'recovery', 'resetform', 'pwchangeform'].forEach((id) => $(`#${id}`).classList.add('hidden'));
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
    if (m.state === 'password_change') { $('#mfaform').classList.add('hidden'); $('#pwchangeform').reset(); $('#pwchangeform').classList.remove('hidden'); $('#pwchangeform').current.focus(); return; }
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
  // Mot de passe provisoire à remplacer (nouvel utilisateur)
  $('#pwchangeform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.reportValidity()) return;
    if (f.next.value !== f.confirm.value) { box('Les deux nouveaux mots de passe ne sont pas identiques.'); return; }
    try {
      const r = await post('/api/auth/password', { current: f.current.value, next: f.next.value });
      $('#pwchangeform').classList.add('hidden');
      await after(r);
    } catch (err) { $('#loginerr').innerHTML = errorBox(err); if (err.status === 401 && err.body.code !== 'identifiants_invalides') show(err.message); }
  });
  // Mot de passe oublié : code donné par l'administrateur
  root.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act=forgot]')) return;
    $('#loginform').classList.add('hidden');
    $('#resetform').reset();
    $('#resetform').email.value = $('#loginform').email.value;
    $('#resetform').classList.remove('hidden');
    box('');
    $('#resetform').code.focus();
  });
  $('#resetform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.reportValidity()) return;
    try {
      await post('/api/auth/password/reset', { email: f.email.value.trim(), code: f.code.value.trim(), next: f.next.value });
      const email = f.email.value.trim();
      show('Mot de passe changé. Connectez-vous avec le nouveau mot de passe.');
      $('#loginform [name=email]').value = email;
      $('#loginerr').firstElementChild.className = 'ok';
      $('#loginform [name=password]').focus();
    } catch (err) { $('#loginerr').innerHTML = errorBox(err); f.next.value = ''; }
  });
  $('#recovery [data-act=enter-app]').addEventListener('click', () => { root.classList.add('hidden'); onReady(me); });
  root.addEventListener('click', (e) => { if (e.target.closest('[data-act=auth-cancel]')) { post('/api/auth/logout').catch(() => {}); show(); } });

  // Poste principal neuf : création de la société et du premier administrateur
  async function checkSetup() {
    try {
      const r = await fetch('/api/setup/status', { credentials: 'same-origin' });
      if (!r.ok) return false;
      const st = await r.json();
      if (!st.needsSetup) return false;
      root.classList.remove('hidden');
      $('#loginform').classList.add('hidden');
      $(st.local ? '#setupform' : '#setupwait').classList.remove('hidden');
      return true;
    } catch { return false; }
  }
  $('#setupform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.reportValidity()) return;
    try {
      await post('/api/setup', Object.fromEntries(new FormData(f).entries()));
      const email = f.email.value;
      $('#setupform').classList.add('hidden');
      show('Société créée. Connectez-vous avec le compte administrateur ; la double authentification va être configurée.');
      $('#loginform [name=email]').value = email;
      $('#loginerr').firstElementChild.className = 'ok';
    } catch (err) { $('#loginerr').innerHTML = errorBox(err); }
  });

  return { show, after, checkSetup };
}
