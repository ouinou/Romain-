import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiErreur, surConfirmationRequise, surSessionPerdue } from "./api";
import type { Moi, Notification } from "./types";
import { SessionCtx, useSession, type Session } from "./session";
import { useRoute } from "./routeur";
import { Chargement, dateHeure, initiales, useToast } from "./composants/ui";
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
import { TableauComptable } from "./pages/comptabilite/TableauComptable";
import { PlanComptable } from "./pages/comptabilite/PlanComptable";
import { Journaux } from "./pages/comptabilite/Journaux";
import { Ecritures } from "./pages/comptabilite/Ecritures";
import { SaisieEcriture } from "./pages/comptabilite/SaisieEcriture";
import { FicheEcriture } from "./pages/comptabilite/FicheEcriture";
import { GrandLivre } from "./pages/comptabilite/GrandLivre";
import { Balance } from "./pages/comptabilite/Balance";
import { ParametresComptables } from "./pages/comptabilite/ParametresComptables";

interface EntreeNav { chemin: string; libelle: string; icone: string; permission?: string }
const NAV: { titre: string; entrees: EntreeNav[] }[] = [
  { titre: "Pilotage", entrees: [{ chemin: "/", libelle: "Tableau de bord", icone: "▦" }] },
  { titre: "Comptabilité", entrees: [
    { chemin: "/comptabilite", libelle: "Tableau comptable", icone: "◧", permission: "accounting.read" },
    { chemin: "/comptabilite/ecritures", libelle: "Écritures", icone: "✎", permission: "accounting.read" },
    { chemin: "/comptabilite/grand-livre", libelle: "Grand livre", icone: "☷", permission: "accounting.read" },
    { chemin: "/comptabilite/balance", libelle: "Balance générale", icone: "⚖", permission: "accounting.read" },
    { chemin: "/comptabilite/plan", libelle: "Plan comptable", icone: "▤", permission: "accounting.read" },
    { chemin: "/comptabilite/journaux", libelle: "Journaux", icone: "▥", permission: "accounting.read" },
    { chemin: "/comptabilite/parametres", libelle: "Exercices et paramètres", icone: "⚙", permission: "accounting.read" },
  ] },
  { titre: "Administration", entrees: [
    { chemin: "/utilisateurs", libelle: "Utilisateurs", icone: "♙", permission: "users.read" },
    { chemin: "/roles", libelle: "Rôles et permissions", icone: "▤", permission: "roles.read" },
    { chemin: "/journal", libelle: "Journal d'audit", icone: "◷", permission: "audit.read" },
    { chemin: "/entreprise", libelle: "Entreprise", icone: "▣", permission: "company.read" },
  ] },
  { titre: "Personnel", entrees: [{ chemin: "/mon-compte", libelle: "Mon compte", icone: "◉" }] },
];

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
      {moi.mfa.requise && !moi.mfa.active ? <ConfigurationMfa obligatoire /> : <Coquille />}
      {reauth && <FenetreReauthentification mfa={moiRef.current?.mfa.active ?? false} onFin={reauth} />}
    </SessionCtx.Provider>
  );
}

function Bandeau() {
  if (!__DEMO__) return null;
  return (
    <div className="bandeau-demo" role="note">
      Démonstration : serveur simulé dans le navigateur, données fictives, aucune sécurité réelle (le vrai logiciel s'installe sur le serveur de l'entreprise).
      Code <b>GC-DEMO-2026</b>, mot de passe <b>Demonstration-2026!</b>. Comptes : <b>mariam.saleh@demo.cm</b> (administratrice), <b>paul.ngaro@demo.cm</b> (comptable),
      {" "}<b>ousmane.djibrine@demo.cm</b> (DAF), <b>joseph.atangana@demo.cm</b> (DG), <b>amina.mahamat@demo.cm</b> (caissière).
    </div>
  );
}

