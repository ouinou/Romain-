// Impression et export PDF. Le document est construit dans #print-root, seul élément
// visible à l'impression (A4, marges gérées par le document). « Exporter PDF » ouvre la
// même impression : le PDF est produit par « Enregistrer au format PDF » du système.
import { dateFr, esc, money } from '../core/dom.js';
import { toast } from './NotificationCenter.js';

/**
 * Mentions du pied de facture telles qu'elles figurent sur le modèle fourni par RAHA TRANSPORT
 * (docs/references/modele-facture-raha.webp). Elles ne servent que si les Paramètres de la
 * société sont vides, et doivent être confirmées par l'entreprise.
 */
export const MODEL_MENTIONS = {
  name: 'RAHA TRANSPORT',
  rccm: 'CM-DLA-02-2024-B12-00521',
  taxId: 'M062417047737R',
  phone: '695 18 88 87 / 696 69 34 06 / 656981708',
  address: 'RUE RICHARD BELL BONADIBONG, DOUALA-CAMEROUN',
};
let company = {};
export function setCompanyInfo(c) { company = { ...company, ...c }; }
const m = (k) => (company[k] && String(company[k]).trim()) || MODEL_MENTIONS[k] || '';

const LOGO = 'assets/logo-raha.png';
const WATERMARK = 'assets/logo-raha-filigrane.png';

/** Bandeau ondulé vert / jaune / orange du modèle, avec les mentions légales. */
function waveFooter() {
  const line1 = [m('rccm') && `RCCM : ${m('rccm')}`, m('taxId') && `CONT : ${m('taxId')}`, m('phone') && `TEL: ${m('phone')}`].filter(Boolean).join(' - ');
  return `<footer class="pr-wave">
    <svg viewBox="0 0 2100 230" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 52 C 450 -6, 1250 104, 2100 6 L2100 230 L0 230 Z" fill="#f47920"/>
      <path d="M0 84 C 450 26, 1250 136, 2100 38 L2100 230 L0 230 Z" fill="#ffe600"/>
      <path d="M0 100 C 450 42, 1250 152, 2100 54 L2100 230 L0 230 Z" fill="#3a9a4c"/>
    </svg>
    <div class="pr-wave-text"><div>${esc(line1)}</div><div>${esc(m('address'))}</div></div>
  </footer>`;
}

function brandHead() {
  return `<div class="pr-brandrow"><img class="pr-logo" src="${LOGO}" alt="Raha Transport">
    <div class="pr-activities">TRANSPORT - TRANSIT - IMPORT - EXPORT - COMMERCE GENERAL</div></div>`;
}
const dotted = (label, value, cls = '') => `<div class="pr-dot ${cls}"><span class="lbl">${esc(label)}</span><span class="val">${esc(value ?? '')}</span></div>`;
const signs = (a, b, c) => `<div class="pr-signs"><div>${esc(a)}</div><div>${esc(b)}</div><div>${esc(c)}</div></div>`;
const a4 = (body, cls = '', style = '') => `<div class="a4 ${cls}" style="${style}"><img class="pr-watermark" src="${WATERMARK}" alt="">${body}${waveFooter()}</div>`;

export async function printHtml(html, { pdf = false } = {}) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = html;
  // Le logo et le filigrane doivent être chargés avant d'imprimer
  await Promise.all([...root.querySelectorAll('img')].map((i) => (i.complete ? null : i.decode().catch(() => null))));
  // Application Windows : vrai fichier PDF A4, enregistré où l'utilisateur le choisit
  if (pdf && window.rtmsDesktop) {
    try {
      const r = await window.rtmsDesktop.savePdf(pdfName(root));
      if (r && r.saved) toast(`PDF enregistré : ${r.path}`, 'success');
    } catch (e) { toast(`PDF non enregistré : ${e.message}`, 'error'); }
    return;
  }
  if (pdf) toast('Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ».', 'info');
  setTimeout(() => window.print(), pdf ? 300 : 50);
}

