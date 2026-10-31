// Impression et export PDF. L'aperçu est construit dans #print-root, seul élément
// visible à l'impression. « Exporter PDF » ouvre la même impression : le PDF est
// produit par la fonction « Enregistrer au format PDF » du système.
import { esc, dateFr, money } from '../core/dom.js';
import { toast } from './NotificationCenter.js';

let company = { name: 'RAHA TRANSPORT', phone: '', email: '', address: '' };
export function setCompanyInfo(c) { company = { ...company, ...c }; }

function header(title, sub = '') {
  return `<header class="pr-head"><div><div class="pr-brand">${esc(company.name || 'RAHA TRANSPORT')}</div>
    <div class="pr-activities">TRANSPORT - TRANSIT - IMPORT - EXPORT - COMMERCE GÉNÉRAL</div></div>
    <div class="pr-meta">${[company.address, company.phone, company.email].filter(Boolean).map(esc).join('<br>')}</div></header>
    <h1 class="pr-title">${esc(title)}</h1>${sub ? `<p class="pr-sub">${esc(sub)}</p>` : ''}`;
}
const footer = () => `<footer class="pr-foot">Édité le ${esc(new Date().toLocaleString('fr-FR'))} · RAHA TRANSPORT MANAGEMENT SYSTEM</footer>`;

export function printHtml(html, { pdf = false } = {}) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = html;
  if (pdf) toast('Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ».', 'info');
  setTimeout(() => { window.print(); }, pdf ? 300 : 50);
}

export function tableDoc(title, columns, rows, sub) {
  return `${header(title, sub)}<table class="pr-table"><thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${esc(c.render ? c.render(r.data, r) : r.data[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="pr-sub">${rows.length} enregistrement(s)</p>${footer()}`;
}

export function recordDoc(title, fields, record) {
  const rows = fields.map((f) => {
    const v = record.data[f.name];
    const shown = v === undefined || v === '' ? '—' : f.type === 'date' ? dateFr(v) : f.type === 'number' ? money(v) : v;
    return `<tr><th>${esc(f.name)}</th><td>${esc(shown)}</td></tr>`;
  }).join('');
  return `${header(title, record.status ? `Statut : ${record.status}` : '')}<table class="pr-kv">${rows}</table>${footer()}`;
}

export function missionOrderDoc(r) {
  const d = r.data;
  return `${header('ORDRE DE MISSION', `N° ${d['Référence mission'] ?? ''}`)}
    <table class="pr-kv">
      <tr><th>Client</th><td>${esc(d.Client ?? '—')}</td></tr>
      <tr><th>Itinéraire</th><td>${esc(d['Départ'] ?? '—')} → ${esc(d.Destination ?? '—')}</td></tr>
      <tr><th>Date de départ</th><td>${esc(dateFr(d['Date de départ']))}</td></tr>
      <tr><th>Marchandise</th><td>${esc(d.Marchandise ?? '—')}</td></tr>
      <tr><th>Véhicule</th><td>${esc(d['Véhicule'] ?? '—')}</td></tr>
      <tr><th>Chauffeur</th><td>${esc(d.Chauffeur ?? '—')}</td></tr>
      <tr><th>Statut</th><td>${esc(d.Statut ?? '—')}</td></tr>
    </table>
    <div class="pr-signs"><div>Le Chargé de transport</div><div>Le Chauffeur</div><div>Le Directeur</div></div>${footer()}`;
}

/** Facture imprimable. Ce n'est PAS encore la reproduction du modèle officiel RAHA. */
export function invoiceDoc(r) {
  const d = r.data, c = r.computed || {};
  return `${header('FACTURE', `N° ${d['Numéro de facture'] ?? ''} · Date : ${dateFr(d.Date)}${d['Échéance'] ? ` · Échéance : ${dateFr(d['Échéance'])}` : ''}`)}
    <p><strong>Client :</strong> ${esc(d.Client ?? '—')}</p>
    <table class="pr-table"><thead><tr><th>N°</th><th>DÉSIGNATION</th><th class="num">QTE</th><th class="num">P. UNITAIRE</th><th class="num">P. TOTAL</th></tr></thead>
      <tbody><tr><td>1</td><td>${esc(d['Désignation'] ?? '')}</td><td class="num">${esc(money(d['Quantité']))}</td><td class="num">${esc(money(d['Prix unitaire (FCFA)']))}</td><td class="num">${esc(money(c.totalHT))}</td></tr></tbody></table>
    <table class="pr-totals"><tr><th>Total HT</th><td>${esc(money(c.totalHT))} FCFA</td></tr><tr><th>Taxe (${esc(d['Taxe (%)'] ?? 0)} %)</th><td>${esc(money(c.tax))} FCFA</td></tr><tr><th>TOTAL TTC</th><td><strong>${esc(money(c.totalTTC))} FCFA</strong></td></tr></table>
    <p class="pr-note">Les marchandises vendues ne sont ni reprises, ni échangées.</p>
    <div class="pr-signs"><div>Le Chargé de transport</div><div>Le Comptable</div><div>Le Directeur</div></div>
    <p class="pr-warn">Document provisoire — le modèle officiel de facture RAHA reste à reproduire et à valider.</p>${footer()}`;
}
