import { useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Chargement, Pagination, useDonnees, useRetarde, useToast, messageErreur } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import { BadgeEcriture, Montant, dateFr, useReference, type EcritureResume } from "./commun";
import type { Page } from "../../types";

export function Ecritures() {
  const { a } = useSession();
  const { exercices, journaux } = useReference();
  const [exercice, setExercice] = useState("");
  const [journal, setJournal] = useState("");
  const [statut, setStatut] = useState("");
  const [recherche, setRecherche] = useState("");
  const [origine, setOrigine] = useState("");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [validerLot, setValiderLot] = useState(false);
  const toast = useToast();
  const rech = useRetarde(recherche);
  const liste = useDonnees(() => api.get<Page<EcritureResume>>(`/api/comptabilite/ecritures${qs({ exercice, journal, statut, origine, recherche: rech, page, taille: 25 })}`), [exercice, journal, statut, origine, rech, page]);
  const selectionnables = (liste.donnees?.elements ?? []).filter((e) => e.statut === "brouillard" && e.equilibree);
  const peutValider = a("accounting.approve");
  const basculer = (id: string) => { const n = new Set(selection); n.has(id) ? n.delete(id) : n.add(id); setSelection(n); };
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
          <label className="cache-visuel" htmlFor="ec-o">Origine</label>
          <select id="ec-o" className="filtre" value={origine} onChange={f(setOrigine)}><option value="">Toutes origines</option><option value="operations">Ventes et trésorerie</option><option value="saisie">Saisies manuelles</option></select>
        </div>
        {peutValider && selectionnables.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <button className="btn btn-petit" onClick={() => setSelection(new Set(selectionnables.map((e) => e.id)))}>Tout sélectionner ({selectionnables.length})</button>
            {selection.size > 0 && <button className="btn btn-petit btn-principal" onClick={() => setValiderLot(true)}>Valider la sélection ({selection.size})</button>}
            <span className="discret">Seuls les brouillards équilibrés sont sélectionnables.</span>
          </div>
        )}
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr>{peutValider && <th><span className="cache-visuel">Sélection</span></th>}<th>Date</th><th>Journal</th><th>N°</th><th>Pièce</th><th>Libellé</th><th className="montant">Débit</th><th className="montant">Crédit</th><th>État</th><th>Saisie par</th></tr></thead>
                <tbody>
                  {liste.donnees.elements.length === 0 && <tr><td colSpan={10} className="vide">Aucune écriture pour ces critères.</td></tr>}
                  {liste.donnees.elements.map((e) => (
                    <tr key={e.id} className="cliquable" tabIndex={0} onClick={() => aller(`/comptabilite/ecritures/${e.id}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/comptabilite/ecritures/${e.id}`)}>
                      {peutValider && <td onClick={(ev) => ev.stopPropagation()}>{e.statut === "brouillard" && e.equilibree &&
                        <input type="checkbox" aria-label={`Sélectionner ${e.piece}`} checked={selection.has(e.id)} onChange={() => basculer(e.id)} />}</td>}
                      <td className="num">{dateFr(e.date)}</td><td><span className="etiquette-journal">{e.journal}</span></td><td className="num">{e.numero ?? "—"}</td>
                      <td>{e.piece}</td><td>{e.libelle}</td>
                      <td className="montant"><Montant v={e.totalDebit} /></td><td className="montant"><Montant v={e.totalCredit} /></td>
                      <td><BadgeEcriture e={e} />{e.origine && <span className="badge badge-neutre" style={{ marginLeft: 4 }}>{e.origine === "facture" ? "Vente" : "Trésorerie"}</span>}</td><td>{e.auteur}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} />
          </>
        )}
      </section>
      {validerLot && <ConfirmerAction titre={`Valider ${selection.size} écriture(s) ?`} libelle="Valider"
        texte="Chaque écriture reçoit son numéro définitif et ne pourra plus être modifiée. Celles que vous avez saisies vous-même seront refusées si la séparation des tâches est active."
        onValider={async () => {
          try {
            const r = await api.post<{ validees: number; refusees: number; resultats: { ok: boolean; erreur?: string }[] }>("/api/comptabilite/ecritures/validation-groupee", { ids: [...selection] });
            toast(`${r.validees} écriture(s) validée(s)${r.refusees ? `, ${r.refusees} refusée(s) : ${r.resultats.find((x) => !x.ok)?.erreur}` : "."}`, r.refusees > 0);
            setSelection(new Set()); liste.recharger();
          } catch (err) { if ((err as { code?: string }).code !== "annulee") throw new Error(messageErreur(err)); }
        }} onFermer={() => setValiderLot(false)} />}
    </>
  );
}
