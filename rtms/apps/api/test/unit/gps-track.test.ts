import { describe, expect, it } from 'vitest';
import { analyse, haversine, toGpx, type RawPoint } from '../../src/gps/track.js';

// Trajet synthétique : 60 km/h plein est le long de l'équateur, une position toutes les 10 s
const T0 = Date.UTC(2026, 10, 12, 7, 0, 0) / 1000;
const DEG_PER_M = 1 / 111_195;
function drive(n: number, kmh: number, start: RawPoint = [T0, 4.05, 9.7], every = 10): RawPoint[] {
  const out: RawPoint[] = [];
  for (let i = 0; i < n; i++) out.push([start[0] + i * every, start[1], start[2] + (kmh / 3.6) * every * i * DEG_PER_M / Math.cos((start[1] * Math.PI) / 180)]);
  return out;
}

describe('Analyse d’une trace GPS', () => {
  it('distance et vitesse cohérentes sur une ligne droite', () => {
    const s = analyse(drive(361, 60)); // 1 h à 60 km/h
    expect(s.distanceM).toBeGreaterThan(59_500);
    expect(s.distanceM).toBeLessThan(60_500);
    expect(s.maxSpeedKmh).toBeGreaterThan(58);
    expect(s.maxSpeedKmh).toBeLessThan(62);
    expect(s.movingS).toBe(3600);
    expect(s.stops).toHaveLength(0);
  });

  it('écarte un saut de position aberrant et les doublons', () => {
    const pts = drive(100, 50);
    pts.splice(50, 0, [pts[49]![0] + 5, 5.5, 11.2]); // saut de 200 km en 5 s
    pts.push(pts[10]!); // horodatage en double
    const s = analyse(pts);
    expect(s.dropped).toBe(2);
    expect(s.maxSpeedKmh).toBeLessThan(55);
  });

  it('détecte un arrêt de plus de 5 minutes et ne compte pas le bruit GPS', () => {
    const a = drive(60, 60);
    const last = a[a.length - 1]!;
    // 10 minutes à l'arrêt avec un bruit de ±8 m
    const parked: RawPoint[] = Array.from({ length: 60 }, (_, i) => [last[0] + 10 * (i + 1), last[1] + ((i % 3) - 1) * 8 * DEG_PER_M, last[2] + ((i % 2) * 2 - 1) * 8 * DEG_PER_M]);
    const b = drive(60, 60, [parked[59]![0] + 10, last[1], last[2]]);
    const s = analyse([...a, ...parked, ...b]);
    expect(s.stops).toHaveLength(1);
    expect(s.stops[0]!.durationS).toBeGreaterThanOrEqual(590);
    const straight = haversine(a[0]![1], a[0]![2], last[1], last[2]) * 2;
    expect(s.distanceM).toBeLessThan(straight + 100); // le bruit pendant l'arrêt ne s'ajoute pas
  });

  it('refuse une trace sans deux positions valides ou de plus de 7 jours', () => {
    expect(() => analyse([[T0, 4, 9]])).toThrow(/deux positions/);
    expect(() => analyse([[T0, 4, 9], [T0 + 8 * 86_400, 4.001, 9]])).toThrow(/7 jours/);
  });

  it('exporte un GPX valide et échappe le nom', () => {
    const g = toGpx('Camion <A&B>', new Date(T0 * 1000), [[0, 4.05, 9.7], [10, 4.051, 9.7]]);
    expect(g).toContain('<name>Camion &lt;A&amp;B&gt;</name>');
    expect(g).toContain('<trkpt lat="4.051" lon="9.7"><time>2026-11-12T07:00:10.000Z</time></trkpt>');
  });
});
