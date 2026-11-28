import { useEffect, useState } from "react";

/**
 * Navigation par fragment d'URL (#/utilisateurs/…). Seuls des noms de page et des identifiants
 * techniques y figurent, jamais de donnée sensible (code, jeton, mot de passe).
 */
export function useRoute() {
  const lire = () => (location.hash.replace(/^#/, "") || "/").split("?")[0];
  const [route, setRoute] = useState(lire);
  useEffect(() => {
    const f = () => setRoute(lire());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return route;
}

export const aller = (chemin: string) => { location.hash = chemin; };

/** Paramètres du fragment (#/tresorerie?action=entree), relus à chaque changement d'adresse. */
export function useParametres() {
  const lire = () => new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [p, setP] = useState(lire);
  useEffect(() => {
    const f = () => setP(lire());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return p;
}

/** Retire les paramètres du fragment sans recharger l'écran (une commande du ruban ne se rejoue pas au retour). */
export const effacerParametres = () => {
  const [chemin] = location.hash.split("?");
  history.replaceState(null, "", chemin || "#/");
};
