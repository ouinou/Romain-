// Écran « Licence requise » : affiché à la fin de la période d'essai (ou d'un abonnement)
// tant qu'aucune licence valide n'est activée. Le blocage réel est fait par le serveur
// (réponse 402 sur toutes les routes métier) ; cet écran explique et permet d'activer.
import { post } from '../core/api.js';
import { esc } from '../core/dom.js';
import { can } from '../core/session.js';

let layer = null;

export function showLicenseLock(status, { onLogout } = {}) {
  if (layer) return;
  const l = status || {};
  const expiredTrial = l.state === 'trial_expired';
  const admin = can('license', 'admin');
  layer = document.createElement('div');
  layer.className = 'lic-lock';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-labelledby', 'lic-title');
  layer.innerHTML = `<div class="lic-card">
    <img class="login-logo" src="assets/logo-raha.png" alt="Raha Transport">
    <h2 id="lic-title">${expiredTrial ? 'Période d’essai terminée' : 'Licence requise'}</h2>
    <p>${expiredTrial
      ? 'Les 14 jours d’essai gratuit de RTMS sont écoulés. Vos données sont conservées : elles redeviennent accessibles dès que la licence est activée.'
      : `Le logiciel est bloqué : ${esc(l.reason || 'aucune licence valide')}. Vos données sont conservées.`}</p>
    <ol class="lic-steps">
      <li>Envoyez ce <b>code d’activation</b> à votre fournisseur (message, e-mail ou WhatsApp).</li>
      <li>Il vous renvoie une <b>clé de licence</b>.</li>
      <li>${admin ? 'Collez-la ci-dessous, puis cliquez sur « Activer ».' : 'L’administrateur de RTMS la colle dans cet écran, avec son compte.'}</li>
    </ol>
    <label class="lic-label">Code d’activation de ce poste</label>
    <div class="lic-code"><code data-code>${esc(l.activationCode || l.installationId || '—')}</code><button type="button" class="btn secondary sm" data-copy>Copier</button></div>
    ${admin ? `<label class="lic-label" for="lic-token">Clé de licence reçue</label>
    <textarea id="lic-token" rows="4" maxlength="4096" placeholder="RTMS1.…" spellcheck="false"></textarea>
    <div class="lic-msg" role="status" aria-live="polite"></div>
    <div class="lic-actions"><button type="button" class="btn secondary" data-logout>Se déconnecter</button><button type="button" class="btn" data-activate>Activer</button></div>`
      : `<div class="lic-actions"><button type="button" class="btn secondary" data-logout>Se déconnecter</button></div>`}
  </div>`;
  document.body.appendChild(layer);
  const msg = (t, ok = false) => { const m = layer.querySelector('.lic-msg'); if (m) { m.className = `lic-msg ${ok ? 'ok' : 'err'}`; m.textContent = t; } };
  layer.querySelector('[data-copy]').addEventListener('click', async (e) => {
    const code = layer.querySelector('[data-code]').textContent;
    try { await navigator.clipboard.writeText(code); e.target.textContent = 'Copié'; }
    catch { const r = document.createRange(); r.selectNodeContents(layer.querySelector('[data-code]')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); e.target.textContent = 'Sélectionné : Ctrl+C'; }
  });
  layer.querySelector('[data-logout]').addEventListener('click', () => { hideLicenseLock(); onLogout?.(); });
  layer.querySelector('[data-activate]')?.addEventListener('click', async (e) => {
    const token = layer.querySelector('#lic-token').value.trim();
    if (!token) return msg('Collez d’abord la clé de licence reçue.');
    e.target.disabled = true;
    try {
      const st = await post('/api/admin/license/activate', { token });
      msg(`Licence activée${st.customer ? ` pour ${st.customer}` : ''}. Ouverture du logiciel…`, true);
      setTimeout(() => location.reload(), 900);
    } catch (err) { e.target.disabled = false; msg(err.message); }
  });
  (layer.querySelector('#lic-token') || layer.querySelector('[data-copy]')).focus();
}

export function hideLicenseLock() { layer?.remove(); layer = null; }
