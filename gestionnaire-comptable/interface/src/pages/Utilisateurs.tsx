import { FicheAcces } from "../composants/FicheAcces";
import { useEffect, useState } from "react";
import { api, qs } from "../api";
import { useSession } from "../session";
import { aller, effacerParametres, useParametres } from "../routeur";
import { STATUTS } from "../libelles";
import { Champ, Chargement, Modale, Pagination, dateHeure, initiales, messageErreur, useDonnees, useRetarde, useToast } from "../composants/ui";
import type { Page, Role, Utilisateur } from "../types";

export const badgeStatut = (u: Pick<Utilisateur, "statut" | "verrouille">) =>
  u.verrouille ? <span className="badge badge-rouge">Verrouillé</span>
    : <span className={"badge " + (u.statut === "active" ? "badge-vert" : u.statut === "invited" ? "badge-orange" : "badge-rouge")}>{STATUTS[u.statut]}</span>;

export function Utilisateurs() {
  const { a } = useSession();
  const [recherche, setRecherche] = useState("");
  const [statut, setStatut] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [creation, setCreation] = useState(false);
  // Commande « Nouvel utilisateur » du ruban : #/utilisateurs?nouveau=1.
  const params = useParametres();
  useEffect(() => { if (params.get("nouveau") && a("users.create")) { setCreation(true); effacerParametres(); } }, [params, a]);
  const rech = useRetarde(recherche);

  const roles = useDonnees(() => (a("roles.read") ? api.get<Role[]>("/api/roles") : Promise.resolve([] as Role[])), []);
  const liste = useDonnees(() => api.get<Page<Utilisateur>>(`/api/utilisateurs${qs({ recherche: rech, statut, role, page, taille: 20 })}`), [rech, statut, role, page]);

  return (
    <>
      <div className="entete-page">
        <div><h2>Utilisateurs</h2><p>Un compte par personne. Les droits dépendent des rôles attribués ; chaque changement est conservé dans le journal d'audit.</p></div>
        {a("users.create") && <button className="btn btn-principal" onClick={() => setCreation(true)}>+ Ajouter un utilisateur</button>}
      </div>
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="f-rech">Rechercher</label>
          <input id="f-rech" className="filtre" type="search" placeholder="Rechercher un nom ou un e-mail…" value={recherche} onChange={(e) => { setRecherche(e.target.value); setPage(1); }} />
          <label className="cache-visuel" htmlFor="f-statut">Statut</label>
          <select id="f-statut" className="filtre" value={statut} onChange={(e) => { setStatut(e.target.value); setPage(1); }}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {!!roles.donnees?.length && <>
            <label className="cache-visuel" htmlFor="f-role">Rôle</label>
            <select id="f-role" className="filtre" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
              <option value="">Tous les rôles</option>
              {roles.donnees.map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)}
            </select>
          </>}
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>Personne</th><th>Rôles</th><th>Statut</th><th>Double auth.</th><th>Dernière connexion</th></tr></thead>
                <tbody>
                  {liste.donnees.elements.length === 0 && <tr><td colSpan={5} className="vide">Aucun utilisateur ne correspond à ces critères.</td></tr>}
                  {liste.donnees.elements.map((u) => (
                    <tr key={u.id} className="cliquable" tabIndex={0} onClick={() => aller(`/utilisateurs/${u.id}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/utilisateurs/${u.id}`)}>
                      <td><div className="personne"><div className="avatar" aria-hidden="true">{initiales(u.nom)}</div><div><b>{u.nom}</b><small>{u.email}</small></div></div></td>
                      <td>{u.roles.length ? u.roles.map((r) => <span key={r.id} className="etiquette-role">{r.libelle}</span>) : <span className="discret">Aucun</span>}</td>
                      <td>{badgeStatut(u)}</td>
                      <td>{u.mfaActive ? <span className="badge badge-vert">Active</span> : <span className="badge badge-neutre">Non</span>}</td>
                      <td className="num">{u.derniereConnexion ? dateHeure(u.derniereConnexion) : <span className="discret">Jamais</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} />
          </>
        )}
      </section>
      {creation && <CreationUtilisateur roles={roles.donnees ?? []} onFermer={() => setCreation(false)} onCree={liste.recharger} />}
    </>
  );
}

function CreationUtilisateur({ roles, onFermer, onCree }: { roles: Role[]; onFermer: () => void; onCree: () => void }) {
  const { a } = useSession();
  const toast = useToast();
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [choix, setChoix] = useState<string[]>([]);
  const [fin, setFin] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<{ nom: string; email: string; jeton: string; expireLe: string } | null>(null);
  const peutRoles = a("users.admin") && roles.length > 0;

  const creer = async (e: React.FormEvent) => {
    e.preventDefault(); setEnvoi(true); setErreur(null);
    try {
      const r = await api.post<{ utilisateur: Utilisateur; invitation: { jeton: string; expireLe: string } }>("/api/utilisateurs",
        { nom, email, roles: peutRoles ? choix : [], accesExpireLe: fin ? new Date(fin + "T23:59:59").toISOString() : null });
      setResultat({ nom: r.utilisateur.nom, email: r.utilisateur.email, ...r.invitation });
      toast("Compte créé.");
      onCree();
    } catch (err) { setErreur(messageErreur(err)); }
    finally { setEnvoi(false); }
  };

  if (resultat) return (
    <Modale titre={`Fiche d'accès de ${resultat.nom}`} onFermer={onFermer} large>
      <FicheAcces nom={resultat.nom} email={resultat.email} jeton={resultat.jeton} expireLe={resultat.expireLe} type="invitation" />
      <div className="actions-form"><button className="btn btn-principal" onClick={onFermer}>J'ai remis le code</button></div>
    </Modale>
  );

  return (
    <Modale titre="Ajouter un utilisateur" onFermer={onFermer}>
      <form onSubmit={creer} style={{ display: "grid", gap: 14 }}>
        <div className="grille-champs">
          <Champ label="Nom complet" valeur={nom} onChange={setNom} requis autoFocus />
          <Champ label="Adresse e-mail professionnelle" type="email" valeur={email} onChange={setEmail} requis />
        </div>
        <Champ label="Fin d'accès (facultatif)" type="date" valeur={fin} onChange={setFin} aide="Pour un stagiaire, un auditeur externe ou un contrat temporaire." />
        {peutRoles ? (
          <fieldset className="champ" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="etiquette" style={{ marginBottom: 6 }}>Rôles</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
              {roles.map((r) => (
                <label key={r.id} className="case">
                  <input type="checkbox" checked={choix.includes(r.id)} onChange={(e) => setChoix(e.target.checked ? [...choix, r.id] : choix.filter((x) => x !== r.id))} />
                  <span>{r.libelle}{r.mfaRequise && <span className="discret"> · double auth.</span>}</span>
                </label>
              ))}
            </div>
            <span className="aide">Attribuer des rôles demande une confirmation par mot de passe.</span>
          </fieldset>
        ) : <div className="alerte">Le compte sera créé sans rôle. Un administrateur devra lui en attribuer.</div>}
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form">
          <button type="button" className="btn" onClick={onFermer}>Annuler</button>
          <button className="btn btn-principal" disabled={envoi}>{envoi ? "Création…" : "Créer et générer l'invitation"}</button>
        </div>
      </form>
    </Modale>
  );
}
