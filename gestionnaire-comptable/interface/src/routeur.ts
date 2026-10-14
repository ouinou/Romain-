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
