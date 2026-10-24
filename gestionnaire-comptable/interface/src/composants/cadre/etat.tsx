import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Informations que les écrans publient dans le cadre : la somme de la sélection (barre d'état)
 * et le panneau de détail rétractable affiché à droite de la zone de travail.
 */
interface EtatCadre { somme: string | null; setSomme: (s: string | null) => void }
const Ctx = createContext<EtatCadre>({ somme: null, setSomme: () => {} });
export const useEtatCadre = () => useContext(Ctx);

export function FournisseurEtatCadre({ children }: { children: ReactNode }) {
  const [somme, setSomme] = useState<string | null>(null);
  return <Ctx.Provider value={{ somme, setSomme }}>{children}</Ctx.Provider>;
}

/** Publie la somme de la sélection tant que l'écran est ouvert. */
export function useSommeSelection(somme: string | null) {
  const { setSomme } = useEtatCadre();
  useEffect(() => { setSomme(somme); }, [somme, setSomme]);
  useEffect(() => () => setSomme(null), [setSomme]);
}

/** Panneau de détail à droite de la zone de travail (rendu dans l'emplacement prévu par le cadre). */
export function PanneauDetail({ titre, onFermer, children }: { titre: string; onFermer: () => void; children: ReactNode }) {
  const [cible, setCible] = useState<HTMLElement | null>(null);
  useEffect(() => { setCible(document.getElementById("emplacement-detail")); }, []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onFermer(); };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [onFermer]);
  if (!cible) return null;
  return createPortal(
    <aside className="panneau-detail" aria-label={titre}>
      <header><span>{titre}</span><button onClick={onFermer} aria-label="Fermer le panneau de détail" title="Fermer (Échap)">✕</button></header>
      <div className="corps-detail">{children}</div>
    </aside>, cible);
}
