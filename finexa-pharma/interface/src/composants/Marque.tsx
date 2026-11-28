import logo from "../assets/marque/finexa-logo.png";
import embleme from "../assets/marque/finexa-embleme.png";

/** Identité du logiciel : FINEXA PHARMA (gamme FINEXA Suite), édité par l'Incubateur Technologique de l'Innovation (ITI). */
export const NOM_LOGICIEL = "FINEXA PHARMA";
export const EDITEUR = "Incubateur Technologique de l'Innovation (ITI)";
export const SLOGAN = "La gestion intelligente de votre pharmacie.";

/** Logo complet (emblème, nom, slogan) des écrans d'accueil. */
export function LogoFinexa({ largeur = 240 }: { largeur?: number }) {
  return <img className="logo-finexa" src={logo} width={largeur} alt={`${NOM_LOGICIEL} : ${SLOGAN}`} />;
}

/** Emblème seul (barre de titre). */
export function EmblemeFinexa({ taille = 26 }: { taille?: number }) {
  return <img className="embleme-finexa" src={embleme} width={taille} height={taille} alt="" />;
}
