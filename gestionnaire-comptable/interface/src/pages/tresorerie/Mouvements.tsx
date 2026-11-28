import { imprimerPdf } from "../ventes/FicheFacture";
import { useEffect, useState } from "react";
import { effacerParametres, useParametres } from "../../routeur";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { Chargement, Pagination, dateHeure, useDonnees, useRetarde, useToast } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import { Montant, dateFr } from "../comptabilite/commun";
import { NATURES, comptesTresorerie, type Mouvement } from "./commun";
import { TableMouvements } from "./Tresorerie";
import type { Page } from "../../types";

export function Mouvements() {
  const initial = new URLSearchParams(location.hash.split("?")[1] ?? "").get("compte") ?? "";
  const comptes = useDonnees(comptesTresorerie, []);
  const [compte, setCompte] = useState(initial);
  const [sens, setSens] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [recherche, setRecherche] = useState("");
  const [page, setPage] = useState(1);
  // Recherche globale (Ctrl+F) : #/tresorerie/mouvements?recherche=MVT-…
  const params = useParametres();
  useEffect(() => { const r = params.get("recherche"); if (r !== null) { setRecherche(r); setPage(1); effacerParametres(); } }, [params]);
  const rech = useRetarde(recherche);
  const liste = useDonnees(() => api.get<Page<Mouvement>>(`/api/tresorerie/mouvements${qs({ compte, sens, du, au, recherche: rech, page, taille: 25 })}`), [compte, sens, du, au, rech, page]);
  const choisi = comptes.donnees?.find((c) => c.id === compte);
  const f = (s: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { s(e.target.value); setPage(1); };
  return (
    <>
      <div className="entete-page"><div><h2>Mouvements de trésorerie</h2><p>Historique des encaissements, dépenses et transferts. Un mouvement enregistré ne se modifie pas : on l'annule par un mouvement inverse motivé.</p></div></div>
      {choisi && <div className="alerte">{choisi.nom} : solde actuel <b><Montant v={choisi.solde} /> FCFA</b></div>}
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="mv-r">Rechercher</label>
          <input id="mv-r" className="filtre" type="search" placeholder="Libellé ou référence…" value={recherche} onChange={f(setRecherche)} />
          <label className="cache-visuel" htmlFor="mv-c">Compte</label>
          <select id="mv-c" className="filtre" value={compte} onChange={f(setCompte)}><option value="">Tous les comptes</option>{comptes.donnees?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</select>
          <label className="cache-visuel" htmlFor="mv-s">Sens</label>
          <select id="mv-s" className="filtre" value={sens} onChange={f(setSens)}><option value="">Entrées et sorties</option><option value="entree">Entrées</option><option value="sortie">Sorties</option></select>
          <label className="cache-visuel" htmlFor="mv-du">Du</label><input id="mv-du" className="filtre" type="date" value={du} onChange={f(setDu)} />
          <label className="cache-visuel" htmlFor="mv-au">Au</label><input id="mv-au" className="filtre" type="date" value={au} onChange={f(setAu)} />
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : liste.donnees.elements.length === 0 ? <div className="vide">Aucun mouvement pour ces critères.</div> : (
          <><TableMouvements mouvements={liste.donnees.elements} />
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} /></>
        )}
      </section>
    </>
  );
}

/** Reçu ou bon de décaissement en PDF (même impression que les factures). */
function imprimerRecu(id: string, toast: (m: string) => void) {
  const url = `/api/tresorerie/mouvements/${id}/recu`;
  if (__DEMO__) { toast("Démonstration : le reçu PDF est produit par le logiciel installé (serveur de l'entreprise)."); return; }
  imprimerPdf(url, () => { window.open(url, "_blank", "noopener"); });
}

