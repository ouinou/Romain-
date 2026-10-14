import { useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Champ, Chargement, Modale, ZoneTexte, dateHeure, messageErreur, useDonnees, useToast } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import { BadgeEcriture, Montant, dateFr, type Ecriture } from "./commun";

export function FicheEcriture({ id }: { id: string }) {
  const { moi, a } = useSession();
  const toast = useToast();
  const e = useDonnees(() => api.get<Ecriture>(`/api/comptabilite/ecritures/${id}`), [id]);
  const [action, setAction] = useState<null | "valider" | "supprimer" | "extourner">(null);
  if (e.erreur) return <div className="alerte alerte-erreur">{e.erreur} <a href="#/comptabilite/ecritures">Retour aux écritures</a></div>;
  if (!e.donnees) return <Chargement />;
  const x = e.donnees;
  const brouillard = x.statut === "brouillard";
  const auteur = x.auteur.id === moi.utilisateur.id;
  return (
    <>
      <div><a href="#/comptabilite/ecritures" className="btn-lien">← Toutes les écritures</a></div>
      <div className="entete-page">
        <div>
          <h2><span className="etiquette-journal" style={{ fontSize: 14, marginRight: 8 }}>{x.journal.code}</span>{brouillard ? "Brouillard" : `Écriture n° ${x.numero}`}</h2>
          <p>{x.libelle} · pièce {x.piece} · {dateFr(x.date)} · exercice {x.exercice.code}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {brouillard && a("accounting.update") && x.exercice.ouvert && <button className="btn" onClick={() => aller(`/comptabilite/ecritures/${id}/modifier`)}>Modifier</button>}
          {brouillard && a("accounting.update") && <button className="btn btn-danger" onClick={() => setAction("supprimer")}>Supprimer</button>}
          {brouillard && a("accounting.approve") && <button className="btn btn-principal" disabled={!x.equilibree} title={x.equilibree ? "" : "Écriture déséquilibrée"} onClick={() => setAction("valider")}>Valider</button>}
          {!brouillard && !x.extourneDe && !x.extourneePar && a("accounting.cancel") && <button className="btn btn-danger" onClick={() => setAction("extourner")}>Extourner</button>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><BadgeEcriture e={x} /></div>
      {brouillard && !x.equilibree && <div className="alerte alerte-attention">Brouillard déséquilibré : écart de <Montant v={Math.abs(x.totalDebit - x.totalCredit)} /> FCFA. Il doit être corrigé avant validation.</div>}
      {brouillard && a("accounting.approve") && auteur && <div className="alerte">Vous êtes l'auteur de ce brouillard : si la séparation saisie / validation est active, une autre personne doit le valider.</div>}
      {x.extourneDe && <div className="alerte">Extourne de l'écriture <a href={`#/comptabilite/ecritures/${x.extourneDe.id}`}>{x.extourneDe.journal} n° {x.extourneDe.numero}</a>. Motif : {x.extourneDe.motif}</div>}
      {x.extourneePar && <div className="alerte alerte-attention">Cette écriture a été annulée par l'extourne <a href={`#/comptabilite/ecritures/${x.extourneePar.id}`}>n° {x.extourneePar.numero}</a>. Elle reste dans les livres, son effet est neutralisé.</div>}

      <section className="panneau">
        <div className="tableau-conteneur">
          <table>
            <thead><tr><th>Compte</th><th>Intitulé</th><th>Libellé</th><th className="montant">Débit</th><th className="montant">Crédit</th></tr></thead>
            <tbody>{x.lignes.map((l) => (
              <tr key={l.ordre}><td className="num"><b>{l.compte}</b></td><td>{l.compteLibelle}</td><td>{l.libelle ?? <span className="discret">{x.libelle}</span>}</td>
                <td className="montant"><Montant v={l.debit} vide=" " /></td><td className="montant"><Montant v={l.credit} vide=" " /></td></tr>))}
            </tbody>
            <tfoot><tr><th colSpan={3}>Total</th><td className="montant"><Montant v={x.totalDebit} /></td><td className="montant"><Montant v={x.totalCredit} /></td></tr></tfoot>
          </table>
        </div>
      </section>
      <section className="panneau">
        <div className="entete-panneau"><h3>Traçabilité</h3></div>
        <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, auto) 1fr", gap: "8px 16px", margin: 0 }}>
          <dt className="discret">Saisie par</dt><dd style={{ margin: 0 }}>{x.auteur.nom} · <span className="num">{dateHeure(x.creeLe)}</span></dd>
          <dt className="discret">Dernière modification</dt><dd style={{ margin: 0 }} className="num">{dateHeure(x.modifieLe)}</dd>
          <dt className="discret">Validée par</dt><dd style={{ margin: 0 }}>{x.validateur ? <>{x.validateur.nom} · <span className="num">{dateHeure(x.valideeLe)}</span></> : "—"}</dd>
          <dt className="discret">Date de la pièce</dt><dd style={{ margin: 0 }}>{dateFr(x.datePiece)}</dd>
        </dl>
      </section>

      {action === "supprimer" && <ConfirmerAction titre="Supprimer ce brouillard ?" danger libelle="Supprimer" texte="Le brouillard n'a jamais été validé : il est supprimé, et sa suppression est tracée dans le journal d'audit."
        onValider={async () => { await api.del(`/api/comptabilite/ecritures/${id}`); toast("Brouillard supprimé."); aller("/comptabilite/ecritures"); }} onFermer={() => setAction(null)} />}
      {action === "valider" && <ConfirmerAction titre="Valider cette écriture ?" libelle="Valider"
        texte={<>Après validation, l'écriture reçoit le numéro suivant du journal {x.journal.code} et ne peut plus être modifiée ni supprimée. Total : <b><Montant v={x.totalDebit} /> FCFA</b>.</>}
        onValider={async () => { await api.post(`/api/comptabilite/ecritures/${id}/validation`); toast("Écriture validée."); e.recharger(); }} onFermer={() => setAction(null)} />}
      {action === "extourner" && <Extourne e={x} onFermer={() => setAction(null)} />}
    </>
  );
}

function Extourne({ e, onFermer }: { e: Ecriture; onFermer: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErreur(null);
    if (motif.trim().length < 3) return setErreur("Indiquez le motif de la correction (3 caractères minimum).");
    try {
      const r = await api.post<Ecriture>(`/api/comptabilite/ecritures/${e.id}/extourne`, { date, motif });
      toast(`Extourne n° ${r.numero} enregistrée. Saisissez maintenant l'écriture correcte si nécessaire.`); onFermer(); aller(`/comptabilite/ecritures/${r.id}`);
    } catch (err) { setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre={`Extourner l'écriture ${e.journal.code} n° ${e.numero}`} onFermer={onFermer}>
      <p style={{ margin: 0 }}>Une écriture inverse (débits et crédits permutés) est créée et validée dans le même journal. L'écriture d'origine reste dans les livres ; leurs effets s'annulent.</p>
      <form onSubmit={envoyer} style={{ display: "grid", gap: 12 }}>
        <Champ label="Date de l'extourne" type="date" valeur={date} onChange={setDate} requis aide="Doit appartenir à un exercice ouvert." />
        <ZoneTexte label="Motif de la correction" valeur={motif} onChange={setMotif} requis aide="Conservé avec l'écriture et dans le journal d'audit." />
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-danger">Extourner</button></div>
      </form>
    </Modale>
  );
}