/** Nom de fichier proposé : type de document + numéro. */
function pdfName(root) {
  const inv = root.querySelector('.invoice');
  if (inv) {
    const num = [...inv.querySelectorAll('.pr-dot')].find((d) => d.querySelector('.lbl')?.textContent.trim() === 'N°')?.querySelector('.val')?.textContent.trim();
    return `Facture ${num || ''}`.trim();
  }
  const bar = root.querySelector('.doc-titlebar');
  if (bar) return [...bar.querySelectorAll('span')].map((x) => x.textContent.trim()).filter(Boolean).join(' ').replace(/^(.)(.*)$/, (m, a, b) => a + b.toLowerCase());
  return `RTMS ${new Date().toISOString().slice(0, 10)}`;
}

/** Lignes d'une facture : nouveau format multi-lignes ou ancienne saisie à une ligne. */
export function invoiceLines(d) {
  if (Array.isArray(d.Lignes) && d.Lignes.length) return d.Lignes;
  if (d['Désignation'] !== undefined) return [{ 'Désignation': d['Désignation'], 'Quantité': d['Quantité'], 'Prix unitaire (FCFA)': d['Prix unitaire (FCFA)'] }];
  return [];
}

/** Facture au modèle RAHA TRANSPORT (A4). */
export function invoiceDoc(r) {
  const d = r.data, c = r.computed || {};
  const lines = invoiceLines(d);
  const rows = Math.max(10, lines.length);
  // Jusqu'à 14 lignes, la facture tient sur une page A4 (lignes resserrées au-delà de 10) ;
  // au-delà, elle se poursuit sur une seconde page.
  const onePage = rows <= 14;
  const rowH = rows <= 10 ? 7.8 : Math.max(5, 78 / rows);
  const body = Array.from({ length: rows }, (_, i) => {
    const l = lines[i];
    if (!l) return '<tr class="empty"><td></td><td></td><td></td><td></td><td></td></tr>';
    const total = Number(l['Quantité'] || 0) * Number(l['Prix unitaire (FCFA)'] || 0);
    return `<tr><td class="c">${i + 1}</td><td>${esc(l['Désignation'])}</td><td class="c">${esc(money(l['Quantité']))}</td><td class="num">${esc(money(l['Prix unitaire (FCFA)']))}</td><td class="num">${esc(money(total))}</td></tr>`;
  }).join('');
  const tax = Number(c.tax || 0);
  const totals = tax
    ? `<tr class="tot sub"><td colspan="4">TOTAL HT</td><td class="num">${esc(money(c.totalHT))}</td></tr><tr class="tot sub"><td colspan="4">TAXE (${esc(d['Taxe (%)'])} %)</td><td class="num">${esc(money(c.tax))}</td></tr>`
    : '';
  return a4(`
    <div class="inv-top">
      ${brandHead()}
      <div class="inv-grid">
        <div class="inv-left">
          ${dotted('NOM DU CHAUFFEUR :', d.Chauffeur)}
          ${dotted('CONTACTS :', d.Contacts)}
          ${dotted('N° de CAMION:', d['N° de camion'])}
          ${dotted('MONTANT DU TRANSPORT:', d['Montant du transport (FCFA)'] !== undefined ? `${money(d['Montant du transport (FCFA)'])} FCFA` : '')}
          ${dotted('CLIENT :', d.Client)}
        </div>
        <div class="inv-right">
          ${dotted('Date', dateFr(d.Date))}
          ${dotted('N°', d['Numéro de facture'])}
          <div class="inv-title">FACTURE</div>
        </div>
      </div>
    </div>
    <table class="inv-table">
      <colgroup><col style="width:8%"><col style="width:42%"><col style="width:12%"><col style="width:16%"><col style="width:22%"></colgroup>
      <thead><tr><th>N°</th><th class="l">DESIGNATION</th><th>QTE</th><th>P. UNITAIRE</th><th>P. TOTAL</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot>${totals}<tr class="tot"><td colspan="4">TOTAL</td><td class="num">${esc(money(c.totalTTC))}</td></tr></tfoot>
    </table>
    <p class="inv-note">Les marchandises vendues ne sont ni reprises, ni échangées</p>
    ${dotted('Arrêtée la présente facture à la somme de', c.totalEnLettres ? capitalize(c.totalEnLettres) : '', 'wide')}
    <div class="inv-pay">${dotted('Avance', `${money(c.avance ?? d['Avance (FCFA)'] ?? 0)} FCFA`)}${dotted('Reste', `${money(c.reste ?? c.totalTTC)} FCFA`)}</div>
    ${signs('Le Chargé de transport', 'Le Comptable', 'Le Directeur')}
    ${r.status && r.status !== 'Validée' && r.status !== 'Payée' && r.status !== 'Payée partiellement' ? `<div class="pr-draft">${esc(r.status.toUpperCase())}</div>` : ''}`, `invoice ${onePage ? 'onepage' : ''}`, `--row-h:${rowH.toFixed(1)}mm`);
}
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Documents de transport (modèles RTMS : pas de modèle officiel fourni, à valider). */
function transportDoc(title, r, extraRows, signatures) {
  const d = r.data;
  return a4(`
    ${brandHead()}
    <div class="doc-titlebar"><span>${esc(title)}</span><span>N° ${esc(d['Référence mission'] ?? '')}</span></div>
    <table class="pr-kv">
      <tr><th>Client</th><td>${esc(d.Client ?? '—')}</td></tr>
      <tr><th>Itinéraire</th><td>${esc(d['Départ'] ?? '—')} → ${esc(d.Destination ?? '—')}</td></tr>
      <tr><th>Date de départ</th><td>${esc(dateFr(d['Date de départ']))}</td></tr>
      <tr><th>Marchandise</th><td>${esc(d.Marchandise ?? '—')}</td></tr>
      <tr><th>Véhicule</th><td>${esc(d['Véhicule'] ?? '—')}</td></tr>
      <tr><th>Chauffeur</th><td>${esc(d.Chauffeur ?? '—')}</td></tr>
      ${extraRows}
    </table>
    ${signs(...signatures)}
    <p class="pr-modelnote">Modèle RTMS — à valider par RAHA TRANSPORT.</p>`);
}
export const missionOrderDoc = (r) => transportDoc('ORDRE DE MISSION', r, `<tr><th>Statut</th><td>${esc(r.data.Statut ?? '—')}</td></tr>`, ['Le Chargé de transport', 'Le Chauffeur', 'Le Directeur']);
export const waybillDoc = (r) => transportDoc('LETTRE DE TRANSPORT', r, `<tr><th>Montant du transport</th><td>${esc(money(r.data['Montant (FCFA)']))} FCFA</td></tr><tr><th>Réserves à la livraison</th><td class="blank"></td></tr>`, ['L’Expéditeur', 'Le Transporteur', 'Le Destinataire']);
export const loadingDoc = (r) => transportDoc('BON DE CHARGEMENT', r, `<tr><th>Quantité / poids chargé</th><td class="blank"></td></tr><tr><th>Lieu et heure de chargement</th><td class="blank"></td></tr>`, ['Le Magasinier', 'Le Chauffeur', 'Le Chargé de transport']);

