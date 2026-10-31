// Démarrage en mode démonstration : serveur simulé + bandeau d'avertissement.
import { installDemoApi, resetDemo } from './mockApi.js';

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
if (err) err.insertAdjacentHTML('beforebegin', '<div class="notice">Démonstration : e-mail <b>demo@raha-transport.cm</b>, mot de passe <b>demo</b>.</div>');

await import('../main.js');
