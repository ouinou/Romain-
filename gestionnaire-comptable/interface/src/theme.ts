/**
 * Couleurs de l'entreprise appliquées à l'interface.
 * L'entreprise choisit deux couleurs (principale, accent) ; on en dérive les variables CSS en garantissant
 * la lisibilité (contrastes WCAG) : une couleur trop claire est assombrie là où elle porte du texte.
 */
import { api } from "./api";

export interface Couleurs { principale: string; accent: string }
export interface Apparence { raisonSociale: string; couleurs: Couleurs; logoId: string | null; logoUrl: string | null }
export const COULEURS_DEFAUT: Couleurs = { principale: "#101d35", accent: "#ff6a00" };

type RGB = [number, number, number];
const versRgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const versHex = (c: RGB) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
function luminance(h: string) {
  const [r, g, b] = versRgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contraste = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** Mélange de deux couleurs (t = part de la seconde). */
const melange = (a: string, b: string, t: number) => { const [x, y] = [versRgb(a), versRgb(b)]; return versHex(x.map((v, i) => v + (y[i] - v) * t) as RGB); };
/** Assombrit la couleur jusqu'à atteindre le contraste voulu face à `fond`. */
export function assombrirPour(h: string, fond: string, cible: number) {
  let c = h;
  for (let i = 0; i < 60 && contraste(c, fond) < cible; i++) c = melange(c, "#000000", 0.06);
  return c;
}
/** Éclaircit la couleur jusqu'à atteindre le contraste voulu face à `fond` (accents sur la barre latérale). */
function eclaircirPour(h: string, fond: string, cible: number) {
  let c = h;
  for (let i = 0; i < 60 && contraste(c, fond) < cible; i++) c = melange(c, "#ffffff", 0.06);
  return c;
}

export function variables(c: Couleurs): Record<string, string> {
  const marine = assombrirPour(c.principale, "#ffffff", 9);   // fond de la barre latérale : texte clair très lisible
  const bouton = assombrirPour(c.accent, "#ffffff", 4.6);       // bouton principal à texte blanc
  return {
    "--marine": marine,
    "--marine-2": melange(marine, "#ffffff", 0.08),
    "--marine-3": melange(marine, "#ffffff", 0.15),
    "--marine-fin": melange(marine, "#000000", 0.3),
    "--bleu": bouton,
    "--bleu-fonce": melange(bouton, "#000000", 0.14),
    "--cyan": eclaircirPour(c.accent, marine, 3),                 // repères et focus, visibles sur la barre
    "--lien": assombrirPour(c.accent, "#f3f5f8", 4.6),
    "--orange-doux": melange(c.accent, "#ffffff", 0.9),
  };
}

export function appliquerCouleurs(c: Couleurs | null) {
  const s = document.documentElement.style;
  const v = variables(COULEURS_DEFAUT);
  for (const k of Object.keys(v)) s.removeProperty(k);
  if (!c || (c.principale === COULEURS_DEFAUT.principale && c.accent === COULEURS_DEFAUT.accent)) return;   // feuille de style d'origine
  for (const [k, val] of Object.entries(variables(c))) s.setProperty(k, val);
}

/** Recharge l'apparence (après une modification du profil) : les écrans abonnés se mettent à jour. */
export const EVENEMENT_APPARENCE = "gc-apparence";
export async function chargerApparence(): Promise<Apparence | null> {
  try { const a = await api.get<Apparence>("/api/entreprise/apparence"); appliquerCouleurs(a.couleurs); return a; }
  catch { return null; }
}
