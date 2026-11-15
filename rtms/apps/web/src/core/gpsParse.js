// Lecture des fichiers de trace GPS sur le poste : GPX, KML (avec horodatage) et CSV.
// Le résultat ([secondes Unix, latitude, longitude]) est envoyé au serveur, qui le revalide
// et refait tous les calculs : cette lecture n'est qu'une aide, pas un contrôle.

const MAX = 50000;

function fail(msg) { throw new Error(msg); }
const num = (s) => Number(String(s).trim().replace(',', '.'));
const okLatLon = (a, o) => Number.isFinite(a) && Number.isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180 && !(a === 0 && o === 0);

function xmlDoc(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) fail('Fichier illisible : le contenu XML est abîmé ou incomplet.');
  return doc;
}
const byLocal = (root, name) => [...root.getElementsByTagName('*')].filter((e) => e.localName === name);

function parseGpx(text) {
  const doc = xmlDoc(text);
  let nodes = byLocal(doc, 'trkpt');
  if (!nodes.length) nodes = byLocal(doc, 'rtept');
  if (!nodes.length) fail('Aucune position dans ce fichier GPX (balises trkpt).');
  const out = [];
  let noTime = 0;
  for (const n of nodes) {
    const a = num(n.getAttribute('lat')), o = num(n.getAttribute('lon'));
    const t = byLocal(n, 'time')[0]?.textContent;
    const ms = t ? Date.parse(t.trim()) : NaN;
    if (!Number.isFinite(ms)) { noTime++; continue; }
    if (okLatLon(a, o)) out.push([ms / 1000, a, o]);
  }
  if (!out.length && noTime) fail('Ce fichier GPX n’a pas d’heures de passage : c’est un itinéraire prévu, pas un trajet enregistré.');
  return out;
}

function parseKml(text) {
  const doc = xmlDoc(text);
  // Google Earth / téléphones : <gx:Track><when>…</when><gx:coord>lon lat alt</gx:coord>
  const whens = byLocal(doc, 'when'), coords = byLocal(doc, 'coord');
  if (whens.length && whens.length === coords.length) {
    return whens.map((w, i) => {
      const [o, a] = coords[i].textContent.trim().split(/\s+/).map(num);
      return [Date.parse(w.textContent.trim()) / 1000, a, o];
    }).filter(([t, a, o]) => Number.isFinite(t) && okLatLon(a, o));
  }
  if (byLocal(doc, 'LineString').length) fail('Ce fichier KML contient un tracé sans heures de passage : exportez le trajet « avec horodatage » (format GPX de préférence).');
  return fail('Aucune position horodatée dans ce fichier KML.');
}

/** Date/heure d'un CSV : ISO, JJ/MM/AAAA HH:MM(:SS), ou horodatage Unix (secondes ou millisecondes). */
function parseTime(v) {
  const s = String(v).trim().replace(/^"|"$/g, '');
  if (/^\d{9,13}(\.\d+)?$/.test(s)) { const n = Number(s); return n > 1e11 ? n / 1000 : n; }
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 1, +m[5], +(m[6] || 0)) / 1000; // heure du Cameroun (UTC+1)
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 1, +m[5], +(m[6] || 0)) / 1000; // sans fuseau : heure locale
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms / 1000 : NaN;
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) fail('Fichier CSV trop court : il faut une ligne de titres puis au moins deux positions.');
  const sep = [';', '\t', ','].find((c) => lines[0].includes(c)) || ',';
  const head = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const find = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(`${n} `) || h.startsWith(`${n}(`)));
  const iLat = find('lat', 'latitude'), iLon = find('lon', 'lng', 'long', 'longitude');
  let iTime = find('time', 'date', 'datetime', 'timestamp', 'heure', 'date/heure', 'horodatage', 'gps time', 'date et heure');
  const iDate = find('date'), iHour = find('heure', 'time');
  const split = iDate >= 0 && iHour >= 0 && iDate !== iHour;
  if (split) iTime = -1;
  if (iLat < 0 || iLon < 0 || (iTime < 0 && !split)) fail('Colonnes non reconnues : le CSV doit avoir des colonnes « latitude », « longitude » et « date/heure ».');
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(sep);
    const t = split ? parseTime(`${c[iDate]} ${c[iHour]}`) : parseTime(c[iTime]);
    const a = num(c[iLat]), o = num(c[iLon]);
    if (Number.isFinite(t) && okLatLon(a, o)) out.push([t, a, o]);
  }
  return out;
}

/** Lit un fichier choisi par l'utilisateur. Renvoie { source, points, ignored }. */
export async function readTrackFile(file) {
  if (file.size > 30 * 1024 * 1024) fail('Fichier trop volumineux (30 Mo au maximum).');
  const name = file.name.toLowerCase();
  const text = await file.text();
  let source, points;
  if (name.endsWith('.gpx') || /<gpx[\s>]/.test(text.slice(0, 2000))) { source = 'gpx'; points = parseGpx(text); }
  else if (name.endsWith('.kml') || /<kml[\s>]/.test(text.slice(0, 2000))) { source = 'kml'; points = parseKml(text); }
  else if (name.endsWith('.csv') || name.endsWith('.txt')) { source = 'csv'; points = parseCsv(text); }
  else fail('Format non pris en charge : choisissez un fichier .gpx, .kml ou .csv.');
  if (points.length < 2) fail('Moins de deux positions exploitables dans ce fichier.');
  let ignored = 0;
  if (points.length > MAX) {
    // Échantillonnage régulier : la forme du trajet est conservée
    const step = points.length / MAX;
    ignored = points.length - MAX;
    points = Array.from({ length: MAX }, (_, i) => points[Math.floor(i * step)]);
  }
  return { source, points, ignored };
}
