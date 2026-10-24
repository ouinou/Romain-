import { useEffect, useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { aller, effacerParametres, useParametres } from "../../routeur";
import { Chargement, Pagination, useDonnees, useRetarde } from "../../composants/ui";
import { Montant, dateFr } from "../comptabilite/commun";
import { BadgePaiement, type FactureResume } from "./commun";

export function Ventes() {
  const { a } = useSession();
  const [recherche, setRecherche] = useState(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("client") ?? "");
  const [statut, setStatut] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [page, setPage] = useState(1);
  // Recherche globale (Ctrl+F) : #/ventes?recherche=FAC-…
  const params = useParametres();
  useEffect(() => { const r = params.get("recherche") ?? params.get("client"); if (r !== null) { setRecherche(r); setPage(1); effacerParametres(); } }, [params]);
  const rech = useRetarde(recherche);
  const liste = useDonnees(() => api.get<{ elements: FactureResume[]; total: number; totalTtc: number; totalReste: number; page: number; taille: number }>(
    `/api/ventes/factures${qs({ recherche: rech, statut, du, au, page, taille: 25 })}`), [rech, statut, du, au, page]);
  const f = (s: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { s(e.target.value); setPage(1); };
  return (
    <>
      <div className="entete-page">
        <div><h2>Ventes et factures</h2><p>Ventes de marchandises et prestations de services. Chaque facture reçoit un numéro définitif et peut être imprimée immédiatement.</p></div>
        {a("sales.create") && <button className="btn btn-principal" onClick={() => aller("/ventes/nouvelle")}>+ Nouvelle vente</button>}
      </div>
      {liste.donnees && <section className="indicateurs" aria-label="Synthèse des ventes">
        <div className="indicateur"><div className="lib">Factures</div><div className="val">{liste.donnees.total}</div><div className="aide">Selon les filtres</div></div>
        <div className="indicateur"><div className="lib">Montant facturé (TTC)</div><div className="val"><Montant v={liste.donnees.totalTtc} /></div><div className="aide">FCFA</div></div>
        <div className={"indicateur" + (liste.donnees.totalReste ? " alerte-ind" : "")}><div className="lib">Reste à encaisser</div><div className="val"><Montant v={liste.donnees.totalReste} /></div><div className="aide">Créances clients</div></div>
      </section>}
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="v-r">Rechercher</label>
          <input id="v-r" className="filtre" type="search" placeholder="N° de facture ou client…" value={recherche} onChange={f(setRecherche)} />
          <label className="cache-visuel" htmlFor="v-s">Paiement</label>
          <select id="v-s" className="filtre" value={statut} onChange={f(setStatut)}><option value="">Toutes</option><option value="payee">Payées</option><option value="impayee">À encaisser</option></select>
          <label className="cache-visuel" htmlFor="v-du">Du</label><input id="v-du" className="filtre" type="date" value={du} onChange={f(setDu)} />
          <label className="cache-visuel" htmlFor="v-au">Au</label><input id="v-au" className="filtre" type="date" value={au} onChange={f(setAu)} />
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : liste.donnees.elements.length === 0 ? <div className="vide">Aucune facture pour l'instant.</div> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>N°</th><th>Date</th><th>Client</th><th className="montant">HT</th><th className="montant">TVA</th><th className="montant">TTC</th><th className="montant">Reste dû</th><th>Paiement</th></tr></thead>
                <tbody>{liste.donnees.elements.map((x) => (
                  <tr key={x.id} className="cliquable" tabIndex={0} onClick={() => aller(`/ventes/factures/${x.id}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/ventes/factures/${x.id}`)}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}><b>{x.numero}</b></td><td className="num">{dateFr(x.date)}</td><td>{x.client}</td>
                    <td className="montant"><Montant v={x.totalHt} /></td><td className="montant"><Montant v={x.totalTva} /></td><td className="montant"><b><Montant v={x.totalTtc} /></b></td>
                    <td className="montant"><Montant v={x.reste} vide="—" /></td><td><BadgePaiement s={x.statutPaiement} /></td>
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
