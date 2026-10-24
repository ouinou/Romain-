/**
 * Cadre de l'application, à la manière d'un logiciel de bureau (voir src/assets/reference/) :
 * barre de titre, barre d'accès rapide avec recherche, ruban à onglets, menu Fichier, menu latéral par module,
 * onglets des documents ouverts, zone de travail, panneau de détail rétractable et barre d'état.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EDITEUR, EmblemeFinexa, LogoFinexa, NOM_LOGICIEL, SLOGAN } from "../Marque";
import { api } from "../../api";
import { aller } from "../../routeur";
import { useSession } from "../../session";
import { dateHeure, useToast } from "../ui";
import { Icone } from "../../assets/icons/Icone";
import type { Notification } from "../../types";
import { autorise, moduleDe, MODULES, RUBAN, toutesCommandes, type Commande } from "./commandes";
import { useEtatCadre } from "./etat";

const sansAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const lireStockage = (cle: string) => { try { return localStorage.getItem(cle); } catch { return null; } };
const ecrireStockage = (cle: string, v: string) => { try { localStorage.setItem(cle, v); } catch { /* navigation privée */ } };

export interface Onglet { chemin: string; titre: string }

export function Cadre(props: {
  route: string; titre: string; page: ReactNode; logoUrl: string | null; cle: number;
  onActualiser: () => void; onglets: Onglet[]; onFermerOnglet: (chemin: string) => void;
}) {
  const { moi, a, deconnecter } = useSession();
  const [menuMobile, setMenuMobile] = useState(false);
  const [fichier, setFichier] = useState<null | "infos" | "sauvegardes" | "raccourcis" | "aide" | "a-propos">(null);
  const [ongletRuban, setOngletRuban] = useState(() => moduleDe(props.route));
  const [zoom, setZoom] = useState(() => Number(lireStockage("gc.zoom")) || 100);
  const recherche = useRef<HTMLInputElement>(null);
  useEffect(() => { setOngletRuban(moduleDe(props.route)); setMenuMobile(false); setFichier(null); }, [props.route]);
  useEffect(() => { ecrireStockage("gc.zoom", String(zoom)); }, [zoom]);

  const executer = useCallback((cmd: Commande) => {
    if (cmd.action === "imprimer") window.print();
    else if (cmd.action === "deconnexion") deconnecter();
    else if (cmd.action === "aide") setFichier("aide");
    else if (cmd.chemin) aller(cmd.chemin);
  }, [deconnecter]);

  // Raccourcis clavier, valables sur tous les écrans (seulement pour les commandes autorisées).
  useEffect(() => {
    const cmds = toutesCommandes(a).filter((x) => x.raccourci?.startsWith("Alt+"));
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); recherche.current?.focus(); recherche.current?.select(); return; }
      if (e.key === "F1") { e.preventDefault(); setFichier("aide"); return; }
      if (e.key === "Escape") setFichier(null);
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const cmd = cmds.find((x) => x.raccourci === `Alt+${e.key.toUpperCase()}`);
        if (cmd) { e.preventDefault(); executer(cmd); }
      }
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [a, executer]);

  const role = moi.roles.map((r) => r.libelle).join(", ") || "Aucun rôle";
  return (
    <div className={"app" + (menuMobile ? " menu-ouvert" : "")}>
      <header className="barre-titre">
        <button className="bouton-titre bouton-menu" aria-label="Ouvrir le menu" aria-expanded={menuMobile} onClick={() => setMenuMobile(!menuMobile)}><Icone nom="menu" taille={18} /></button>
        <EmblemeFinexa />
        <span className="nom-logiciel">{NOM_LOGICIEL}</span>
        <span className="separateur" aria-hidden="true" />
        {props.logoUrl && <img className="logo-entreprise" src={props.logoUrl} alt={`Logo de ${moi.entreprise.raisonSociale}`} />}
        <span className="nom-entreprise">{moi.entreprise.raisonSociale}</span>
        <span className="espace" />
        <Notifications />
        <button className="utilisateur" onClick={() => aller("/mon-compte")} title="Mon compte">
          <Icone nom="compte" taille={18} /><span className="nom-utilisateur">{moi.utilisateur.nom} ({role})</span>
        </button>
        <button className="bouton-titre" onClick={deconnecter}>Déconnexion</button>
      </header>

      <div className="barre-acces" role="toolbar" aria-label="Barre d'accès rapide">
        <button className="outil" title="Tableau de bord" aria-label="Tableau de bord" onClick={() => aller("/")}><Icone nom="accueil" taille={18} /></button>
        <button className="outil secondaire" title="Écran précédent" aria-label="Écran précédent" onClick={() => history.back()}><Icone nom="retour" taille={18} /></button>
        <button className="outil" title="Actualiser l'écran" aria-label="Actualiser l'écran" onClick={props.onActualiser}><Icone nom="actualiser" taille={18} /></button>
        <button className="outil secondaire" title="Imprimer la page (Ctrl+P)" aria-label="Imprimer la page" onClick={() => window.print()}><Icone nom="imprimer" taille={18} /></button>
        <span className="sep" aria-hidden="true" />
        <Recherche champ={recherche} />
      </div>

      <div className="ruban">
        <div className="ruban-onglets" role="tablist" aria-label="Ruban">
          <button className="onglet-fichier" aria-expanded={fichier !== null} onClick={() => setFichier(fichier ? null : "infos")}>Fichier</button>
          {MODULES.map((m) => (
            <button key={m.id} role="tab" aria-selected={ongletRuban === m.id} onClick={() => setOngletRuban(m.id)}>{m.libelle}</button>
          ))}
        </div>
        <Ruban module={ongletRuban} route={props.route} executer={executer} />
      </div>

      <div className="corps">
        <MenuLateral route={props.route} code={moi.entreprise.code} />
        <div className="espace-travail" onClick={() => menuMobile && setMenuMobile(false)}>
          <nav className="onglets-docs" aria-label="Documents ouverts">
            {props.onglets.map((o) => (
              <div key={o.chemin} className={"onglet-doc" + (o.chemin === props.route ? " actif" : "")}>
                <a href={"#" + o.chemin} aria-current={o.chemin === props.route ? "page" : undefined}>
                  {o.chemin === "/" && <Icone nom="accueil" taille={15} />}{o.titre}
                </a>
                {o.chemin !== "/" && <button aria-label={`Fermer ${o.titre}`} title="Fermer" onClick={() => props.onFermerOnglet(o.chemin)}><Icone nom="fermer" taille={12} /></button>}
              </div>
            ))}
          </nav>
          <div className="zone-travail">
            <main className="contenu" id="contenu" key={props.cle} style={zoom !== 100 ? { zoom: zoom / 100 } : undefined} onKeyDown={naviguerLignes}>{props.page}</main>
            <div id="emplacement-detail" />
          </div>
        </div>
      </div>

      <BarreEtat zoom={zoom} setZoom={setZoom} />
      {fichier && <MenuFichier vue={fichier} setVue={setFichier} />}
    </div>
  );
}

