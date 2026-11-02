// Démarrage en mode démonstration : serveur simulé + bandeau d'avertissement.
import { DEMO_ACCOUNTS, installDemoApi, resetDemo } from './mockApi.js';

installDemoApi();
window.RTMS_DEMO = true;

const banner = document.createElement('div');
banner.className = 'demo-banner';
banner.innerHTML = '<strong>DÉMONSTRATION</strong> — données fictives, enregistrées dans ce navigateur seulement. Ne saisissez aucune donnée réelle. <button type="button" data-demo-reset>Réinitialiser la démo</button>';
document.body.prepend(banner);
document.body.classList.add('is-demo');
banner.querySelector('[data-demo-reset]').addEventListener('click', async () => {
  const { confirmDialog } = await import('../components/ModalManager.js');
  if (await confirmDialog('Effacer les données de démonstration et repartir des données d’exemple ?', { title: 'Réinitialiser la démo', ok: 'Réinitialiser', danger: true })) {
    resetDemo();
    try { sessionStorage.clear(); } catch { /* ignoré */ }
    location.reload();
  }
});
const email = document.querySelector('#loginform [name=email]');
if (email) email.value = 'demo@raha-transport.cm';
const err = document.getElementById('loginerr');
if (err) {
  // Un compte par profil : chaque personne connectée ne voit que ce que son profil autorise
  err.insertAdjacentHTML('beforebegin', `<div class="notice demo-accounts">Démonstration — mot de passe <b>demo</b> pour tous les comptes. Choisissez un profil pour voir son interface :
    <div class="demo-acc-list">${DEMO_ACCOUNTS.map(([mail, , role]) => `<button type="button" class="btn secondary sm" data-demo-mail="${mail}" title="${mail}">${{ admin: 'Administrateur', direction: 'Direction', finance: 'Comptable', transport: 'Transport', commercial: 'Commercial', agent: 'Agent' }[role]}</button>`).join('')}</div></div>`);
  document.querySelector('.demo-acc-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-demo-mail]');
    if (!b || !email) return;
    email.value = b.dataset.demoMail;
    const pw = document.querySelector('#loginform [name=password]');
    if (pw) { pw.value = 'demo'; pw.focus(); }
  });
}

await import('../main.js');
if (email && !email.value) email.value = DEMO_ACCOUNTS[0][0];