export function tableDoc(title, columns, rows, sub) {
  return `<div class="a4 landscape-ish">${brandHead()}<div class="doc-titlebar"><span>${esc(title)}</span><span>${rows.length} enregistrement(s)</span></div>${sub ? `<p class="pr-sub">${esc(sub)}</p>` : ''}
    <table class="pr-table"><thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${esc(c.render ? c.render(r.data, r) : r.data[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="pr-sub">Édité le ${esc(new Date().toLocaleString('fr-FR'))}</p>${waveFooter()}</div>`;
}

export function recordDoc(title, fields, record) {
  const rows = fields.filter((f) => f.type !== 'lines').map((f) => {
    const v = record.data[f.name];
    const shown = v === undefined || v === '' ? '—' : f.type === 'date' ? dateFr(v) : f.type === 'number' ? money(v) : v;
    return `<tr><th>${esc(f.name)}</th><td>${esc(shown)}</td></tr>`;
  }).join('');
  return a4(`${brandHead()}<div class="doc-titlebar"><span>${esc(title)}</span><span>${esc(record.status || '')}</span></div><table class="pr-kv">${rows}</table>`);
}

export function reportDoc(innerHtml) {
  return a4(`${brandHead()}<div class="doc-titlebar"><span>RAPPORT D’ACTIVITÉ</span><span>${esc(new Date().toLocaleDateString('fr-FR'))}</span></div>${innerHtml}`);
}
