/**
 * Identité FINEXA PHARMA côté serveur (charte commune à la gamme FINEXA) (documents PDF, valeurs par défaut du profil d'entreprise).
 * Mêmes valeurs que interface/src/jetons.css.
 */
export const NOM_LOGICIEL = "FINEXA PHARMA";
export const SLOGAN = "La gestion intelligente de votre pharmacie.";
export const EDITEUR = "Incubateur Technologique de l'Innovation (ITI)";

export const FINEXA = {
  navy: "#062b68", blue: "#0647a9", cyan: "#00b8f0", green: "#65c900", greenDark: "#08752d",
  white: "#ffffff", background: "#f4f7fb", text: "#263449", textMuted: "#64748b", border: "#dce5ef",
} as const;

/** Couleurs d'une entreprise qui n'a pas choisi les siennes : celles de la suite FINEXA. */
export const COULEURS_DEFAUT = { principale: FINEXA.navy, accent: FINEXA.blue };
