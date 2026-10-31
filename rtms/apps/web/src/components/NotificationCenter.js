// Notifications : messages éphémères (toasts), alertes métier (cloche) et
// journal des opérations de la session.
import { emit, on } from '../core/bus.js';
import { get } from '../core/api.js';
import { esc, h, dateFr, dateTimeFr } from '../core/dom.js';
import { icon } from '../core/icons.js';

const state = { items: [], counts: {}, log: [] };
let host;

export const notifications = () => state;

export function mountToasts() {
  host = h('<div class="toasts" aria-live="polite"></div>');
  document.body.appendChild(host);
  on('toast', ({ type = 'info', message }) => toast(message, type));
  on('operation', (op) => {
    state.log.unshift({ ...op, at: new Date().toISOString() });
    state.log = state.log.slice(0, 200);
    emit('oplog', state.log);
  });
}

export function toast(message, type = 'info') {
  if (!host) return;
  const ico = type === 'error' ? 'ban' : type === 'success' ? 'check' : 'info';
  const t = h(`<div class="toast ${type}" role="status">${icon(ico, 16)}<span>${esc(message)}</span></div>`);
  host.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, type === 'error' ? 6000 : 3500);
}

export async function refreshNotifications() {
  try {
    const r = await get('/api/notifications');
    state.items = r.items;
    state.counts = r.counts;
    emit('notifications', state);
  } catch { /* hors ligne : on garde les dernières */ }
}

export function notificationListHtml(items, empty = 'Aucune alerte.') {
  if (!items.length) return `<div class="muted small">${esc(empty)}</div>`;
  return `<ul class="notif-list">${items.map((n) => `<li><button type="button" class="notif ${n.level}" data-open-record="${esc(n.module)}:${esc(n.id)}">
    <span class="dot"></span><span class="nt">${esc(n.message)}</span>${n.due ? `<span class="nd">${esc(dateFr(n.due))}</span>` : ''}</button></li>`).join('')}</ul>`;
}

export const operationLogHtml = () => (state.log.length
  ? `<table class="mini"><thead><tr><th>Heure</th><th>Opération</th></tr></thead><tbody>${state.log.map((o) => `<tr><td>${esc(dateTimeFr(o.at))}</td><td>${esc(o.message)}</td></tr>`).join('')}</tbody></table>`
  : '<p class="muted">Aucune opération pendant cette session.</p>');
