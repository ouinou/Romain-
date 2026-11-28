import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiErreur, surConfirmationRequise, surSessionPerdue } from "./api";
import type { Moi } from "./types";
import { SessionCtx, useSession, type Session } from "./session";
import { useRoute } from "./routeur";
import { Chargement } from "./composants/ui";
import { FenetreReauthentification } from "./composants/Confirmations";
import { Accueil } from "./pages/Accueil";
import { ConfigurationMfa } from "./pages/ConfigurationMfa";
import { TableauDeBord } from "./pages/TableauDeBord";
import { Utilisateurs } from "./pages/Utilisateurs";
import { FicheUtilisateur } from "./pages/FicheUtilisateur";
import { Roles } from "./pages/Roles";
import { FicheRole } from "./pages/FicheRole";
import { Journal } from "./pages/Journal";
import { Entreprise } from "./pages/Entreprise";
import { MonCompte } from "./pages/MonCompte";
import { Produits, NouveauProduit, FicheProduit } from "./pages/pharmacie/Produits";
import { ImportProduits, Referentiels } from "./pages/pharmacie/Catalogue";
import { Lots, FicheLot, EntreeStock, Mouvements, Alertes } from "./pages/pharmacie/Stock";
import { Inventaires, FicheInventaire } from "./pages/pharmacie/Inventaires";
import { appliquerCouleurs, chargerApparence, EVENEMENT_APPARENCE, type Apparence } from "./theme";
import { Cadre, type Onglet } from "./composants/cadre/Cadre";
import { FournisseurEtatCadre } from "./composants/cadre/etat";
import { aller } from "./routeur";

export function App() {
  const [moi, setMoi] = useState<Moi | null>(null);
  const [etat, setEtat] = useState<"chargement" | "deconnecte" | "connecte">("chargement");
  const [message, setMessage] = useState<string | null>(null);
  const [reauth, setReauth] = useState<((ok: boolean) => void) | null>(null);
  const moiRef = useRef<Moi | null>(null);
  moiRef.current = moi;

  const charger = useCallback(async () => {
    try { setMoi(await api.get<Moi>("/api/auth/moi")); setEtat("connecte"); }
    catch (e) { if (e instanceof ApiErreur && e.statut === 401) { setMoi(null); setEtat("deconnecte"); } else throw e; }
  }, []);

  useEffect(() => {
    surSessionPerdue((m) => { setMoi(null); setMessage(m); setEtat("deconnecte"); });
    surConfirmationRequise(() => new Promise<boolean>((resoudre) => setReauth(() => (ok: boolean) => { setReauth(null); resoudre(ok); })));
    charger().catch(() => { setEtat("deconnecte"); setMessage("Le serveur ne répond pas. Vérifiez la connexion au réseau de l'entreprise."); });
  }, [charger]);

  if (etat === "chargement") return <Chargement texte="Connexion au serveur…" />;
  if (etat === "deconnecte" || !moi) return <><Bandeau /><Accueil message={message} onConnecte={() => { setMessage(null); charger(); }} /></>;

  const session: Session = {
    moi,
    a: (p) => moi.permissions.includes(p),
    rafraichir: charger,
    deconnecter: async () => {
      try { await api.post("/api/auth/deconnexion"); } catch { /* session déjà fermée */ }
      setMoi(null); setMessage("Vous êtes déconnecté."); setEtat("deconnecte"); location.hash = "";
    },
  };

  return (
    <SessionCtx.Provider value={session}>
      <Bandeau />
      {moi.mfa.requise && !moi.mfa.active ? <ConfigurationMfa obligatoire /> : <FournisseurEtatCadre><Coquille /></FournisseurEtatCadre>}
      {reauth && <FenetreReauthentification mfa={moiRef.current?.mfa.active ?? false} onFin={reauth} />}
    </SessionCtx.Provider>
  );
}

