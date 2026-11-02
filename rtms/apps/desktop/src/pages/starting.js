'use strict';
if (new URLSearchParams(location.search).get('restore')) {
  document.getElementById('title').textContent = 'Restauration en cours…';
  document.getElementById('sub').textContent = 'Le logiciel redémarre ensuite automatiquement.';
}
const steps = document.getElementById('steps');
window.rtmsDesktop.onServerLog((m) => {
  const li = document.createElement('li');
  li.textContent = m;
  steps.appendChild(li);
  while (steps.children.length > 6) steps.firstChild.remove();
});
