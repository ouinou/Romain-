/**
 * Jeu d'icônes du logiciel, dessiné pour lui (aucune bibliothèque externe, aucune marque).
 * Deux tons, comme les icônes des suites bureautiques : le tracé prend la couleur du texte
 * (currentColor : bleu nuit dans le ruban, blanc dans le menu latéral) et le repère prend
 * la couleur d'accent de l'entreprise (--accent). Grille de 24 × 24, trait de 1,6.
 */
import type { ReactNode } from "react";

const A = "var(--accent)";   // repère (orange par défaut)
const V = "var(--vert)";
const R = "var(--rouge)";

const DESSINS: Record<string, ReactNode> = {
  accueil: <><path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><rect x="10" y="14" width="4" height="6" fill={A} stroke="none"/></>,
  ventes: <><path d="M4 5h2l2.2 10h9.6L20 8H7.2"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M11 11.5h5" stroke={A}/></>,
  tresorerie: <><rect x="3" y="7" width="18" height="12" rx="1.5"/><path d="M3 11h18"/><rect x="14" y="13.5" width="4" height="3" fill={A} stroke="none"/><path d="M6 7V5h12v2"/></>,
  comptabilite: <><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="M15 15.5h3M16.5 14v3" stroke={A}/></>,
  etats: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 17v-3M12 17v-6M15 17v-4" stroke={A} strokeWidth="2"/></>,
  administration: <><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/><circle cx="12" cy="12" r="1.2" fill={A} stroke="none"/></>,
  facture: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 11h7M9 14h7M9 17h4"/><circle cx="17.5" cy="18.5" r="3" fill={A} stroke="none"/><path d="M17.5 17v3M16 18.5h3" stroke="#fff" strokeWidth="1.4"/></>,
  avoir: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 11h7M9 14h5"/><circle cx="17.5" cy="18.5" r="3" fill={R} stroke="none"/><path d="M16 18.5h3" stroke="#fff" strokeWidth="1.4"/></>,
  client: <><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="18" cy="17" r="3" fill={A} stroke="none"/><path d="M18 15.6v2.8M16.6 17h2.8" stroke="#fff" strokeWidth="1.4"/></>,
  clients: <><circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5" stroke={A}/><path d="M3 19c.5-3.2 2.9-5 6-5s5.5 1.8 6 5M15 14.2c2.6.2 4.6 1.8 5 4.8"/></>,
  reglement: <><rect x="3" y="6" width="15" height="10" rx="1.5"/><circle cx="10.5" cy="11" r="2.2"/><path d="M14 19h7M18 16l3 3-3 3" stroke={V}/></>,
  encaissement: <><rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M12 2v8M8.5 6.5 12 10l3.5-3.5" stroke={V} strokeWidth="1.8"/><circle cx="12" cy="15" r="2"/></>,
  depense: <><rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M12 10V2M8.5 5.5 12 2l3.5 3.5" stroke={R} strokeWidth="1.8"/><circle cx="12" cy="15" r="2"/></>,
  transfert: <><path d="M4 8h14l-3-3M20 16H6l3 3"/><circle cx="12" cy="12" r="1.3" fill={A} stroke="none"/></>,
  caisse: <><rect x="3" y="10" width="18" height="10" rx="1.5"/><path d="M6 10V5h12v5M9 7.5h6"/><rect x="9" y="13.5" width="6" height="3" fill={A} stroke="none"/></>,
  banque: <><path d="M3 9.5 12 4l9 5.5H3zM5 20h14M6.5 11.5v6M10.5 11.5v6M13.5 11.5v6M17.5 11.5v6"/><circle cx="12" cy="7.3" r="1" fill={A} stroke="none"/></>,
  mobile: <><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 18.5h3"/><path d="M9.5 9.5h5M12 7v5" stroke={A}/></>,
  mouvements: <><path d="M4 7h11M4 12h16M4 17h9"/><path d="M17 4l3 3-3 3" stroke={A}/></>,
  saisie: <><rect x="4" y="3" width="13" height="18" rx="1.5"/><path d="M7 8h7M7 12h5"/><path d="m13 19 1-3.5 6-6 2.5 2.5-6 6z" fill={A} stroke={A}/></>,
  ecritures: <><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 8h16M10 8v13"/><path d="M12.5 12h5M12.5 15.5h5" stroke={A}/></>,
  valider: <><circle cx="12" cy="12" r="9"/><path d="m7.5 12.3 3 3 6-6.3" stroke={V} strokeWidth="2"/></>,
  balance: <><path d="M12 4v16M7 20h10M5 7h14"/><path d="M5 7 2.5 13h5zM19 7l-2.5 6h5z" stroke={A}/></>,
  grandlivre: <><path d="M4 5.5C6.5 4 9.5 4 12 5.5 14.5 4 17.5 4 20 5.5V20c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0z"/><path d="M12 5.5V20"/><path d="M14.5 9h3M14.5 12h3" stroke={A}/></>,
  plan: <><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h1M11 8h5M8 12h1M11 12h5M8 16h1M11 16h5"/><path d="M8 8h1M8 12h1M8 16h1" stroke={A} strokeWidth="2.2"/></>,
  journaux: <><path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z"/><path d="M6 19a2 2 0 0 1 2-2h11"/><path d="M10 7h6M10 10.5h4" stroke={A}/></>,
  parametres: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2" stroke={A}/><circle cx="10" cy="17" r="2.2" stroke={A}/></>,
  direct: <><path d="M3 18 8 12l4 3 4-6 5 4"/><circle cx="19.5" cy="5.5" r="2.5" fill={R} stroke="none"/></>,
  verifier: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="5.5" y="5.5" width="2" height="2" fill="currentColor"/><rect x="16.5" y="5.5" width="2" height="2" fill="currentColor"/><rect x="5.5" y="16.5" width="2" height="2" fill="currentColor"/><path d="m14 17.5 2.2 2.2 4.3-4.6" stroke={V} strokeWidth="2"/></>,
  utilisateurs: <><circle cx="9" cy="8" r="3.2"/><path d="M2.8 20c.6-3.4 3-5.3 6.2-5.3s5.6 1.9 6.2 5.3"/><circle cx="17" cy="9" r="2.5" stroke={A}/><path d="M16 14.6c2.7.3 4.6 2 5.2 5" stroke={A}/></>,
  nouvelutilisateur: <><circle cx="9" cy="8" r="3.2"/><path d="M2.8 20c.6-3.4 3-5.3 6.2-5.3 2 0 3.7.7 4.8 2"/><circle cx="18" cy="17" r="3.2" fill={A} stroke="none"/><path d="M18 15.4v3.2M16.4 17h3.2" stroke="#fff" strokeWidth="1.4"/></>,
  roles: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.3 2.3 4.2-4.5" stroke={A} strokeWidth="1.8"/></>,
  audit: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 10h6M9 13h3"/><circle cx="15" cy="16.5" r="2.5" stroke={A}/><path d="m16.8 18.3 2.2 2.2" stroke={A}/></>,
  entreprise: <><path d="M4 21V6l8-3v18M12 9h8v12"/><path d="M7 9h2M7 12.5h2M7 16h2M15 13h2M15 16.5h2"/><path d="M2.5 21h19"/><rect x="15" y="10.2" width="2" height="1.4" fill={A} stroke="none"/></>,
  compte: <><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.7-3.8 3.4-5.8 7-5.8s6.3 2 7 5.8"/></>,
  quitter: <><path d="M14 4h5v16h-5"/><path d="M10 8 6 12l4 4M6 12h9" stroke={R} strokeWidth="1.8"/></>,
  sauvegarde: <><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="5" fill={A} stroke="none"/></>,
  aide: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.2 1-1.2 1.8v.7"/><circle cx="12" cy="17" r="1" fill={A} stroke="none"/></>,
  imprimer: <><path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="1.5"/><path d="M7 14h10v7H7z"/><circle cx="17.5" cy="11" r="1" fill={A} stroke="none"/></>,
  actualiser: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4h-4" stroke={A}/></>,
  retour: <><path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/></>,
  recherche: <><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/></>,
  fermer: <><path d="m6 6 12 12M18 6 6 18"/></>,
  chevron: <><path d="m9 6 6 6-6 6"/></>,
  nouveau: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M12.5 11v6M9.5 14h6" stroke={A} strokeWidth="1.8"/></>,
  ouvrir: <><path d="M3 7h6l2 2h10v10H3z"/><path d="M13 13h5M16 11l2 2-2 2" stroke={A}/></>,
  exporter: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M12.5 18v-7M9.8 13.5l2.7-2.7 2.7 2.7" stroke={A} strokeWidth="1.8"/></>,
  pdf: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><rect x="7.5" y="12" width="9" height="5" rx="1" fill={R} stroke="none"/></>,
  cloche: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></>,
  alerte: <><path d="M12 3 2 20h20z"/><path d="M12 9.5v5" strokeWidth="2"/><circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none"/></>,
  calendrier: <><rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><rect x="13.5" y="13" width="4" height="3.5" fill={A} stroke="none"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
};

export type NomIcone = keyof typeof DESSINS;

export function Icone({ nom, taille = 20, className }: { nom: string; taille?: number; className?: string }) {
  return (
    <svg className={"icone-svg" + (className ? " " + className : "")} width={taille} height={taille} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {DESSINS[nom] ?? DESSINS.nouveau}
    </svg>
  );
}
