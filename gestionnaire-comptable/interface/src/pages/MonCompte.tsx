import { useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { Champ, Chargement, dateHeure, messageErreur, useDonnees, useToast } from "../composants/ui";
import { ConfigurationMfa } from "./ConfigurationMfa";

interface SessionOuverte { id: string; creeLe: string; derniereActivite: string; expireLe: string; ip: string | null; agent: string | null; courante: boolean }

export function MonCompte() {
  const { moi } = useSession();
  const toast = useToast();
  const [ancien, setAncien] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [nouveau2, setNouveau2] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [mfa, setMfa] = useState(false);
  const sessions = useDonnees(() => api.get<SessionOuverte[]>("/api/auth/sessions"), []);

  const changer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    if (nouveau !== nouveau2) { setErreur("Les deux nouveaux mots de passe ne sont pas identiques."); return; }
    try {
      const r = await api.post<{ autresSessionsFermees: number }>("/api/auth/mot-de-passe", { ancien, nouveau });
      toast(`Mot de passe modifié${r.autresSessionsFermees ? ` ; ${r.autresSessionsFermees} autre(s) session(s) fermée(s)` : ""}.`);
      setAncien(""); setNouveau(""); setNouveau2(""); sessions.recharger();
    } catch (err) { setErreur(messageErreur(err)); }
  };
  const fermer = async (id: string) => {
    try { await api.del(`/api/auth/sessions/${id}`); toast("Session fermée."); sessions.recharger(); } catch (err) { toast(messageErreur(err), true); }
  };

  return (
    <>
      <div className="entete-page"><div><h2>Mon compte</h2><p>{moi.utilisateur.nom} · {moi.utilisateur.email}</p></div></div>
      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Changer mon mot de passe</h3><p>Vos autres sessions seront fermées</p></div></div>
          <form onSubmit={changer} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
            <Champ label="Mot de passe actuel" type="password" valeur={ancien} onChange={setAncien} requis autoComplete="current-password" />
            <Champ label="Nouveau mot de passe" type="password" valeur={nouveau} onChange={setNouveau} requis autoComplete="new-password" aide="12 caractères minimum, sans votre nom ni votre e-mail." />
            <Champ label="Confirmer le nouveau mot de passe" type="password" valeur={nouveau2} onChange={setNouveau2} requis autoComplete="new-password" />
            {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
            <div><button className="btn btn-principal">Modifier le mot de passe</button></div>
          </form>
        </section>
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Mes rôles et droits</h3><p>{moi.permissions.length} permission(s)</p></div></div>
          <div>{moi.roles.length ? moi.roles.map((r) => <span key={r.id} className="etiquette-role">{r.libelle}</span>) : <span className="discret">Aucun rôle</span>}</div>
          <h3 style={{ marginTop: 16 }}>Double authentification</h3>
          <p style={{ margin: "6px 0 10px" }}>{moi.mfa.active ? <span className="badge badge-vert">Activée</span> : <span className="badge badge-orange">Non activée</span>}{moi.mfa.requise && " · exigée par l'un de vos rôles"}</p>
          {!moi.mfa.active && !mfa && <button className="btn" onClick={() => setMfa(true)}>Activer la double authentification</button>}
        </section>
      </div>
      {mfa && <ConfigurationMfa onTermine={() => setMfa(false)} />}
      <section className="panneau">
        <div className="entete-panneau"><div><h3>Mes sessions ouvertes</h3><p>Fermez celles que vous ne reconnaissez pas, puis changez votre mot de passe</p></div></div>
        {!sessions.donnees ? <Chargement /> : (
          <div className="tableau-conteneur">
            <table>
              <thead><tr><th>Poste</th><th>Ouverte le</th><th>Dernière activité</th><th>Navigateur</th><th></th></tr></thead>
              <tbody>{sessions.donnees.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.ip ?? "—"}</td>
                  <td className="num">{dateHeure(s.creeLe)}</td>
                  <td className="num">{dateHeure(s.derniereActivite)}</td>
                  <td className="discret" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.agent ?? "—"}</td>
                  <td>{s.courante ? <span className="badge badge-vert">Cette session</span> : <button className="btn btn-petit" onClick={() => fermer(s.id)}>Fermer</button>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
