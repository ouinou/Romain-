import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { Chargement, useDonnees, useToast } from "../composants/ui";
import { ConfirmerAction } from "../composants/Confirmations";
import { CreationRole } from "./Roles";
import type { Role } from "../types";

interface Catalogue { modules: { cle: string; libelle: string }[]; actions: { cle: string; libelle: string }[] }

export function FicheRole({ id }: { id: string }) {
  const { moi, a } = useSession();
  const toast = useToast();
  const role = useDonnees(() => api.get<Role>(`/api/roles/${id}`), [id]);
  const cat = useDonnees(() => api.get<Catalogue>("/api/permissions/catalogue"), []);
  const tous = useDonnees(() => api.get<Role[]>("/api/roles"), []);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [enregistrer, setEnregistrer] = useState(false);
  const [archiver, setArchiver] = useState(false);
  const [copier, setCopier] = useState(false);
  useEffect(() => { if (role.donnees) setPerms(new Set(role.donnees.permissions)); }, [role.donnees]);

  if (role.erreur) return <div className="alerte alerte-erreur">{role.erreur} <a href="#/roles">Retour</a></div>;
  if (!role.donnees || !cat.donnees) return <Chargement />;
  const r = role.donnees;
  const detenu = moi.roles.some((x) => x.id === r.id);
  const modifiable = !r.systeme && !r.archiveLe && a("roles.admin") && !detenu;
  const avant = new Set(r.permissions);
  const ajoutees = [...perms].filter((p) => !avant.has(p)), retirees = r.permissions.filter((p) => !perms.has(p));
  const change = ajoutees.length + retirees.length > 0;
  const basculer = (p: string) => { const n = new Set(perms); n.has(p) ? n.delete(p) : n.add(p); setPerms(n); };
  const libellePerm = (p: string) => { const [m, ac] = p.split("."); return `${cat.donnees!.modules.find((x) => x.cle === m)?.libelle ?? m} : ${cat.donnees!.actions.find((x) => x.cle === ac)?.libelle.toLowerCase() ?? ac}`; };

  return (
    <>
      <div><a href="#/roles" className="btn-lien">← Tous les rôles</a></div>
      <div className="entete-page">
        <div><h2>{r.libelle}</h2><p>{r.description ?? "Sans description"} · {r.utilisateurs} utilisateur(s){r.mfaRequise ? " · double authentification exigée" : ""}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {a("roles.create") && <button className="btn" onClick={() => setCopier(true)}>Créer un rôle à partir de celui-ci</button>}
          {!r.systeme && !r.archiveLe && a("roles.archive") && <button className="btn btn-danger" onClick={() => setArchiver(true)}>Archiver</button>}
        </div>
      </div>
      {r.systeme && <div className="alerte">Rôle système : ses permissions servent de référence et ne se modifient pas.</div>}
      {detenu && !r.systeme && <div className="alerte">Vous détenez ce rôle : un autre administrateur doit modifier ses permissions.</div>}
      {r.archiveLe && <div className="alerte alerte-attention">Rôle archivé : il n'accorde plus aucun droit.</div>}

      <section className="panneau">
        <div className="entete-panneau">
          <div><h3>Permissions</h3><p>{perms.size} permission(s) sur {cat.donnees.modules.length * cat.donnees.actions.length}{modifiable ? " · cochez puis enregistrez" : ""}</p></div>
          {modifiable && <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={!change} onClick={() => setPerms(new Set(r.permissions))}>Annuler les changements</button>
            <button className="btn btn-principal" disabled={!change} onClick={() => setEnregistrer(true)}>Enregistrer ({ajoutees.length + retirees.length})</button>
          </div>}
        </div>
        <div className="tableau-conteneur">
          <table className="grille-perms">
            <thead><tr><th scope="col">Module</th>{cat.donnees.actions.map((ac) => <th key={ac.cle} scope="col">{ac.libelle}</th>)}</tr></thead>
            <tbody>{cat.donnees.modules.map((m) => (
              <tr key={m.cle}>
                <th scope="row" style={{ textAlign: "left", fontSize: 13, color: "var(--texte)", background: "var(--carte)" }}>{m.libelle}</th>
                {cat.donnees!.actions.map((ac) => {
                  const p = `${m.cle}.${ac.cle}`;
                  return <td key={p}><input type="checkbox" checked={perms.has(p)} disabled={!modifiable} onChange={() => basculer(p)} aria-label={`${m.libelle} : ${ac.libelle}`} /></td>;
                })}
              </tr>))}
            </tbody>
          </table>
        </div>
      </section>

      {enregistrer && <ConfirmerAction titre="Enregistrer les permissions ?" motif libelle="Enregistrer"
        texte={<div style={{ display: "grid", gap: 6 }}>
          <span>Le changement s'applique immédiatement aux {r.utilisateurs} personne(s) qui ont ce rôle.</span>
          {ajoutees.length > 0 && <span><b>Ajoutées :</b> {ajoutees.map(libellePerm).join(" ; ")}</span>}
          {retirees.length > 0 && <span><b>Retirées :</b> {retirees.map(libellePerm).join(" ; ")}</span>}
        </div>}
        onValider={async (motif) => { await api.put(`/api/roles/${r.id}/permissions`, { permissions: [...perms], motif }); toast("Permissions enregistrées."); role.recharger(); }}
        onFermer={() => setEnregistrer(false)} />}
      {archiver && <ConfirmerAction titre={`Archiver « ${r.libelle} » ?`} danger motif libelle="Archiver"
        texte="Le rôle ne pourra plus être attribué. Il doit d'abord être retiré de tous les utilisateurs."
        onValider={async (motif) => { await api.post(`/api/roles/${r.id}/archivage`, { motif }); toast("Rôle archivé."); role.recharger(); }}
        onFermer={() => setArchiver(false)} />}
      {copier && tous.donnees && <CreationRole roles={tous.donnees} depuis={r.id} onFermer={() => setCopier(false)} />}
    </>
  );
}
