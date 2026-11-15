// Tracé d'un trajet GPS sans fond de carte : le logiciel fonctionne hors ligne, sans
// téléchargement de tuiles. Projection équirectangulaire corrigée de la latitude (précise
// à l'échelle d'un trajet routier), quadrillage, échelle, départ, arrivée et arrêts.
import { esc } from '../core/dom.js';

const W = 900, H = 560, PAD = 36;

export function fmtKm(m) { return `${(Number(m || 0) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m >= 100000 ? 0 : 1 })} km`; }
export function fmtDuration(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
export const timeFr = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });
export const dayFr = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Douala' });

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((k) => k * p).find((v) => v >= x) || 10 * p;
}

/** SVG du trajet. track = { points: [[dt, lat, lon]…], stops, startedAt }. */
export function trackSvg(track, { width = W, height = H, title = '' } = {}) {
  const pts = track.points || [];
  if (pts.length < 2) return '<div class="empty">Trace vide.</div>';
  let s = 90, n = -90, w = 180, e = -180;
  for (const [, a, o] of pts) { if (a < s) s = a; if (a > n) n = a; if (o < w) w = o; if (o > e) e = o; }
  const lat0 = ((s + n) / 2) * Math.PI / 180;
  const kx = Math.cos(lat0) * 111_320, ky = 110_574; // mètres par degré
  const spanX = Math.max((e - w) * kx, 200), spanY = Math.max((n - s) * ky, 200);
  const scale = Math.min((width - 2 * PAD) / spanX, (height - 2 * PAD) / spanY); // px par mètre
  const cx = (w + e) / 2, cy = (s + n) / 2;
  const X = (o) => width / 2 + (o - cx) * kx * scale;
  const Y = (a) => height / 2 - (a - cy) * ky * scale;

  // Simplification d'affichage : au plus ~4000 sommets (le serveur garde toute la trace)
  const step = Math.max(1, Math.floor(pts.length / 4000));
  const d = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(([, a, o], i) => `${i ? 'L' : 'M'}${X(o).toFixed(1)},${Y(a).toFixed(1)}`).join('');

  // Quadrillage tous les « pas ronds » de kilomètres
  const gridM = niceStep(Math.max(spanX, spanY) / 6);
  const grid = [];
  for (let gx = Math.ceil(((cx * kx) - (width / 2) / scale) / gridM) * gridM; gx < (cx * kx) + (width / 2) / scale; gx += gridM) { const px = width / 2 + (gx - cx * kx) * scale; grid.push(`<line x1="${px.toFixed(1)}" y1="0" x2="${px.toFixed(1)}" y2="${height}"/>`); }
  for (let gy = Math.ceil(((cy * ky) - (height / 2) / scale) / gridM) * gridM; gy < (cy * ky) + (height / 2) / scale; gy += gridM) { const py = height / 2 - (gy - cy * ky) * scale; grid.push(`<line x1="0" y1="${py.toFixed(1)}" x2="${width}" y2="${py.toFixed(1)}"/>`); }

  const barM = niceStep(spanX / 5), barPx = barM * scale;
  const [, a0, o0] = pts[0], [, a1, o1] = pts[pts.length - 1];
  const stops = (track.stops || []).map((st, i) => `<g class="gps-stop"><circle cx="${X(st.lon).toFixed(1)}" cy="${Y(st.lat).toFixed(1)}" r="9"/><text x="${X(st.lon).toFixed(1)}" y="${(Y(st.lat) + 4).toFixed(1)}">${i + 1}</text><title>Arrêt ${i + 1} : ${esc(fmtDuration(st.durationS))} à partir de ${esc(timeFr(st.at * 1000))}</title></g>`).join('');
  return `<svg class="gps-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title || 'Tracé du trajet')}" xmlns="http://www.w3.org/2000/svg">
    <rect class="gps-bg" width="${width}" height="${height}"/>
    <g class="gps-grid">${grid.join('')}</g>
    <path class="gps-line-halo" d="${d}"/><path class="gps-line" d="${d}"/>
    ${stops}
    <g class="gps-start"><circle cx="${X(o0).toFixed(1)}" cy="${Y(a0).toFixed(1)}" r="10"/><title>Départ</title></g>
    <g class="gps-end"><rect x="${(X(o1) - 9).toFixed(1)}" y="${(Y(a1) - 9).toFixed(1)}" width="18" height="18" rx="2"/><title>Arrivée</title></g>
    <g class="gps-scale" transform="translate(${PAD},${height - 18})"><line x1="0" y1="0" x2="${barPx.toFixed(1)}" y2="0"/><line x1="0" y1="-5" x2="0" y2="5"/><line x1="${barPx.toFixed(1)}" y1="-5" x2="${barPx.toFixed(1)}" y2="5"/><text x="${(barPx / 2).toFixed(1)}" y="-10">${esc(barM >= 1000 ? `${barM / 1000} km` : `${barM} m`)}</text></g>
    <g class="gps-north" transform="translate(${width - 30},34)"><path d="M0,-18 L8,8 L0,3 L-8,8 Z"/><text y="26">N</text></g>
    <text class="gps-note" x="${width - 10}" y="${height - 8}">Quadrillage : ${esc(gridM >= 1000 ? `${gridM / 1000} km` : `${gridM} m`)} · fond de carte non affiché (hors ligne)</text>
  </svg>`;
}

/** Lien vers OpenStreetMap (nécessite Internet), centré sur le départ. */
export function osmLink(track) {
  const p = track.points?.[0];
  if (!p) return '';
  return `https://www.openstreetmap.org/?mlat=${p[1]}&mlon=${p[2]}#map=13/${p[1]}/${p[2]}`;
}
