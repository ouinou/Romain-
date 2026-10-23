import { useEffect, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { Champ, Chargement, Modale, messageErreur, useDonnees, useToast } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import { MODULES, ACTIONS_PERM } from "../../libelles";
import { dateFr, type Exercice } from "./commun";

interface Parametres { separationSaisieValidation: boolean; devise: { code: string; decimales: number }; comptesProteges: { id: string; prefixe: string; libelle: string; permission: string; accessible: boolean }[] }
const libPerm = (p: string) => { const [m, a] = p.split("."); return `${MODULES[m] ?? m} : ${ACTIONS_PERM[a] ?? a}`; };

export function ParametresComptables() {
  const { a } = useSession();
  const toast = useToast();
  const admin = a("accounting.admin");
  const ex = useDonnees(() => api.get<Exercice[]>("/api/comptabilite/exercices"), []);
  const p = useDonnees(() => api.get<Parametres>("/api/comptabilite/parametres"), []);
  const [nouvel, setNouvel] = useState(false);
  const [cloture, setCloture] = useState<Exercice | null>(null);
  const [groupes, setGroupes] = useState<{ prefixe: string; libelle: string; permission: string }[]>([]);
  const [enregGroupes, setEnregGroupes] = useState(false);
  useEffect(() => { if (p.donnees) setGroupes(p.donnees.comptesProteges.map(({ prefixe, libelle, permission }) => ({ prefixe, libelle, permission }))); }, [p.donnees]);

  const basculerSeparation = async () => {
    try { await api.patch("/api/comptabilite/parametres", { separationSaisieValidation: !p.donnees!.separationSaisieValidation }); toast("Paramètre enregistré."); p.recharger(); }
    catch (e) { if ((e as { code?: string }).code !== "annulee") toast(messageErreur(e), true); }
  };

  return (
    <>
      <div className="entete-page"><div><h2>Exercices et paramètres</h2><p>Exercices comptables, séparation des tâches et comptes protégés.</p></div></div>
      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Exercices</h3><p>La clôture est définitive : plus aucune écriture, pas de réouverture.</p></div>
            {admin && <button className="btn btn-petit" onClick={() => setNouvel(true)}>+ Nouvel exercice</button>}</div>
          {!ex.donnees ? <Chargement /> : (
            <div className="tableau-conteneur"><table>
              <thead><tr><th>Exercice</th><th>Période</th><th className="montant">Validées</th><th className="montant">Brouillards</th><th>État</th>{admin && <th></th>}</tr></thead>
              <tbody>{ex.donnees.map((x) => (
                <tr key={x.id}><td><b>{x.code}</b></td><td className="num">{dateFr(x.debut)} → {dateFr(x.fin)}</td>
                  <td className="montant">{x.validees}</td><td className="montant">{x.brouillons}</td>
                  <td>{x.statut === "ouvert" ? <span className="badge badge-vert">Ouvert</span> : <span className="badge badge-neutre">Clôturé</span>}</td>
                  {admin && <td>{x.statut === "ouvert" && <button className="btn btn-petit btn-danger" onClick={() => setCloture(x)}>Clôturer</button>}</td>}</tr>))}
              </tbody></table></div>
          )}
        </section>
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Séparation saisie / validation</h3><p>Recommandé : activée</p></div></div>
          {!p.donnees ? <Chargement /> : <>
            <p style={{ margin: "0 0 10px" }}>{p.donnees.separationSaisieValidation ? <span className="badge badge-vert">Activée</span> : <span className="badge badge-orange">Désactivée</span>}{" "}
              {p.donnees.separationSaisieValidation ? "L'auteur d'une écriture ne peut pas la valider lui-même." : "Une même personne peut saisir et valider. À réserver aux très petites structures ; chaque validation reste tracée."}</p>
            {admin && <button className="btn" onClick={basculerSeparation}>{p.donnees.separationSaisieValidation ? "Désactiver" : "Activer"}</button>}
            <p className="discret" style={{ marginBottom: 0 }}>Devise : {p.donnees.devise.code}, montants entiers ({p.donnees.devise.decimales} décimale).</p>
          </>}
        </section>
      </div>
      <ParametresFiscaux admin={admin} />
      <section className="panneau">
        <div className="entete-panneau"><div><h3>Comptes protégés</h3><p>Les mouvements des comptes commençant par ces numéros ne sont visibles qu'avec la permission indiquée.</p></div>
          {admin && <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-petit" onClick={() => setGroupes([...groupes, { prefixe: "", libelle: "", permission: "treasury.read" }])}>+ Ajouter</button>
            <button className="btn btn-petit btn-principal" onClick={() => setEnregGroupes(true)}>Enregistrer</button></div>}</div>
        {!p.donnees ? <Chargement /> : (
          <div className="tableau-conteneur"><table className="lignes-saisie">
            <thead><tr><th>Comptes commençant par</th><th>Désignation</th><th>Permission exigée</th>{admin && <th></th>}</tr></thead>
            <tbody>{groupes.map((g, i) => (
              <tr key={i}>
                <td><input aria-label="Préfixe" value={g.prefixe} readOnly={!admin} inputMode="numeric" onChange={(e) => setGroupes(groupes.map((x, j) => j === i ? { ...x, prefixe: e.target.value.replace(/\D/g, "").slice(0, 8) } : x))} /></td>
                <td><input aria-label="Désignation" value={g.libelle} readOnly={!admin} onChange={(e) => setGroupes(groupes.map((x, j) => j === i ? { ...x, libelle: e.target.value } : x))} /></td>
                <td>{admin ? <select aria-label="Permission" value={g.permission} onChange={(e) => setGroupes(groupes.map((x, j) => j === i ? { ...x, permission: e.target.value } : x))}>
                  {["treasury.read", "payroll.read", "hr.read", "reports.read", "accounting.admin"].map((x) => <option key={x} value={x}>{libPerm(x)}</option>)}</select> : libPerm(g.permission)}</td>
                {admin && <td><button className="btn btn-petit" aria-label="Retirer" onClick={() => setGroupes(groupes.filter((_, j) => j !== i))}>×</button></td>}
              </tr>))}
            </tbody></table></div>
        )}
      </section>
      {nouvel && <NouvelExercice onFermer={() => setNouvel(false)} onFin={ex.recharger} />}
      {cloture && <ConfirmerAction titre={`Clôturer l'exercice ${cloture.code} ?`} danger motif libelle="Clôturer définitivement"
        texte={<>Opération <b>irréversible</b> : plus aucune écriture ne pourra être enregistrée ou extournée dans cet exercice. Tous les brouillards doivent avoir été validés ou supprimés ({cloture.brouillons} restant(s)).</>}
        onValider={async (motif) => { await api.post(`/api/comptabilite/exercices/${cloture.id}/cloture`, { motif }); toast("Exercice clôturé."); ex.recharger(); }}
        onFermer={() => setCloture(null)} />}
      {enregGroupes && <ConfirmerAction titre="Enregistrer les comptes protégés ?" motif libelle="Enregistrer"
        texte="Le changement s'applique immédiatement à tous les utilisateurs. Il est tracé dans le journal d'audit."
        onValider={async (motif) => { await api.put("/api/comptabilite/comptes-proteges", { groupes: groupes.filter((g) => g.prefixe), motif }); toast("Comptes protégés enregistrés."); p.recharger(); }}
        onFermer={() => setEnregGroupes(false)} />}
    </>
  );
}

function NouvelExercice({ onFermer, onFin }: { onFermer: () => void; onFin: () => void }) {
  const an = new Date().getFullYear() + 1;
  const [code, setCode] = useState(String(an));
  const [debut, setDebut] = useState(`${an}-01-01`);
  const [fin, setFin] = useState(`${an}-12-31`);
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    try { await api.post("/api/comptabilite/exercices", { code, debut, fin }); onFin(); onFermer(); } catch (err) { setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre="Nouvel exercice" onFermer={onFermer}>
      <form onSubmit={envoyer} style={{ display: "grid", gap: 12 }}>
        <Champ label="Code" valeur={code} onChange={setCode} requis />
        <div className="grille-champs"><Champ label="Début" type="date" valeur={debut} onChange={setDebut} requis /><Champ label="Fin" type="date" valeur={fin} onChange={setFin} requis /></div>
        <p className="discret" style={{ margin: 0 }}>En règle générale, l'exercice dure 12 mois et coïncide avec l'année civile (à confirmer selon votre situation).</p>
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal">Créer</button></div>
      </form>
    </Modale>
  );
}

/** TVA et mentions de facture : saisies par l'entreprise d'après les textes en vigueur (aucun taux codé en dur). */
function ParametresFiscaux({ admin }: { admin: boolean }) {
  const toast = useToast();
  const p = useDonnees(() => api.get<{ tvaApplicable: boolean; tauxTvaPdm: number; mentionsFacture: string }>("/api/ventes/parametres").catch(() => null), []);
  const [f, setF] = useState({ tvaApplicable: false, taux: "", mentions: "" });
  useEffect(() => { if (p.donnees) setF({ tvaApplicable: p.donnees.tvaApplicable, taux: p.donnees.tauxTvaPdm ? String(p.donnees.tauxTvaPdm / 100).replace(".", ",") : "", mentions: p.donnees.mentionsFacture }); }, [p.donnees]);
  if (!p.donnees) return null;
  const enregistrer = async (e: React.FormEvent) => {
    e.preventDefault();
    const taux = Math.round(Number(f.taux.replace(",", ".")) * 100);
    try {
      await api.patch("/api/ventes/parametres", { tvaApplicable: f.tvaApplicable, tauxTvaPdm: f.tvaApplicable ? taux : 0, mentionsFacture: f.mentions });
      toast("Paramètres de facturation enregistrés."); p.recharger();
    } catch (err) { if ((err as { code?: string }).code !== "annulee") toast(messageErreur(err), true); }
  };
  return (
    <section className="panneau">
      <div className="entete-panneau"><div><h3>TVA et facturation</h3><p>Taux à reprendre de la loi de finances en vigueur et à faire confirmer par votre expert-comptable.</p></div></div>
      <form onSubmit={enregistrer} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
        <label className="case"><input type="checkbox" checked={f.tvaApplicable} disabled={!admin} onChange={(e) => setF({ ...f, tvaApplicable: e.target.checked })} /> L'entreprise facture la TVA</label>
        {f.tvaApplicable && <Champ label="Taux de TVA (%)" valeur={f.taux} onChange={(v) => setF({ ...f, taux: v.replace(/[^\d,.]/g, "") })} lectureSeule={!admin} inputMode="numeric" aide="Par exemple 19,25 si c'est le taux en vigueur pour votre activité." />}
        <Champ label="Mentions imprimées sur les factures (facultatif)" valeur={f.mentions} onChange={(v) => setF({ ...f, mentions: v })} lectureSeule={!admin} aide="Conditions de paiement, coordonnées bancaires, mentions légales…" />
        {admin && <div><button className="btn btn-principal">Enregistrer</button></div>}
      </form>
    </section>
  );
}
