import { useState } from "react";
import { api, qs } from "../api";
import { useSession } from "../session";
import { Champ, Chargement, Modale, Pagination, SecretUnique, date, dateHeure, initiales, messageErreur, useDonnees, useToast } from "../composants/ui";
import { ConfirmerAction } from "../composants/Confirmations";
import { RESULTATS, libelleAction } from "../libelles";
import { badgeStatut } from "./Utilisateurs";
import type { Role, Utilisateur } from "../types";

type Action = null | "modifier" | "roles" | "desactiver" | "reactiver" | "deverrouiller" | "reinitialiser" | "invitation" | "sessions";

export function FicheUtilisateur({ id }: { id: string }) {
  const { moi, a } = useSession();
  const toast = useToast();
  const [action, setAction] = useState<Action>(null);
  const [secret, setSecret] = useState<{ titre: string; jeton: string; expireLe: string; texte: string } | null>(null);
  const [pageCx, setPageCx] = useState(1);
  const u = useDonnees(() => api.get<Utilisateur>(`/api/utilisateurs/${id}`), [id]);
  const cx = useDonnees(() => api.get<{ elements: { date: string; type: string; action: string; resultat: string; ip: string | null; raison: string | null }[]; total: number; page: number; taille: number }>(`/api/utilisateurs/${id}/connexions${qs({ page: pageCx, taille: 10 })}`), [id, pageCx]);

  if (u.erreur) return <div className="alerte alerte-erreur">{u.erreur} <a href="#/utilisateurs">Retour à la liste</a></div>;
  if (!u.donnees) return <Chargement />;
  const util = u.donnees;
  const soiMeme = util.id === moi.utilisateur.id;
  const fin = (msg: string) => { toast(msg); u.recharger(); cx.recharger(); };
  const admin = a("users.admin") && !soiMeme;

  return (
    <>
      <div><a href="#/utilisateurs" className="btn-lien">← Tous les utilisateurs</a></div>
      <div className="entete-page">
        <div className="personne">
          <div className="avatar" aria-hidden="true" style={{ width: 46, height: 46, fontSize: 15 }}>{initiales(util.nom)}</div>
          <div><h2>{util.nom}</h2><p className="infos">{util.email}</p></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {a("users.update") && <button className="btn" onClick={() => setAction("modifier")}>Modifier</button>}
          {admin && <button className="btn" onClick={() => setAction("roles")}>Rôles</button>}
          {admin && util.statut === "active" && <button className="btn" onClick={() => setAction("reinitialiser")}>Réinitialiser le mot de passe</button>}
          {a("users.create") && util.statut === "invited" && <button className="btn" onClick={() => setAction("invitation")}>Nouveau code d'invitation</button>}
          {admin && util.verrouille && <button className="btn" onClick={() => setAction("deverrouiller")}>Déverrouiller</button>}
          {admin && <button className="btn" onClick={() => setAction("sessions")}>Fermer ses sessions</button>}
          {admin && util.statut !== "disabled" && <button className="btn btn-danger" onClick={() => setAction("desactiver")}>Désactiver</button>}
          {admin && util.statut === "disabled" && <button className="btn btn-principal" onClick={() => setAction("reactiver")}>Réactiver</button>}
        </div>
      </div>
      {soiMeme && <div className="alerte">C'est votre propre compte : pour éviter toute auto-attribution, vos rôles et votre statut ne peuvent être changés que par un autre administrateur.</div>}

      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><h3>Compte</h3></div>
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, auto) 1fr", gap: "8px 16px", margin: 0 }}>
            <dt className="discret">Statut</dt><dd style={{ margin: 0 }}>{badgeStatut(util)}</dd>
            <dt className="discret">Rôles</dt><dd style={{ margin: 0 }}>{util.roles.length ? util.roles.map((r) => <span key={r.id} className="etiquette-role">{r.libelle}</span>) : "Aucun"}</dd>
            <dt className="discret">Double auth.</dt><dd style={{ margin: 0 }}>{util.mfaActive ? "Activée" : "Non activée"}</dd>
            <dt className="discret">Fin d'accès</dt><dd style={{ margin: 0 }}>{util.accesExpireLe ? date(util.accesExpireLe) : "Aucune"}</dd>
            <dt className="discret">Dernière connexion</dt><dd style={{ margin: 0 }} className="num">{util.derniereConnexion ? dateHeure(util.derniereConnexion) : "Jamais"}</dd>
            <dt className="discret">Créé le</dt><dd style={{ margin: 0 }} className="num">{dateHeure(util.creeLe)}</dd>
          </dl>
        </section>
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Historique des connexions</h3><p>Réussites, échecs et refus</p></div></div>
          {cx.erreur ? <div className="alerte alerte-erreur">{cx.erreur}</div> : !cx.donnees ? <Chargement /> : cx.donnees.elements.length === 0 ? <div className="vide">Aucune connexion enregistrée.</div> : (
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>Date</th><th>Événement</th><th>Résultat</th><th>Poste</th></tr></thead>
                <tbody>{cx.donnees.elements.map((c, i) => (
                  <tr key={i}>
                    <td className="num">{dateHeure(c.date)}</td>
                    <td>{libelleAction(c.type, c.action)}{c.raison ? <span className="discret"> · {c.raison.replaceAll("_", " ")}</span> : null}</td>
                    <td><span className={"badge " + (c.resultat === "success" ? "badge-vert" : "badge-rouge")}>{RESULTATS[c.resultat]}</span></td>
                    <td className="mono">{c.ip ?? "—"}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}
          {cx.donnees && cx.donnees.total > 10 && <Pagination page={pageCx} taille={10} total={cx.donnees.total} onPage={setPageCx} />}
        </section>
      </div>

      {action === "modifier" && <Modification util={util} onFermer={() => setAction(null)} onFin={() => fin("Compte mis à jour.")} />}
      {action === "roles" && <ChoixRoles util={util} onFermer={() => setAction(null)} onFin={() => fin("Rôles mis à jour.")} />}
      {action === "desactiver" && <ConfirmerAction titre={`Désactiver ${util.nom} ?`} danger motif libelle="Désactiver le compte"
        texte={<>La personne ne pourra plus se connecter et ses sessions ouvertes seront fermées immédiatement. Le compte et son historique sont conservés.</>}
        onValider={async (motif) => { await api.post(`/api/utilisateurs/${id}/desactivation`, { motif }); fin("Compte désactivé."); }} onFermer={() => setAction(null)} />}
      {action === "reactiver" && <ConfirmerAction titre={`Réactiver ${util.nom} ?`} motif libelle="Réactiver"
        texte="La personne pourra de nouveau se connecter avec ses rôles actuels."
        onValider={async (motif) => { await api.post(`/api/utilisateurs/${id}/reactivation`, { motif }); fin("Compte réactivé."); }} onFermer={() => setAction(null)} />}
      {action === "deverrouiller" && <ConfirmerAction titre="Déverrouiller le compte ?" libelle="Déverrouiller"
        texte="Le compte a été bloqué après plusieurs échecs de connexion. Vérifiez auprès de la personne qu'il s'agissait bien d'elle."
        onValider={async () => { await api.post(`/api/utilisateurs/${id}/deverrouillage`); fin("Compte déverrouillé."); }} onFermer={() => setAction(null)} />}
      {action === "sessions" && <ConfirmerAction titre="Fermer toutes ses sessions ?" motif libelle="Fermer les sessions"
        texte="La personne sera déconnectée de tous ses postes. À utiliser en cas de doute (poste partagé, appareil perdu)."
        onValider={async (motif) => { const r = await api.post<{ sessionsFermees: number }>(`/api/utilisateurs/${id}/revocation-sessions`, { motif }); fin(`${r.sessionsFermees} session(s) fermée(s).`); }} onFermer={() => setAction(null)} />}
      {action === "reinitialiser" && <ConfirmerAction titre="Réinitialiser le mot de passe ?" motif libelle="Générer un code"
        texte="Un code à usage unique, valable 30 minutes, va être généré. Remettez-le en main propre : la personne choisira elle-même son nouveau mot de passe."
        onValider={async (motif) => {
          const r = await api.post<{ reinitialisation: { jeton: string; expireLe: string } }>(`/api/utilisateurs/${id}/reinitialisation-mot-de-passe`, { motif });
          setSecret({ titre: "Code de réinitialisation", texte: "Valable 30 minutes, une seule fois.", ...r.reinitialisation }); u.recharger();
        }} onFermer={() => setAction(null)} />}
      {action === "invitation" && <ConfirmerAction titre="Générer un nouveau code d'invitation ?" libelle="Générer"
        texte="L'ancien code d'invitation ne fonctionnera plus."
        onValider={async () => {
          const r = await api.post<{ invitation: { jeton: string; expireLe: string } }>(`/api/utilisateurs/${id}/invitation`);
          setSecret({ titre: "Nouveau code d'invitation", texte: "Valable 72 heures, une seule fois.", ...r.invitation });
        }} onFermer={() => setAction(null)} />}
      {secret && (
        <Modale titre={secret.titre} onFermer={() => setSecret(null)}>
          <SecretUnique valeur={secret.jeton} explication={<>{secret.texte} Ce code ne sera plus affiché. Expire le {dateHeure(secret.expireLe)}.</>} />
          <div className="actions-form"><button className="btn btn-principal" onClick={() => setSecret(null)}>J'ai remis le code</button></div>
        </Modale>
      )}
    </>
  );
}

function Modification({ util, onFermer, onFin }: { util: Utilisateur; onFermer: () => void; onFin: () => void }) {
  const [nom, setNom] = useState(util.nom);
  const [fin, setFin] = useState(util.accesExpireLe ? util.accesExpireLe.slice(0, 10) : "");
  const [erreur, setErreur] = useState<string | null>(null);
  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    const finIso = fin ? new Date(fin + "T23:59:59").toISOString() : null;
    const corps: Record<string, unknown> = { nom };
    if ((util.accesExpireLe?.slice(0, 10) ?? "") !== fin) corps.accesExpireLe = finIso;
    try { await api.patch(`/api/utilisateurs/${util.id}`, corps); onFin(); onFermer(); } catch (err) { setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre="Modifier le compte" onFermer={onFermer}>
      <form onSubmit={soumettre} style={{ display: "grid", gap: 12 }}>
        <Champ label="Nom complet" valeur={nom} onChange={setNom} requis />
        <Champ label="Fin d'accès" type="date" valeur={fin} onChange={setFin} aide="Laisser vide pour un accès sans date de fin." />
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal">Enregistrer</button></div>
      </form>
    </Modale>
  );
}

function ChoixRoles({ util, onFermer, onFin }: { util: Utilisateur; onFermer: () => void; onFin: () => void }) {
  const roles = useDonnees(() => api.get<Role[]>("/api/roles"), []);
  const [choix, setChoix] = useState(util.roles.map((r) => r.id));
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    if (motif.trim().length < 3) { setErreur("Indiquez un motif (3 caractères minimum)."); return; }
    setEnvoi(true); setErreur(null);
    try { await api.put(`/api/utilisateurs/${util.id}/roles`, { roles: choix, motif }); onFin(); onFermer(); }
    catch (err) { setErreur(messageErreur(err)); } finally { setEnvoi(false); }
  };
  return (
    <Modale titre={`Rôles de ${util.nom}`} onFermer={onFermer}>
      {!roles.donnees ? <Chargement /> : (
        <form onSubmit={soumettre} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {roles.donnees.map((r) => (
              <label key={r.id} className="case">
                <input type="checkbox" checked={choix.includes(r.id)} onChange={(e) => setChoix(e.target.checked ? [...choix, r.id] : choix.filter((x) => x !== r.id))} />
                <span><b>{r.libelle}</b>{r.systeme ? "" : " (personnalisé)"}<br /><span className="discret">{r.description ?? `${r.permissions.length} permission(s)`}</span></span>
              </label>
            ))}
          </div>
          <Champ label="Motif *" valeur={motif} onChange={setMotif} aide="Conservé dans le journal d'audit avec la liste avant/après." />
          {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
          <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal" disabled={envoi}>Enregistrer</button></div>
        </form>
      )}
    </Modale>
  );
}