function Coquille() {
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const { moi, a, deconnecter } = useSession();
  useEffect(() => setMenu(false), [route]);

  const [section, id] = route.split("/").filter(Boolean);
  let page: JSX.Element, titre: string;
  const interdit = <div className="alerte alerte-erreur">Vous n'avez pas accès à cette page.</div>;
  switch (section) {
    case "utilisateurs": titre = "Utilisateurs"; page = !a("users.read") ? interdit : id ? <FicheUtilisateur id={id} /> : <Utilisateurs />; break;
    case "roles": titre = "Rôles et permissions"; page = !a("roles.read") ? interdit : id ? <FicheRole id={id} /> : <Roles />; break;
    case "journal": titre = "Journal d'audit"; page = !a("audit.read") ? interdit : <Journal />; break;
    case "entreprise": titre = "Entreprise"; page = !a("company.read") ? interdit : <Entreprise />; break;
    case "mon-compte": titre = "Mon compte"; page = <MonCompte />; break;
    case "comptabilite": {
      const [, , ecritureId, mode] = route.split("/").filter(Boolean);
      const pages: Record<string, [string, JSX.Element]> = {
        plan: ["Plan comptable", <PlanComptable />], journaux: ["Journaux comptables", <Journaux />],
        "grand-livre": ["Grand livre", <GrandLivre />], balance: ["Balance générale", <Balance />],
        parametres: ["Exercices et paramètres", <ParametresComptables />],
        ecritures: ["Écritures", !ecritureId ? <Ecritures /> : ecritureId === "nouvelle"
          ? (a("accounting.create") ? <SaisieEcriture /> : interdit)
          : mode === "modifier" ? (a("accounting.update") ? <SaisieEcriture id={ecritureId} /> : interdit) : <FicheEcriture id={ecritureId} />],
      };
      const [t, p] = (id && pages[id]) || ["Tableau comptable", <TableauComptable />];
      titre = t; page = a("accounting.read") ? p : interdit;
      break;
    }
    default: titre = "Tableau de bord"; page = <TableauDeBord />;
  }
  // Entrée de menu active : la plus longue qui préfixe la route (ex. /comptabilite/ecritures/… → Écritures).
  const actif = NAV.flatMap((g) => g.entrees.map((e) => e.chemin)).filter((c) => c === "/" ? route === "/" : route === c || route.startsWith(c + "/"))
    .sort((x, y) => y.length - x.length)[0] ?? "/";

  return (
    <div className={"app" + (menu ? " menu-ouvert" : "")}>
      <aside className="laterale" aria-label="Navigation principale">
        <div className="marque">
          <div className="logo" aria-hidden="true">GC</div>
          <div><h1>GESTIONNAIRE<br />COMPTABLE</h1><p>{moi.entreprise.raisonSociale}</p></div>
        </div>
        <nav className="nav">
          {NAV.map((g) => {
            const entrees = g.entrees.filter((e) => !e.permission || a(e.permission));
            if (!entrees.length) return null;
            return (
              <div key={g.titre}>
                <div className="nav-titre">{g.titre}</div>
                {entrees.map((e) => (
                  <a key={e.chemin} href={"#" + e.chemin} aria-current={actif === e.chemin ? "page" : undefined}>
                    <span className="icone" aria-hidden="true">{e.icone}</span>{e.libelle}
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="bas">Espace {moi.entreprise.code}<br />Réseau local · version 0.1</div>
      </aside>
      <div className="principal" onClick={() => menu && setMenu(false)}>
        <header className="barre">
          <button className="btn btn-petit bouton-menu" aria-label="Ouvrir le menu" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>☰</button>
          <div className="titre">
            <div className="fil">{moi.entreprise.raisonSociale} / {titre}</div>
            <strong>{titre}</strong>
          </div>
          <Notifications />
          <div className="profil">
            <div className="avatar" aria-hidden="true">{initiales(moi.utilisateur.nom)}</div>
            <div className="nom"><b>{moi.utilisateur.nom}</b><br /><span className="discret">{moi.roles.map((r) => r.libelle).join(", ") || "Aucun rôle"}</span></div>
            <button className="btn btn-petit" onClick={deconnecter}>Déconnexion</button>
          </div>
        </header>
        <main className="contenu" id="contenu">{page}</main>
      </div>
    </div>
  );
}

function Notifications() {
  const [ouvert, setOuvert] = useState(false);
  const [liste, setListe] = useState<{ elements: Notification[]; nonLues: number } | null>(null);
  const toast = useToast();
  const charger = useCallback(() => api.get("/api/notifications?taille=20").then(setListe).catch(() => {}), []);
  useEffect(() => { charger(); const t = setInterval(charger, 60_000); return () => clearInterval(t); }, [charger]);
  const lire = async (n: Notification) => {
    if (n.lue) return;
    try { await api.post(`/api/notifications/${n.id}/lecture`); charger(); } catch { toast("Impossible de marquer la notification comme lue.", true); }
  };
  return (
    <div className="cloche">
      <button className="btn btn-petit" aria-expanded={ouvert} aria-label={`Notifications${liste?.nonLues ? `, ${liste.nonLues} non lues` : ""}`} onClick={() => setOuvert(!ouvert)}>
        🔔{liste && liste.nonLues > 0 && <span className="compteur num">{liste.nonLues}</span>}
      </button>
      {ouvert && (
        <div className="panneau-notifs" role="region" aria-label="Notifications">
          {!liste?.elements.length ? <div className="vide">Aucune notification.</div> : liste.elements.map((n) => (
            <div key={n.id} className={"notif" + (n.lue ? "" : " non-lue")} onClick={() => lire(n)}>
              <b>{n.type === "security" ? "⚠ " : ""}{n.titre}</b>
              {n.texte && <p>{n.texte}</p>}
              <p className="num">{dateHeure(n.date)}{!n.lue && " · cliquer pour marquer comme lue"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

