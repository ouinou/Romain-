import { useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Chargement, Pagination, useDonnees, useRetarde } from "../../composants/ui";
import { BadgeEcriture, Montant, dateFr, useReference, type EcritureResume } from "./commun";
import type { Page } from "../../types";

export function Ecritures() {
  const { a } = useSession();
  const { exercices, journaux } = useReference();
  const [exercice, setExercice] = useState("");
  const [journal, setJournal] = useState("");
  const [statut, setStatut] = useState("");
  const [recherche, setRecherche] = useState("");
  const [page, setPage] = useState(1);
  const rech = useRetarde(recherche);
  const liste = useDonnees(() => api.get<Page<EcritureResume>>(`/api/comptabilite/ecritures${qs({ exercice, journal, statut, recherche: rech, page, taille: 25 })}`), [exercice, journal, statut, rech, page]);
  const f = (s: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { s(e.target.value); setPage(1); };
  return (
    <>
      <div className="entete-page">
        <div><h2>Écritures</h2><p>Brouillards à compléter ou à valider, et écritures validées, numérotées et intangibles.</p></div>
        {a("accounting.create") && <button className="btn btn-principal" onClick={() => aller("/comptabilite/ecritures/nouvelle")}>+ Nouvelle écriture</button>}
      </div>
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="ec-r">Rechercher</label>
          <input id="ec-r" className="filtre" type="search" placeholder="Libellé ou pièce…" value={recherche} onChange={f(setRecherche)} />
          <label className="cache-visuel" htmlFor="ec-x">Exercice</label>
          <select id="ec-x" className="filtre" value={exercice} onChange={f(setExercice)}><option value="">Tous les exercices</option>{exercices.map((x) => <option key={x.id} value={x.id}>Exercice {x.code}</option>)}</select>
          <label className="cache-visuel" htmlFor="ec-j">Journal</label>
          <select id="ec-j" className="filtre" value={journal} onChange={f(setJournal)}><option value="">Tous les journaux</option>{journaux.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.libelle}</option>)}</select>
          <label className="cache-visuel" htmlFor="ec-s">État</label>
          <select id="ec-s" className="filtre" value={statut} onChange={f(setStatut)}><option value="">Tous les états</option><option value="brouillard">Brouillards</option><option value="validee">Validées</option></select>
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>Date</th><th>Journal</th><th>N°</th><th>Pièce</th><th>Libellé</th><th className="montant">Débit</th><th className="montant">Crédit</th><th>État</th><th>Saisie par</th></tr></thead>
                <tbody>
                  {liste.donnees.elements.length === 0 && <tr><td colSpan={9} className="vide">Aucune écriture pour ces critères.</td></tr>}
                  {liste.donnees.elements.map((e) => (
                    <tr key={e.id} className="cliquable" tabIndex={0} onClick={() => aller(`/comptabilite/ecritures/${e.id}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/comptabilite/ecritures/${e.id}`)}>
                      <td className="num">{dateFr(e.date)}</td><td><span className="etiquette-journal">{e.journal}</span></td><td className="num">{e.numero ?? "—"}</td>
                      <td>{e.piece}</td><td>{e.libelle}</td>
                      <td className="montant"><Montant v={e.totalDebit} /></td><td className="montant"><Montant v={e.totalCredit} /></td>
                      <td><BadgeEcriture e={e} /></td><td>{e.auteur}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}
