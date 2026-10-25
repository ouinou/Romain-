import { useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { aller } from "../routeur";
import { Champ, Chargement, Modale, Selection, messageErreur, useDonnees, useToast } from "../composants/ui";
import type { Role } from "../types";

export function Roles() {
  const { a } = useSession();
  const [archives, setArchives] = useState(false);
  const [creation, setCreation] = useState(false);
  const roles = useDonnees(() => api.get<Role[]>(`/api/roles${archives ? "?archives=oui" : ""}`), [archives]);
  return (
    <>
      <div className="entete-page">
        <div><h2>Rôles et permissions</h2><p>Chaque rôle est une liste de permissions « module × action ». Les rôles système servent de modèles et ne se modifient pas ; créez un rôle personnalisé pour les adapter.</p></div>
        {a("roles.create") && <button className="btn btn-principal" onClick={() => setCreation(true)}>+ Créer un rôle</button>}
      </div>
      <section className="panneau">
        <div className="entete-panneau">
          <h3>Rôles de la pharmacie</h3>
          <label className="case"><input type="checkbox" checked={archives} onChange={(e) => setArchives(e.target.checked)} /> Afficher les rôles archivés</label>
        </div>
        {roles.erreur ? <div className="alerte alerte-erreur">{roles.erreur}</div> : !roles.donnees ? <Chargement /> : (
          <div className="tableau-conteneur">
            <table>
              <thead><tr><th>Rôle</th><th>Type</th><th>Permissions</th><th>Utilisateurs</th><th>Double auth.</th></tr></thead>
              <tbody>{roles.donnees.map((r) => (
                <tr key={r.id} className="cliquable" tabIndex={0} onClick={() => aller(`/roles/${r.id}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/roles/${r.id}`)}>
                  <td><b>{r.libelle}</b><br /><span className="discret">{r.description ?? r.cle}</span></td>
                  <td>{r.archiveLe ? <span className="badge badge-neutre">Archivé</span> : r.systeme ? <span className="badge badge-neutre">Système</span> : <span className="badge">Personnalisé</span>}</td>
                  <td className="num">{r.permissions.length}</td>
                  <td className="num">{r.utilisateurs}</td>
                  <td>{r.mfaRequise ? <span className="badge badge-vert">Exigée</span> : <span className="discret">Non</span>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creation && roles.donnees && <CreationRole roles={roles.donnees.filter((r) => !r.archiveLe)} onFermer={() => setCreation(false)} />}
    </>
  );
}

export function CreationRole({ roles, depuis, onFermer }: { roles: Role[]; depuis?: string; onFermer: () => void }) {
  const toast = useToast();
  const [libelle, setLibelle] = useState("");
  const [cle, setCle] = useState("");
  const [description, setDescription] = useState("");
  const [copie, setCopie] = useState(depuis ?? "");
  const [mfa, setMfa] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const cleAuto = libelle.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    try {
      const r = await api.post<Role>("/api/roles", { libelle, cle: cle || cleAuto, description: description || undefined, mfaRequise: mfa, ...(copie ? { copierDe: copie } : {}) });
      toast("Rôle créé."); onFermer(); aller(`/roles/${r.id}`);
    } catch (err) { setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre="Créer un rôle personnalisé" onFermer={onFermer}>
      <form onSubmit={soumettre} style={{ display: "grid", gap: 12 }}>
        <Champ label="Nom du rôle" valeur={libelle} onChange={setLibelle} requis autoFocus placeholder="Ex. Caissier principal" />
        <Champ label="Identifiant technique" valeur={cle || cleAuto} onChange={setCle} aide="Lettres minuscules, chiffres et _. Ne change plus ensuite." />
        <Champ label="Description" valeur={description} onChange={setDescription} />
        <Selection label="Partir des permissions de…" valeur={copie} onChange={setCopie}
          options={[["", "Aucun (rôle vide)"], ...roles.map((r) => [r.id, r.libelle] as [string, string])]}
          aide="Copier un rôle existant demande une confirmation par mot de passe." />
        <label className="case"><input type="checkbox" checked={mfa} onChange={(e) => setMfa(e.target.checked)} /> Exiger la double authentification pour ce rôle</label>
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal">Créer</button></div>
      </form>
    </Modale>
  );
}
