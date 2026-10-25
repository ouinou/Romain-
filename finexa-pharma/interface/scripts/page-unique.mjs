/**
 * Regroupe la version de démonstration compilée en un seul fichier HTML (styles et script intégrés),
 * pour la partager ou la consulter sans serveur. Le caractère U+FFFD (détection d'encodage de l'import CSV) est
 * réécrit en échappement \uFFFD : certains hébergeurs refusent un fichier qui le contient tel quel. Usage : node scripts/page-unique.mjs <dossier> <fichier-sortie>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dossier, sortie] = process.argv.slice(2);
let html = readFileSync(join(dossier, "index.html"), "utf8");
html = html.replace(/<link rel="stylesheet"[^>]*href="\/([^"]+)"[^>]*>/g, (_, f) => `<style>${readFileSync(join(dossier, f), "utf8")}</style>`);
html = html.replace(/<script type="module" crossorigin src="\/([^"]+)"><\/script>/g, (_, f) =>
  `<script type="module">${readFileSync(join(dossier, f), "utf8").replace(/<\/script/gi, "<\\/script").replace(/\uFFFD/g, "\\uFFFD")}</script>`);
html = html.replace(/<link rel="icon"[^>]*>/, "");
if (/src="\/assets|href="\/assets/.test(html)) throw new Error("Une ressource externe n'a pas été intégrée.");
// --fragment : sans <!doctype>, <html>, <head>, <body>, pour une page hébergée qui fournit déjà ce squelette.
if (process.argv.includes("--fragment"))
  html = html.replace(/<!doctype html>\s*/i, "").replace(/<\/?(html|head|body)[^>]*>\s*/gi, "")
    .replace(/<meta charset[^>]*>\s*/i, "").replace(/<meta name="viewport"[^>]*>\s*/i, "")
    .replace("<title>FINEXA PHARMA</title>", "<title>FINEXA PHARMA (démonstration)</title>");
writeFileSync(sortie, html);
console.log(`${sortie} : ${(html.length / 1024).toFixed(0)} Kio`);
