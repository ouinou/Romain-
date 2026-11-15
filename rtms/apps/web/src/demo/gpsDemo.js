// MODE DÉMONSTRATION — trajets GPS simulés. Mêmes règles de calcul que le serveur
// (apps/api/src/gps/track.ts), en version courte. Données FICTIVES.
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a1, o1, a2, o2) {
  const h = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function analyse(input) {
  const sorted = input.map(([t, a, o]) => [Math.round(t), +a.toFixed(6), +o.toFixed(6)]).sort((x, y) => x[0] - y[0]);
  const pts = []; let dropped = 0;
  for (const p of sorted) {
    const l = pts[pts.length - 1];
    if (l && (p[0] === l[0] || (haversine(l[1], l[2], p[1], p[2]) / (p[0] - l[0])) * 3.6 > 180)) { dropped++; continue; }
    pts.push(p);
  }
  if (pts.length < 2) throw new Error('Trace inutilisable : moins de deux positions valides');
  let distanceM = 0, movingS = 0, anchor = pts[0], maxSpeedKmh = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dt = b[0] - a[0], seg = haversine(a[1], a[2], b[1], b[2]);
    if ((seg / dt) * 3.6 >= 3) movingS += Math.min(dt, 600);
    const d = haversine(anchor[1], anchor[2], b[1], b[2]);
    if (d >= 25) { distanceM += d; anchor = b; }
  }
  for (let i = 0, j = 0; i < pts.length; i++) {
    while (j < pts.length && pts[j][0] - pts[i][0] < 20) j++;
    if (j >= pts.length) break;
    let d = 0; for (let k = i + 1; k <= j; k++) d += haversine(pts[k - 1][1], pts[k - 1][2], pts[k][1], pts[k][2]);
    const dt = pts[j][0] - pts[i][0]; if (dt <= 300) maxSpeedKmh = Math.max(maxSpeedKmh, (d / dt) * 3.6);
  }
  const stops = [];
  for (let i = 0; i < pts.length;) {
    let j = i; while (j + 1 < pts.length && haversine(pts[i][1], pts[i][2], pts[j + 1][1], pts[j + 1][2]) <= 100) j++;
    const dur = pts[j][0] - pts[i][0];
    if (dur >= 300) { stops.push({ at: pts[i][0], durationS: dur, lat: pts[i][1], lon: pts[i][2] }); i = j + 1; } else i++;
  }
  return { startedAt: pts[0][0], endedAt: pts[pts.length - 1][0], points: pts, distanceM: Math.round(distanceM), movingS, maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10, stops, dropped };
}

/** Trajet d'exemple (fictif) : Douala → Edéa → Yaoundé, avec deux arrêts. */
export function sampleRoute(startSec) {
  const way = [[4.0511, 9.7679], [4.0300, 9.8500], [3.9800, 9.9600], [3.8000, 10.1333], [3.8200, 10.4500], [3.7700, 10.8000], [3.8100, 11.1000], [3.8480, 11.5021]];
  const out = []; let t = startSec;
  for (let s = 0; s < way.length - 1; s++) {
    const [a1, o1] = way[s], [a2, o2] = way[s + 1];
    const d = haversine(a1, o1, a2, o2), kmh = s === 0 ? 35 : 62, n = Math.max(2, Math.round(d / ((kmh / 3.6) * 30)));
    for (let i = 0; i < n; i++) { const f = i / n; out.push([t, a1 + (a2 - a1) * f + Math.sin(i) * 0.0004, o1 + (o2 - o1) * f]); t += 30; }
    if (s === 2) for (let k = 0; k < 40; k++) { out.push([t, a2 + (k % 2) * 0.00005, o2]); t += 30; } // pause de 20 min à Edéa
    if (s === 5) for (let k = 0; k < 16; k++) { out.push([t, a2, o2 + (k % 2) * 0.00005]); t += 30; } // contrôle routier
  }
  out.push([t, ...way[way.length - 1]]);
  return out;
}
