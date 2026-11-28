/**
 * CSV lisible par Excel en français : séparateur « ; », guillemets, marque d'ordre des octets UTF-8.
 */
const cellule = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export const versCsv = (entete: string[], lignes: unknown[][]) => "﻿" + [entete, ...lignes].map((l) => l.map(cellule).join(";")).join("\r\n");

/** Lecture d'un CSV (séparateur « ; » ou « , » détecté sur la première ligne, guillemets gérés). */
export function lireCsv(texte: string): string[][] {
  const t = texte.replace(/^﻿/, "");
  const premiere = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (premiere.match(/;/g)?.length ?? 0) >= (premiere.match(/,/g)?.length ?? 0) ? ";" : ",";
  const lignes: string[][] = [];
  let ligne: string[] = [], champ = "", guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (guillemets) {
      if (ch === '"' && t[i + 1] === '"') { champ += '"'; i++; }
      else if (ch === '"') guillemets = false;
      else champ += ch;
    } else if (ch === '"') guillemets = true;
    else if (ch === sep) { ligne.push(champ); champ = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      ligne.push(champ); champ = "";
      if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
      ligne = [];
    } else champ += ch;
  }
  ligne.push(champ);
  if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
  return lignes;
}