/** Flèches haut et bas pour passer d'une ligne de tableau à l'autre (lignes ouvrables par Entrée). */
function naviguerLignes(e: React.KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t.tagName !== "TR" || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  const voisin = (e.key === "ArrowDown" ? t.nextElementSibling : t.previousElementSibling) as HTMLElement | null;
  if (voisin?.tabIndex === 0) { e.preventDefault(); voisin.focus(); }
}

function Ruban({ module, route, executer }: { module: string; route: string; executer: (c: Commande) => void }) {
  const { a } = useSession();
  const groupes = (RUBAN[module] ?? []).map((g) => ({ ...g, commandes: g.commandes.filter((x) => autorise(a, x.permission)) })).filter((g) => g.commandes.length);
  return (
    <div className="ruban-panneau" role="toolbar" aria-label="Commandes">
      {!groupes.length && <span className="ruban-vide">Aucune commande disponible avec vos droits dans cet onglet.</span>}
      {groupes.map((g) => (
        <div className="groupe-ruban" key={g.nom} role="group" aria-label={g.nom}>
          <div className="commandes">
            {g.commandes.map((cmd) => {
              const titre = cmd.raccourci ? `${cmd.libelle} (${cmd.raccourci})` : cmd.libelle;
              const contenu = <><Icone nom={cmd.icone} taille={26} /><span>{cmd.libelle}</span>{cmd.raccourci && <span className="raccourci">{cmd.raccourci}</span>}</>;
              return cmd.chemin
                ? <a key={cmd.id} className="commande" href={"#" + cmd.chemin} title={titre} aria-current={cmd.chemin === route ? "page" : undefined}
                    onClick={(e) => { e.preventDefault(); executer(cmd); }}>{contenu}</a>
                : <button key={cmd.id} className="commande" title={titre} onClick={() => executer(cmd)}>{contenu}</button>;
            })}
          </div>
          <div className="nom-groupe">{g.nom}</div>
        </div>
      ))}
    </div>
  );
}

