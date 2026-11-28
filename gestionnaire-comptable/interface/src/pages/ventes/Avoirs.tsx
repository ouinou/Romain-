import { useEffect, useState } from "react";
import { api, qs } from "../../api";
import { aller, effacerParametres, useParametres } from "../../routeur";
import { Chargement, Pagination, useDonnees, useRetarde } from "../../composants/ui";
import { Montant, dateFr } from "../comptabilite/commun";
import type { AvoirResume } from "./commun";

/** Liste des avoirs émis. Un avoir s'établit depuis la fiche de sa facture. */
export function Avoirs() {
  const [recherche, setRecherche] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [page, setPage] = useState(1);
  const params = useParametres();
  useEffect(() => { const r = params.get("recherche"); if (r !== null) { setRecherche(r); setPage(1); effacerParametres(); } }, [params]);
  const rech = useRetarde(recherche);
  const liste = useDonnees(() => api.get<{ elements: AvoirResume[]; total: number; totalTtc: number; page: number; taille: number }>(
    `/api/ventes/avoirs${qs({ recherche: rech, du, au, page, taille: 25 })}`), [rech, du, au, page]);
  const f = (s: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { s(e.target.value); setPage(1); };
  return (
    <>
      <div className="entete-page">
        <div><h2>Avoirs</h2><p>Annulations totales ou partielles de factures (retour, erreur de prix ou de quantité). Pour établir un avoir, ouvrez la facture concernée.</p></div>
      </div>
      {liste.donnees && <section className="indicateurs" aria-label="Synthèse des avoirs">
        <div className="indicateur"><div className="lib">Avoirs</div><div className="val">{liste.donnees.total}</div><div className="aide">Selon les filtres</div></div>
        <div className="indicateur"><div className="lib">Montant crédité (TTC)</div><div className="val"><Montant v={liste.donnees.totalTtc} /></div><div className="aide">FCFA</div></div>
      </section>}
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="av-r">Rechercher</label>
          <input id="av-r" className="filtre" type="search" placeholder="N° d'avoir, de facture ou client…" value={recherche} onChange={f(setRecherche)} />
          <label className="cache-visuel" htmlFor="av-du">Du</label><input id="av-du" className="filtre" type="date" value={du} onChange={f(setDu)} />
          <label className="cache-visuel" htmlFor="av-au">Au</label><input id="av-au" className="filtre" type="date" value={au} onChange={f(setAu)} />
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : liste.donnees.elements.length === 0 ? <div className="vide">Aucun avoir émis.</div> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>N°</th><th>Date</th><th>Facture</th><th>Client</th><th>Motif</th><th className="montant">TTC</th><th className="montant">Remboursé</th></tr></thead>
                <tbody>{liste.donnees.elements.map((x) => (
                  <tr key={x.id} className="cliquable" tabIndex={0} onClick={() => aller(`/ventes/avoirs/${x.id}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/ventes/avoirs/${x.id}`)}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}><b>{x.numero}</b></td><td className="num">{dateFr(x.date)}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{x.facture.numero}</td><td>{x.client}</td><td>{x.motif}</td>
                    <td className="montant"><b><Montant v={x.totalTtc} /></b></td><td className="montant"><Montant v={x.rembourse} vide="—" /></td>
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
