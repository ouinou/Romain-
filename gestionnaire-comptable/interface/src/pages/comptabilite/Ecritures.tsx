import { useCallback, useEffect, useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { aller, effacerParametres, useParametres } from "../../routeur";
import { Chargement, Pagination, useDonnees, useRetarde, useToast, messageErreur } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import { BadgeEcriture, Montant, dateFr, formatMontant, useReference, type Ecriture, type EcritureResume } from "./commun";
import { Icone } from "../../assets/icons/Icone";
import { PanneauDetail, useSommeSelection } from "../../composants/cadre/etat";
import type { Page } from "../../types";

export function Ecritures() {
  const { a } = useSession();
  const { exercices, journaux } = useReference();
  const [exercice, setExercice] = useState("");
  const [journal, setJournal] = useState("");
  const [statut, setStatut] = useState("");
  // Commande « Brouillards à valider » (ruban, barre d'état) : #/comptabilite/ecritures?statut=brouillard.
  const params = useParametres();
  useEffect(() => { const s = params.get("statut"); if (s === "brouillard" || s === "validee") { setStatut(s); setPage(1); effacerParametres(); } }, [params]);
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
  // Ligne active : son détail s'affiche dans le panneau de droite ; double-clic ou Entrée ouvre la fiche.
  const [active, setActive] = useState<string | null>(null);
  const fermerDetail = useCallback(() => setActive(null), []);
  const ouvrir = (id: string) => aller(`/comptabilite/ecritures/${id}`);
  const elements = liste.donnees?.elements ?? [];
  const choisies = elements.filter((e) => selection.has(e.id));
  const sommeDebit = choisies.reduce((t, e) => t + e.totalDebit, 0);
  useSommeSelection(choisies.length ? `${formatMontant(sommeDebit)} FCFA (${choisies.length})` : null);
  // F9 : valider la sélection (comme dans les logiciels comptables).
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "F9" && peutValider && selection.size > 0) { e.preventDefault(); setValiderLot(true); } };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [peutValider, selection.size]);
  const f = (s: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { s(e.target.value); setPage(1); };
  return (
    <>
      <div className="entete-page">
        <div><h2>Écritures</h2><p>Brouillards à compléter ou à valider, et écritures validées, numérotées et intangibles.</p></div>
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
        <div className="barre-outils" role="toolbar" aria-label="Actions sur les écritures">
          {a("accounting.create") && <button className="outil-tableau" onClick={() => aller("/comptabilite/ecritures/nouvelle")} title="Nouvelle écriture (Alt+E)"><Icone nom="nouveau" taille={16} />Nouvelle écriture</button>}
          <button className="outil-tableau" disabled={!active} onClick={() => active && ouvrir(active)} title="Ouvrir la fiche de l'écriture choisie (Entrée)"><Icone nom="ouvrir" taille={16} />Ouvrir</button>
          {peutValider && <>
            <span className="sep" aria-hidden="true" />
            <button className="outil-tableau" disabled={!selectionnables.length} onClick={() => setSelection(new Set(selectionnables.map((e) => e.id)))}
              title="Sélectionner les brouillards équilibrés de la page"><Icone nom="valider" taille={16} />Tout sélectionner ({selectionnables.length})</button>
            <button className="outil-tableau" disabled={!selection.size} onClick={() => setValiderLot(true)} title="Valider la sélection (F9)"><Icone nom="valider" taille={16} />Valider la sélection ({selection.size}) · F9</button>
          </>}
          <span className="sep" aria-hidden="true" />
          <button className="outil-tableau" onClick={() => window.print()} title="Imprimer la liste (Ctrl+P)"><Icone nom="imprimer" taille={16} />Imprimer</button>
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr>{peutValider && <th><span className="cache-visuel">Sélection</span></th>}<th>Date</th><th>Journal</th><th>N°</th><th>Pièce</th><th>Libellé</th><th className="montant">Débit</th><th className="montant">Crédit</th><th>État</th><th>Saisie par</th></tr></thead>
                <tbody>
                  {liste.donnees.elements.length === 0 && <tr><td colSpan={10} className="vide">Aucune écriture pour ces critères.</td></tr>}
                  {liste.donnees.elements.map((e) => (
                    <tr key={e.id} className={"cliquable" + (active === e.id || selection.has(e.id) ? " selectionnee" : "")} tabIndex={0} aria-selected={active === e.id}
                      onClick={() => setActive(e.id)} onDoubleClick={() => ouvrir(e.id)} onFocus={() => setActive(e.id)}
                      onKeyDown={(k) => { if (k.key === "Enter") ouvrir(e.id); if (k.key === " " && peutValider && e.statut === "brouillard" && e.equilibree) { k.preventDefault(); basculer(e.id); } }}>
                      {peutValider && <td onClick={(ev) => ev.stopPropagation()}>{e.statut === "brouillard" && e.equilibree &&
                        <input type="checkbox" aria-label={`Sélectionner ${e.piece}`} checked={selection.has(e.id)} onChange={() => basculer(e.id)} />}</td>}
                      <td className="num">{dateFr(e.date)}</td><td><span className="etiquette-journal">{e.journal}</span></td><td className="num">{e.numero ?? "—"}</td>
                      <td className="num">{e.piece}</td><td>{e.libelle}</td>
                      <td className="montant"><Montant v={e.totalDebit} /></td><td className="montant"><Montant v={e.totalCredit} /></td>
                      <td><BadgeEcriture e={e} />{e.origine && <span className="badge badge-neutre" style={{ marginLeft: 4 }}>{e.origine === "facture" ? "Vente" : e.origine === "avoir" ? "Avoir" : "Trésorerie"}</span>}</td><td>{e.auteur}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
            <div className="pied-tableau">
              <span>{liste.donnees.total} écriture{liste.donnees.total > 1 ? "s" : ""}</span>
              {peutValider && <span>{selection.size} sélectionnée{selection.size > 1 ? "s" : ""}</span>}
              {choisies.length > 0 && <span>Débit sélectionné : <b className="num">{formatMontant(sommeDebit)}</b> FCFA</span>}
            </div>
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} />
          </>
        )}
      </section>
      {active && <DetailEcriture id={active} onFermer={fermerDetail} />}
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

/** Panneau de détail : informations générales, lignes comptables et origine de l'écriture choisie. */
function DetailEcriture({ id, onFermer }: { id: string; onFermer: () => void }) {
  const e = useDonnees(() => api.get<Ecriture>(`/api/comptabilite/ecritures/${id}`), [id]);
  return (
    <PanneauDetail titre="Détail de l'écriture" onFermer={onFermer}>
      {e.erreur ? <div className="alerte alerte-erreur">{e.erreur}</div> : !e.donnees ? <Chargement /> : (() => {
        const x = e.donnees;
        return <>
          <section className="section-detail">
            <h4>Informations générales</h4>
            <dl>
              <dt>Date</dt><dd className="num">{dateFr(x.date)}</dd>
              <dt>N° pièce</dt><dd>{x.piece}</dd>
              <dt>Libellé</dt><dd>{x.libelle}</dd>
              <dt>Journal</dt><dd>{x.journal.code} · {x.journal.libelle}</dd>
              <dt>Numéro</dt><dd className="num">{x.numero ?? "—"}</dd>
              <dt>Statut</dt><dd><BadgeEcriture e={x} /></dd>
              <dt>Saisie par</dt><dd>{x.auteur.nom}</dd>
              {x.validateur && <><dt>Validée par</dt><dd>{x.validateur.nom}</dd></>}
            </dl>
          </section>
          <section className="section-detail">
            <h4>Lignes comptables</h4>
            <table>
              <thead><tr><th>Compte</th><th>Libellé</th><th className="montant">Débit</th><th className="montant">Crédit</th></tr></thead>
              <tbody>{x.lignes.map((l) => (
                <tr key={l.ordre}><td className="num">{l.compte}</td><td>{l.libelle || l.compteLibelle}</td>
                  <td className="montant"><Montant v={l.debit} vide="" /></td><td className="montant"><Montant v={l.credit} vide="" /></td></tr>))}
              </tbody>
              <tfoot><tr><th colSpan={2}>Total</th><th className="montant"><Montant v={x.totalDebit} /></th><th className="montant"><Montant v={x.totalCredit} /></th></tr></tfoot>
            </table>
          </section>
          {x.origine && (
            <section className="section-detail">
              <h4>Origine</h4>
              <dl><dt>{x.origine.type === "facture" ? "Facture" : x.origine.type === "avoir" ? "Avoir" : "Mouvement"}</dt>
                <dd><a href={x.origine.type === "facture" ? `#/ventes/factures/${x.origine.id}` : x.origine.type === "avoir" ? `#/ventes/avoirs/${x.origine.id}` : `#/tresorerie/mouvements/${x.origine.id}`}>{x.origine.reference}</a></dd></dl>
            </section>
          )}
          <button className="btn btn-principal" onClick={() => aller(`/comptabilite/ecritures/${x.id}`)}>Ouvrir la fiche</button>
        </>;
      })()}
    </PanneauDetail>
  );
}