function MenuLateral({ route, code }: { route: string; code: string }) {
  const { a } = useSession();
  const courant = moduleDe(route);
  const [ouverts, setOuverts] = useState<Set<string>>(() => new Set([courant]));
  useEffect(() => { setOuverts((o) => new Set(o).add(courant)); }, [courant]);
  // Entrée active : la plus longue qui préfixe la route (ex. /comptabilite/ecritures/… → Écritures).
  const actif = MODULES.flatMap((m) => m.entrees.map((e) => e.chemin)).filter((c) => c === "/" ? route === "/" : route === c || route.startsWith(c + "/"))
    .sort((x, y) => y.length - x.length)[0] ?? "/";
  return (
    <aside className="laterale" aria-label="Menu latéral">
      <nav className="nav" aria-label="Navigation principale">
        {MODULES.map((m) => {
          const entrees = m.entrees.filter((e) => autorise(a, e.permission));
          if (!entrees.length) return null;
          const ouvert = ouverts.has(m.id);
          return (
            <div key={m.id} className={"module-nav" + (courant === m.id ? " actif" : "")}>
              <button aria-expanded={ouvert} onClick={() => setOuverts((o) => { const n = new Set(o); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}>
                <Icone nom={m.icone} taille={20} />{m.libelle}<Icone nom="chevron" taille={14} className="chevron" />
              </button>
              <ul hidden={!ouvert}>
                {entrees.map((e) => (
                  <li key={e.chemin}><a href={"#" + e.chemin} data-groupe={m.libelle} aria-current={actif === e.chemin ? "page" : undefined}>{e.libelle}</a></li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="bas">Espace {code}<br />Réseau local</div>
    </aside>
  );
}

/** Recherche : écrans et commandes accessibles, factures et mouvements par leur numéro. */
function Recherche({ champ }: { champ: React.RefObject<HTMLInputElement> }) {
  const { a } = useSession();
  const [texte, setTexte] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState(0);
  const resultats = useMemo(() => {
    const t = sansAccents(texte.trim());
    if (!t) return [];
    const r: { libelle: string; detail: string; chemin: string }[] = [];
    if (a("sales.read")) r.push({ libelle: `Factures contenant « ${texte.trim()} »`, detail: "Ventes", chemin: `/ventes?recherche=${encodeURIComponent(texte.trim())}` });
    if (a("treasury.read") || a("cash.read")) r.push({ libelle: `Mouvements contenant « ${texte.trim()} »`, detail: "Trésorerie", chemin: `/tresorerie/mouvements?recherche=${encodeURIComponent(texte.trim())}` });
    const ecrans = MODULES.flatMap((m) => m.entrees.filter((e) => autorise(a, e.permission)).map((e) => ({ libelle: e.libelle, detail: m.libelle, chemin: e.chemin })));
    const cmds = toutesCommandes(a).filter((x) => x.chemin).map((x) => ({ libelle: x.libelle, detail: x.raccourci ? `Commande · ${x.raccourci}` : "Commande", chemin: x.chemin! }));
    const vus = new Set<string>();
    const trouves = [...ecrans, ...cmds].filter((x) => sansAccents(x.libelle).includes(t) && !vus.has(x.libelle) && vus.add(x.libelle));
    return [...trouves, ...r].slice(0, 9);
  }, [texte, a]);
  const valider = (i: number) => { const r = resultats[i]; if (r) { aller(r.chemin); setTexte(""); setOuvert(false); champ.current?.blur(); } };
  return (
    <div className="recherche" role="search">
      <Icone nom="recherche" taille={16} />
      <input ref={champ} value={texte} placeholder="Rechercher (Ctrl+F) : écran, commande, n° de facture…" aria-label="Rechercher"
        role="combobox" aria-expanded={ouvert && resultats.length > 0} aria-controls="resultats-recherche" aria-autocomplete="list"
        onChange={(e) => { setTexte(e.target.value); setOuvert(true); setChoix(0); }}
        onFocus={() => setOuvert(true)} onBlur={() => setTimeout(() => setOuvert(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setChoix((c) => Math.min(c + 1, resultats.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setChoix((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); valider(choix); }
          else if (e.key === "Escape") { setTexte(""); champ.current?.blur(); }
        }} />
      {ouvert && resultats.length > 0 && (
        <ul id="resultats-recherche" role="listbox" aria-label="Résultats">
          {resultats.map((r, i) => (
            <li key={r.chemin + r.libelle} role="option" aria-selected={i === choix}>
              <button aria-selected={i === choix} onMouseDown={(e) => e.preventDefault()} onClick={() => valider(i)}>{r.libelle}<small>{r.detail}</small></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BarreEtat({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const { moi, a } = useSession();
  const { somme } = useEtatCadre();
  const [connecte, setConnecte] = useState(true);
  const [exercice, setExercice] = useState<string | null>(null);
  const [brouillards, setBrouillards] = useState<number | null>(null);
  useEffect(() => {
    // État du serveur : /api/sante ne demande pas de session et ne la prolonge pas.
    const verifier = () => api.getAuto("/api/sante").then(() => setConnecte(true)).catch((e: { statut?: number }) => setConnecte((e.statut ?? 0) > 0));
    verifier();
    const t = setInterval(verifier, 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!a("accounting.read")) return;
    api.get<{ code: string; statut: string }[]>("/api/comptabilite/exercices").then((l) => setExercice(l.find((x) => x.statut === "ouvert")?.code ?? null)).catch(() => {});
    const compter = (auto: boolean) => (auto ? api.getAuto : api.get)<{ total: number }>("/api/comptabilite/ecritures?statut=brouillard&taille=1")
      .then((r) => setBrouillards(r.total)).catch(() => {});
    compter(false);
    const t = setInterval(() => compter(true), 60_000);
    return () => clearInterval(t);
  }, [a]);
  const role = moi.roles.map((r) => r.libelle).join(", ") || "Aucun rôle";
  return (
    <footer className="barre-etat" aria-label="Barre d'état">
      <span>{moi.entreprise.raisonSociale}</span>
      {exercice && <span className="facultatif"><Icone nom="calendrier" taille={14} />Exercice {exercice}</span>}
      <span className="facultatif"><Icone nom="compte" taille={14} />{moi.utilisateur.nom} · {role}</span>
      <span role="status"><span className={"pastille-etat" + (connecte ? "" : " coupe")} aria-hidden="true" />{connecte ? "Connecté au serveur" : "Serveur injoignable"}</span>
      {brouillards !== null && brouillards > 0 && (
        <span className="facultatif"><a href="#/comptabilite/ecritures?statut=brouillard"><Icone nom="alerte" taille={14} />{brouillards} brouillard{brouillards > 1 ? "s" : ""} à valider</a></span>
      )}
      <span className="pousse facultatif">{somme ? `Somme sélectionnée : ${somme}` : new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
      <span className="zoom facultatif">
        <button aria-label="Réduire l'affichage" onClick={() => setZoom(Math.max(80, zoom - 10))}>−</button>
        <span className="num">{zoom} %</span>
        <button aria-label="Agrandir l'affichage" onClick={() => setZoom(Math.min(150, zoom + 10))}>+</button>
      </span>
    </footer>
  );
}

function MenuFichier({ vue, setVue }: { vue: "infos" | "sauvegardes" | "raccourcis" | "aide" | "a-propos"; setVue: (v: null | "infos" | "sauvegardes" | "raccourcis" | "aide" | "a-propos") => void }) {
  const { moi, a, deconnecter } = useSession();
  const tuile = (chemin: string, icone: string, titre: string, texte: string) =>
    <a className="tuile" href={"#" + chemin} onClick={() => setVue(null)}><Icone nom={icone} taille={28} /><div><b>{titre}</b><span>{texte}</span></div></a>;
  const raccourcis = toutesCommandes(a).filter((x) => x.raccourci);
  return (
    <div className="menu-fichier" role="dialog" aria-modal="true" aria-label="Menu Fichier">
      <nav aria-label="Menu Fichier">
        <button className="retour" onClick={() => setVue(null)}><Icone nom="retour" taille={18} />Retour</button>
        <button aria-current={vue === "infos"} onClick={() => setVue("infos")}><Icone nom="entreprise" taille={18} />Informations</button>
        <button aria-current={vue === "sauvegardes"} onClick={() => setVue("sauvegardes")}><Icone nom="sauvegarde" taille={18} />Sauvegardes</button>
        <button aria-current={vue === "raccourcis"} onClick={() => setVue("raccourcis")}><Icone nom="parametres" taille={18} />Raccourcis clavier</button>
        <button aria-current={vue === "aide"} onClick={() => setVue("aide")}><Icone nom="aide" taille={18} />Aide</button>
        <button aria-current={vue === "a-propos"} onClick={() => setVue("a-propos")}><Icone nom="entreprise" taille={18} />À propos de {NOM_LOGICIEL}</button>
        <button onClick={deconnecter}><Icone nom="quitter" taille={18} />Déconnexion</button>
      </nav>
      <section>
        {vue === "infos" && <>
          <h2>{moi.entreprise.raisonSociale}</h2>
          <p style={{ marginTop: -6 }}>Espace <b>{moi.entreprise.code}</b> · {moi.entreprise.pays} · devise {moi.entreprise.devise === "XAF" ? "FCFA (XAF)" : moi.entreprise.devise}</p>
          <div className="tuiles">
            {a("company.read") && tuile("/entreprise", "entreprise", "Profil de l'entreprise", "Identité, NIU, RCCM, logo et couleurs")}
            {a("accounting.read") && tuile("/comptabilite/parametres", "calendrier", "Exercice comptable", "Exercices, clôture, paramètres comptables et fiscaux")}
            {a("users.read") && tuile("/utilisateurs", "utilisateurs", "Utilisateurs", "Comptes, rôles et accès")}
            {tuile("/mon-compte", "compte", "Mon compte", "Mot de passe, double authentification, sessions")}
          </div>
        </>}
        {vue === "sauvegardes" && <>
          <h2>Sauvegardes</h2>
          <div style={{ maxWidth: 720, display: "grid", gap: 10 }}>
            <p style={{ margin: 0 }}>Sur le serveur installé par le setup, une sauvegarde chiffrée de toute la base est faite <b>chaque soir à 20 h</b>, suivie d'un contrôle d'intégrité du journal d'audit à 20 h 30.</p>
            <p style={{ margin: 0 }}>Elles se trouvent dans <span className="mono">C:\ProgramData\GestionnaireComptable\sauvegardes</span>. Copiez-les régulièrement sur un support séparé (disque externe, NAS), et conservez la clé de sauvegarde hors du serveur : sans elle, une sauvegarde est illisible.</p>
            <div className="alerte">La restauration se fait sur le serveur par l'administrateur technique (voir le guide d'installation). Elle n'est pas proposée depuis cet écran, pour qu'aucun utilisateur ne puisse remplacer les données par erreur.</div>
          </div>
        </>}
        {vue === "raccourcis" && <>
          <h2>Raccourcis clavier</h2>
          <div className="tableau-conteneur" style={{ maxWidth: 560 }}>
            <table>
              <thead><tr><th>Touches</th><th>Action</th></tr></thead>
              <tbody>
                <tr><td className="num"><b>Ctrl+F</b></td><td>Rechercher un écran, une commande, une facture</td></tr>
                <tr><td className="num"><b>F1</b></td><td>Aide</td></tr>
                <tr><td className="num"><b>Échap</b></td><td>Fermer le menu Fichier ou le panneau de détail</td></tr>
                <tr><td className="num"><b>↑ ↓ puis Entrée</b></td><td>Parcourir les lignes d'un tableau et ouvrir la ligne choisie</td></tr>
                <tr><td className="num"><b>F9</b></td><td>Écritures : valider la sélection</td></tr>
                {raccourcis.map((r) => <tr key={r.id}><td className="num"><b>{r.raccourci}</b></td><td>{r.libelle}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>}
        {vue === "aide" && <>
          <h2>Aide</h2>
          <div style={{ maxWidth: 760, display: "grid", gap: 10 }}>
            <p style={{ margin: 0 }}>Le <b>ruban</b> regroupe les commandes par onglet ; seules celles que votre rôle autorise apparaissent. Le <b>menu latéral</b> donne accès à tous les écrans du module. Chaque écran ouvert reste disponible dans les <b>onglets</b> au-dessus de la zone de travail.</p>
            <p style={{ margin: 0 }}>Une facture émise, un mouvement de caisse ou une écriture validée ne se modifient pas : ils se corrigent par une opération inverse, motivée et tracée.</p>
            <p style={{ margin: 0 }}>Le guide complet (« Guide d'utilisation ») est installé avec le logiciel et accessible depuis le menu Démarrer de Windows, dossier « {NOM_LOGICIEL} ».</p>
            <p style={{ margin: 0 }}>Un problème d'accès : adressez-vous à l'administrateur de votre entreprise. Mot de passe oublié : il vous remettra un code de réinitialisation.</p>
          </div>
        </>}
        {vue === "a-propos" && <APropos />}
      </section>
    </div>
  );
}

function Notifications() {
  const [ouvert, setOuvert] = useState(false);
  const [liste, setListe] = useState<{ elements: Notification[]; nonLues: number } | null>(null);
  const toast = useToast();
  const charger = useCallback((auto = false) => (auto ? api.getAuto("/api/notifications?taille=20") : api.get("/api/notifications?taille=20")).then(setListe).catch(() => {}), []);
  useEffect(() => { charger(); const t = setInterval(() => charger(true), 60_000); return () => clearInterval(t); }, [charger]);
  const lire = async (n: Notification) => {
    if (n.lue) return;
    try { await api.post(`/api/notifications/${n.id}/lecture`); charger(); } catch { toast("Impossible de marquer la notification comme lue.", true); }
  };
  return (
    <div className="cloche">
      <button className="bouton-titre" aria-expanded={ouvert} aria-label={`Notifications${liste?.nonLues ? `, ${liste.nonLues} non lues` : ""}`} title="Notifications" onClick={() => setOuvert(!ouvert)}>
        <Icone nom="cloche" taille={18} />{liste && liste.nonLues > 0 && <span className="compteur num">{liste.nonLues}</span>}
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

/** « À propos » : le produit FINEXA ERP ; l'éditeur ITI y figure, discrètement, avec les mentions légales. */
function APropos() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => { api.getAuto<{ version: string }>("/api/sante").then((r) => setVersion(r.version)).catch(() => {}); }, []);
  return (
    <>
      <h2>À propos de {NOM_LOGICIEL}</h2>
      <div className="a-propos">
        <LogoFinexa largeur={220} />
        <div style={{ display: "grid", gap: 6 }}>
          <p style={{ margin: 0 }}><b>{NOM_LOGICIEL}</b>{version && <> · version {version}</>}</p>
          <p style={{ margin: 0 }}>Gestion intégrée des entreprises de l'espace OHADA.</p>
          <p style={{ margin: 0 }} className="discret">{SLOGAN}</p>
          <p style={{ margin: 0 }} className="discret">Édité par {EDITEUR}.</p>
          <p style={{ margin: 0 }} className="discret">Composants tiers et licences : fichier LICENCES.txt du dossier d'installation.</p>
        </div>
      </div>
    </>
  );
}
