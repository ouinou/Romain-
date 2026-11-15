/**
 * Calculs sur une trace GPS, faits par le serveur (le poste qui importe ne peut pas les imposer).
 * Entrée : points horodatés (secondes Unix, latitude, longitude), dans n'importe quel ordre.
 *
 * Choix retenus, à ajuster avec l'usage réel :
 * - un saut impliquant plus de 180 km/h est une erreur de position (fréquent sous les arbres,
 *   près des bâtiments) : le point est écarté ;
 * - en dessous de 25 m entre deux points, on considère que le véhicule n'a pas bougé (bruit GPS) ;
 * - un arrêt = au moins 5 minutes dans un rayon de 100 m ;
 * - vitesse maximale : mesurée sur au moins 20 s, pour ne pas compter les à-coups du récepteur.
 */
export type RawPoint = [number, number, number]; // [t (s), lat, lon]

export const LIMITS = { maxPoints: 50_000, maxDurationS: 7 * 86_400, glitchKmh: 180, jitterM: 25, stopMinS: 300, stopRadiusM: 100, speedWindowS: 20, movingKmh: 3 };

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
export function haversine(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Stop { at: number; durationS: number; lat: number; lon: number }
export interface TrackStats {
  startedAt: number; endedAt: number; points: RawPoint[]; distanceM: number; movingS: number;
  maxSpeedKmh: number; stops: Stop[]; bbox: [number, number, number, number]; dropped: number;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function analyse(input: RawPoint[]): TrackStats {
  // Tri, arrondi (6 décimales ≈ 11 cm), doublons d'horodatage retirés
  const sorted = input.map(([t, a, o]) => [Math.round(t), round(a, 6), round(o, 6)] as RawPoint).sort((x, y) => x[0] - y[0]);
  const pts: RawPoint[] = [];
  let dropped = 0;
  for (const p of sorted) {
    const last = pts[pts.length - 1];
    if (last && p[0] === last[0]) { dropped++; continue; }
    if (last) {
      const d = haversine(last[1], last[2], p[1], p[2]);
      if ((d / (p[0] - last[0])) * 3.6 > LIMITS.glitchKmh) { dropped++; continue; }
    }
    pts.push(p);
  }
  if (pts.length < 2) throw new Error('Trace inutilisable : moins de deux positions valides');

  let distanceM = 0, movingS = 0;
  let anchor = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const dt = b[0] - a[0];
    const seg = haversine(a[1], a[2], b[1], b[2]);
    if ((seg / dt) * 3.6 >= LIMITS.movingKmh) movingS += Math.min(dt, 600); // un trou de signal ne compte pas comme 3 h de route
    // Distance : on n'avance « l'ancre » que lorsqu'on s'en est éloigné de plus que le bruit GPS
    const fromAnchor = haversine(anchor[1], anchor[2], b[1], b[2]);
    if (fromAnchor >= LIMITS.jitterM) { distanceM += fromAnchor; anchor = b; }
  }

  // Vitesse maximale sur une fenêtre glissante d'au moins 20 s
  let maxSpeedKmh = 0;
  for (let i = 0, j = 0; i < pts.length; i++) {
    while (j < pts.length && pts[j]![0] - pts[i]![0] < LIMITS.speedWindowS) j++;
    if (j >= pts.length) break;
    let d = 0;
    for (let k = i + 1; k <= j; k++) d += haversine(pts[k - 1]![1], pts[k - 1]![2], pts[k]![1], pts[k]![2]);
    const dt = pts[j]![0] - pts[i]![0];
    if (dt <= 300) maxSpeedKmh = Math.max(maxSpeedKmh, (d / dt) * 3.6);
  }

  // Arrêts : regroupement des points restés dans un rayon de 100 m pendant 5 min ou plus
  const stops: Stop[] = [];
  for (let i = 0; i < pts.length;) {
    let j = i;
    while (j + 1 < pts.length && haversine(pts[i]![1], pts[i]![2], pts[j + 1]![1], pts[j + 1]![2]) <= LIMITS.stopRadiusM) j++;
    const dur = pts[j]![0] - pts[i]![0];
    if (dur >= LIMITS.stopMinS) { stops.push({ at: pts[i]![0], durationS: dur, lat: pts[i]![1], lon: pts[i]![2] }); i = j + 1; } else i++;
  }

  let s = 90, w = 180, n = -90, e = -180;
  for (const [, a, o] of pts) { s = Math.min(s, a); n = Math.max(n, a); w = Math.min(w, o); e = Math.max(e, o); }
  const startedAt = pts[0]![0], endedAt = pts[pts.length - 1]![0];
  if (endedAt - startedAt > LIMITS.maxDurationS) throw new Error('Trace trop longue : 7 jours au maximum par trajet');
  return { startedAt, endedAt, points: pts, distanceM: Math.round(distanceM), movingS, maxSpeedKmh: round(maxSpeedKmh, 1), stops: stops.slice(0, 200), bbox: [s, w, n, e], dropped };
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

/** Export GPX 1.1 (lisible par Google Earth, OsmAnd, QGIS…). */
export function toGpx(name: string, startedAt: Date, points: [number, number, number][]) {
  const t0 = startedAt.getTime();
  const body = points.map(([dt, a, o]) => `<trkpt lat="${a}" lon="${o}"><time>${new Date(t0 + dt * 1000).toISOString()}</time></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RTMS" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${xml(name)}</name><trkseg>\n${body}\n</trkseg></trk>\n</gpx>\n`;
}
