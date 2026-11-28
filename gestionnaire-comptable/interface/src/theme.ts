/**
 * Couleurs de l'entreprise appliquées à l'interface.
 * L'entreprise choisit deux couleurs (principale, accent) ; on en dérive les variables CSS en garantissant
 * la lisibilité (contrastes WCAG) : une couleur trop claire est assombrie là où elle porte du texte.
 */
import { api } from "./api";
import { FINEXA } from "./jetons";

export interface Couleurs { principale: string; accent: string }
export interface Apparence {
  raisonSociale: string; nomCommercial?: string | null; sigle?: string | null; couleurs: Couleurs; logoId: string | null; logoUrl: string | null;
  /** Identité courte imprimée en tête des états comptables et des listes. */
  etat?: { raisonSociale: string; sousTitre: string | null; lignes: string[] };
}
/** Couleurs de FINEXA ERP (identité visuelle officielle) : bleu marine et bleu. */
export const COULEURS_DEFAUT: Couleurs = { principale: FINEXA.navy, accent: FINEXA.blue };

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

export function variables(c: Couleurs): Record<string, string> {
  // Structure (barre de titre, menu latéral, barre d'état) : couleur principale, assez foncée pour du texte blanc.
  const marine = assombrirPour(c.principale, "#ffffff", 9);
  // Accent : gardé tel quel en fond (boutons, sélection) avec le texte le plus lisible dessus (bleu nuit, noir ou blanc).
  const accent = c.accent;
  const surAccent = [marine, "#000000", "#ffffff"].sort((x, y) => contraste(y, accent) - contraste(x, accent))[0];
  return {
    "--marine": marine,
    "--marine-2": melange(marine, "#ffffff", 0.07),
    "--marine-3": melange(marine, "#ffffff", 0.14),
    "--marine-fin": melange(marine, "#000000", 0.3),
    "--accent": accent,
    "--accent-texte": surAccent,
    "--accent-fonce": melange(accent, "#000000", 0.12),
    "--accent-doux": melange(accent, "#ffffff", 0.9),
    "--lien": assombrirPour(accent, "#ffffff", 4.6),   // l'accent utilisé comme texte sur fond blanc
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
