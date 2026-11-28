/**
 * Identité FINEXA ERP côté serveur (documents PDF, valeurs par défaut du profil d'entreprise).
 * Mêmes valeurs que interface/src/jetons.css.
 */
export const NOM_LOGICIEL = "FINEXA ERP";
export const EDITEUR = "Incubateur Technologique de l'Innovation (ITI)";

export const FINEXA = {
  navy: "#062b68", blue: "#0647a9", cyan: "#00b8f0", green: "#65c900", greenDark: "#08752d",
  white: "#ffffff", background: "#f4f7fb", text: "#263449", textMuted: "#64748b", border: "#dce5ef",
} as const;

/** Couleurs d'une entreprise qui n'a pas choisi les siennes : celles de FINEXA ERP. */
export const COULEURS_DEFAUT = { principale: FINEXA.navy, accent: FINEXA.blue };
