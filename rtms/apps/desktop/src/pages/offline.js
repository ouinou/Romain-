'use strict';
const q = new URLSearchParams(location.search);
document.getElementById('url').textContent = q.get('url') || '—';
document.getElementById('err').textContent = q.get('err') || '—';
document.getElementById('retry').addEventListener('click', () => window.rtmsDesktop.retry());
document.getElementById('change').addEventListener('click', () => window.rtmsDesktop.changeServer());