/** Pas de démonstration « serveur simulé » pour FINEXA PHARMA (l'évaluation se fait avec l'officine fictive du setup). */
function Bandeau() {
  if (!__DEMO__) return null;
  return (
    <div className="bandeau-demo" role="note">
      Démonstration : serveur simulé dans le navigateur, données fictives, aucune sécurité réelle (le vrai logiciel s'installe sur le serveur de la pharmacie).
      Code <b>PH-DEMO-2026</b>, mot de passe <b>Demonstration-2026!</b>. Comptes : <b>aissatou.bello@demo.cm</b> (pharmacienne titulaire, administratrice),
      {" "}<b>esther.ngobassa@demo.cm</b> (gestionnaire de stock), <b>clarisse.mbarga@demo.cm</b> (vendeuse), <b>marc.eyinga@demo.cm</b> (adjoint), <b>hamadou.bouba@demo.cm</b> (caissier).
    </div>
  );
}

function Coquille() {
  const route = useRoute();
  const { a, moi, rafraichir } = useSession();
  const [cle, setCle] = useState(0);   // « Actualiser » : l'écran est recréé et recharge ses données
  // Couleurs, logo et identité de l'entreprise (profil) ; rechargés quand l'administrateur modifie le profil, retirés à la déconnexion.
  const [apparence, setApparence] = useState<Apparence | null>(null);
  const derniereLecture = useRef(0);
  const nomConnu = useRef(moi.entreprise.raisonSociale);
  nomConnu.current = moi.entreprise.raisonSociale;
  const maj = useCallback(() => {
    derniereLecture.current = Date.now();
    chargerApparence().then((ap) => {
      setApparence(ap);
      // Profil modifié depuis un autre poste : la session (nom dans la barre de titre) est relue elle aussi.
      if (ap && ap.raisonSociale !== nomConnu.current) rafraichir().catch(() => {});
    });
  }, [rafraichir]);
  useEffect(() => {
    maj();
    window.addEventListener(EVENEMENT_APPARENCE, maj);
    return () => { window.removeEventListener(EVENEMENT_APPARENCE, maj); appliquerCouleurs(null); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Un autre utilisateur peut modifier le profil pendant qu'on travaille : relecture à chaque changement d'écran
  // (une petite requête sur le réseau local) et au retour sur la fenêtre (au plus toutes les 5 secondes),
  // pour que les en-têtes imprimés soient à jour. Pas sur la page du profil, où l'aperçu des couleurs en cours
  // de saisie ne doit pas être écrasé.
  const premierAffichage = useRef(true);
  useEffect(() => {
    if (route.startsWith("/entreprise")) return;
    if (premierAffichage.current) premierAffichage.current = false;   // déjà lue au montage
    else maj();
    const auRetour = () => { if (Date.now() - derniereLecture.current > 5000) maj(); };
    window.addEventListener("focus", auRetour);
    return () => window.removeEventListener("focus", auRetour);
  }, [route, maj]);

  const [section, id] = route.split("/").filter(Boolean);
  let page: JSX.Element, titre: string;
  const interdit = <div className="alerte alerte-erreur">Vous n'avez pas accès à cette page.</div>;
  switch (section) {
    case "utilisateurs": titre = id ? "Fiche utilisateur" : "Utilisateurs"; page = !a("users.read") ? interdit : id ? <FicheUtilisateur id={id} /> : <Utilisateurs />; break;
    case "roles": titre = id ? "Fiche rôle" : "Rôles et permissions"; page = !a("roles.read") ? interdit : id ? <FicheRole id={id} /> : <Roles />; break;
    case "journal": titre = "Journal d'audit"; page = !a("audit.read") ? interdit : <Journal />; break;
    case "entreprise": titre = "Pharmacie"; page = !a("company.read") ? interdit : <Entreprise />; break;
    case "mon-compte": titre = "Mon compte"; page = <MonCompte />; break;
    case "catalogue": {
      const [, sous, pid] = route.split("/").filter(Boolean);
      if (sous === "nouveau") { titre = "Nouveau produit"; page = a("catalog.create") ? <NouveauProduit /> : interdit; }
      else if (sous === "import") { titre = "Importer un catalogue"; page = a("catalog.create") ? <ImportProduits /> : interdit; }
      else if (sous === "referentiels") { titre = "Catégories et référentiels"; page = a("catalog.read") ? <Referentiels /> : interdit; }
      else if (sous === "produits" && pid) { titre = "Fiche produit"; page = a("catalog.read") ? <FicheProduit id={pid} /> : interdit; }
      else { titre = "Produits"; page = a("catalog.read") ? <Produits /> : interdit; }
      break;
    }
    case "stock": {
      const [, sous, sid] = route.split("/").filter(Boolean);
      if (sous === "entree") { titre = "Entrée de stock"; page = a("stock.create") ? <EntreeStock /> : interdit; }
      else if (sous === "lots" && sid) { titre = "Fiche lot"; page = a("stock.read") ? <FicheLot id={sid} /> : interdit; }
      else if (sous === "mouvements") { titre = "Mouvements de stock"; page = a("stock.read") ? <Mouvements /> : interdit; }
      else if (sous === "inventaires") { titre = sid ? "Inventaire" : "Inventaires"; page = !a("stock.read") ? interdit : sid ? <FicheInventaire id={sid} /> : <Inventaires />; }
      else if (sous === "alertes") { titre = "Alertes de stock"; page = a("stock.read") ? <Alertes /> : interdit; }
      else { titre = "Lots en stock"; page = a("stock.read") ? <Lots /> : interdit; }
      break;
    }
    default: titre = "Tableau de bord"; page = <TableauDeBord />;
  }
  return <CoquilleOnglets route={route} titre={titre} page={page} apparence={apparence} cle={cle} setCle={setCle} />;
}

/** Documents ouverts : chaque écran visité reste disponible dans un onglet (le tableau de bord en premier). */
function CoquilleOnglets({ route, titre, page, apparence, cle, setCle }: {
  route: string; titre: string; page: JSX.Element; apparence: Apparence | null; cle: number; setCle: (f: (k: number) => number) => void;
}) {
  const [onglets, setOnglets] = useState<Onglet[]>([{ chemin: "/", titre: "Tableau de bord" }]);
  useEffect(() => {
    setOnglets((l) => {
      if (l.some((o) => o.chemin === route)) return l.map((o) => (o.chemin === route ? { ...o, titre } : o));
      const suite = [...l, { chemin: route, titre }];
      return suite.length > 10 ? [suite[0], ...suite.slice(-9)] : suite;
    });
  }, [route, titre]);
  const fermerOnglet = (chemin: string) => {
    const i = onglets.findIndex((o) => o.chemin === chemin);
    const reste = onglets.filter((o) => o.chemin !== chemin);
    setOnglets(reste);
    if (chemin === route) aller((reste[i - 1] ?? reste[0]).chemin);
  };
  return <Cadre route={route} titre={titre} page={page} logoUrl={apparence?.logoUrl ?? null} etat={apparence?.etat ?? null} cle={cle}
    onActualiser={() => setCle((k) => k + 1)} onglets={onglets} onFermerOnglet={fermerOnglet} />;
}