export function FicheMouvement({ id }: { id: string }) {
  const { a } = useSession();
  const toast = useToast();
  const m = useDonnees(() => api.get<Mouvement>(`/api/tresorerie/mouvements/${id}`), [id]);
  const [annuler, setAnnuler] = useState(false);
  if (m.erreur) return <div className="alerte alerte-erreur">{m.erreur} <a href="#/tresorerie/mouvements">Retour</a></div>;
  if (!m.donnees) return <Chargement />;
  const x = m.donnees;
  return (
    <>
      <div><a href="#/tresorerie/mouvements" className="btn-lien">← Tous les mouvements</a></div>
      <div className="entete-page">
        <div><h2>{NATURES[x.nature] ?? x.nature} {x.reference}</h2><p className="infos">{x.libelle} · {x.compte.nom} · {dateFr(x.date)}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-principal" onClick={() => imprimerRecu(id, toast)}>🖨 {x.sens === "entree" ? "Imprimer le reçu" : "Imprimer le bon de décaissement"}</button>
          {a("treasury.cancel") && !x.annuleePar && x.nature !== "reversal" && <button className="btn btn-danger" onClick={() => setAnnuler(true)}>Annuler ce mouvement</button>}
        </div>
      </div>
      {x.annuleePar && <div className="alerte alerte-attention">Ce mouvement a été annulé (<a href={`#/tresorerie/mouvements/${x.annuleePar}`}>voir l'annulation</a>).</div>}
      {x.annulationDe && <div className="alerte">Annulation du <a href={`#/tresorerie/mouvements/${x.annulationDe}`}>mouvement d'origine</a>. Motif : {x.motif}</div>}
      <section className="panneau">
        <dl style={{ display: "grid", gridTemplateColumns: "minmax(160px, auto) 1fr", gap: "8px 16px", margin: 0 }}>
          <dt className="discret">Montant</dt><dd style={{ margin: 0 }}><b>{x.sens === "entree" ? "+" : "−"} <Montant v={x.montant} /> FCFA</b>{x.tva ? <> dont TVA récupérable <Montant v={x.tva} /></> : null}</dd>
          <dt className="discret">Compte de trésorerie</dt><dd style={{ margin: 0 }}>{x.compte.nom}</dd>
          <dt className="discret">Contrepartie comptable</dt><dd style={{ margin: 0 }}>{x.contrepartie.numero} · {x.contrepartie.libelle}</dd>
          {x.facture && <><dt className="discret">Facture</dt><dd style={{ margin: 0 }}><a href={`#/ventes/factures/${x.factureId}`}>{x.facture}</a></dd></>}
          <dt className="discret">Écriture comptable</dt><dd style={{ margin: 0 }}>{x.ecriture ? <>{x.ecriture.statut === "validee" ? `Validée (n° ${x.ecriture.numero})` : "En attente de validation"}{a("accounting.read") && <> · <a href={`#/comptabilite/ecritures/${x.ecriture.id}`}>ouvrir</a></>}</> : "Portée par l'autre jambe du transfert"}</dd>
          <dt className="discret">Enregistré par</dt><dd style={{ margin: 0 }}>{x.auteur} · <span className="num">{dateHeure(x.creeLe)}</span></dd>
          <dt className="discret">En-tête du reçu</dt><dd style={{ margin: 0 }}>{x.emetteur ? <>{x.emetteur.raisonSociale} <span className="discret">· profil de l'entreprise au jour de l'opération</span></> : <span className="discret">Profil actuel de l'entreprise (opération antérieure à la version 0.3)</span>}</dd>
        </dl>
      </section>
      {annuler && <ConfirmerAction titre="Annuler ce mouvement ?" danger motif libelle="Annuler le mouvement"
        texte="Un mouvement inverse est enregistré (et son écriture inverse, à valider). Le mouvement d'origine reste dans l'historique. Pour un transfert, les deux comptes sont rétablis."
        onValider={async (motif) => { await api.post(`/api/tresorerie/mouvements/${id}/annulation`, { motif }); toast("Mouvement annulé."); m.recharger(); }}
        onFermer={() => setAnnuler(false)} />}
    </>
  );
}
