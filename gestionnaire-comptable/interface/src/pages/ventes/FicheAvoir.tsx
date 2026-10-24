import { api } from "../../api";
import { useSession } from "../../session";
import { Chargement, dateHeure, useDonnees, useToast } from "../../composants/ui";
import { Montant, dateFr, formatMontant } from "../comptabilite/commun";
import { ApercuFacture, imprimerPdf } from "./FicheFacture";
import type { Avoir, Facture } from "./commun";

/** Fiche d'un avoir : aperçu fidèle au PDF, impression, lien vers la facture et vers l'écriture générée. */
export function FicheAvoir({ id }: { id: string }) {
  const { a } = useSession();
  const toast = useToast();
  const r = useDonnees(() => api.get<Avoir>(`/api/ventes/avoirs/${id}`), [id]);
  if (r.erreur) return <div className="alerte alerte-erreur">{r.erreur} <a href="#/ventes/avoirs">Retour</a></div>;
  if (!r.donnees) return <Chargement />;
  const x = r.donnees;
  const urlPdf = `/api/ventes/avoirs/${id}/pdf`;
  const imprimer = () => {
    if (__DEMO__) { try { window.print(); } catch { toast("Démonstration : l'impression n'est pas disponible ici. Dans le logiciel installé, le PDF s'imprime directement."); } return; }
    imprimerPdf(urlPdf, () => { window.open(urlPdf, "_blank", "noopener"); });
  };
  const traitement = x.remboursement
    ? `remboursé au client : ${formatMontant(x.remboursement.montant)} FCFA (${x.remboursement.compte})${x.remboursement.montant < x.totalTtc ? ` ; le solde vient en déduction de la facture ${x.facture.numero}` : ""}`
    : `vient en déduction de la facture ${x.facture.numero}`;
  // L'aperçu de facture sert aussi pour l'avoir : mêmes en-tête, lignes, totaux et code QR.
  const commeFacture = {
    ...x, typeLibelle: "Facture d'avoir", type: "credit_note", paye: 0, totalAvoirs: 0, tvaAvoirs: 0, reste: 0, statutPaiement: "payee", avoirs: [], reglements: [],
    paiement: "credit", tresorerie: null, note: null,
    lignes: x.lignes.map((l) => ({ ...l, nature: "", quantiteCreditee: 0, montantCredite: 0 })),
  } as Facture;
  return (
    <>
      <div><a href="#/ventes/avoirs" className="btn-lien">← Avoirs</a></div>
      <div className="entete-page">
        <div><h2>Avoir {x.numero}</h2><p className="infos">{x.client.nom} · {dateFr(x.date)} · sur la facture <a href={`#/ventes/factures/${x.facture.id}`}>{x.facture.numero}</a></p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-principal" onClick={imprimer}>🖨 Imprimer l'avoir</button>
          {!__DEMO__ && <a className="btn" href={urlPdf} target="_blank" rel="noopener">Ouvrir le PDF</a>}
        </div>
      </div>
      <div className="deux">
        <ApercuFacture f={commeFacture} avoir={{ facture: x.facture.numero, dateFacture: x.facture.date, motif: x.motif, traitement }} />
        <section className="panneau" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div className="entete-panneau" style={{ margin: 0 }}><h3>Suivi</h3></div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", margin: 0 }}>
            <dt className="discret">Montant</dt><dd style={{ margin: 0 }}><b><Montant v={x.totalTtc} /> FCFA</b></dd>
            <dt className="discret">Remboursé</dt><dd style={{ margin: 0 }}>{x.remboursement ? <><Montant v={x.remboursement.montant} /> FCFA · {x.remboursement.compte} · <span className="num">{x.remboursement.reference}</span></> : "Non (déduit de la facture)"}</dd>
            <dt className="discret">Motif</dt><dd style={{ margin: 0 }}>{x.motif}</dd>
            <dt className="discret">Émis par</dt><dd style={{ margin: 0 }}>{x.auteur} · <span className="num">{dateHeure(x.creeLe)}</span></dd>
            <dt className="discret">Écriture</dt><dd style={{ margin: 0 }}>{x.ecriture ? (x.ecriture.statut === "validee" ? `Validée (n° ${x.ecriture.numero})` : "En attente de validation") : "—"}{x.ecriture && a("accounting.read") && <> · <a href={`#/comptabilite/ecritures/${x.ecriture.id}`}>ouvrir</a></>}</dd>
          </dl>
          <p className="discret" style={{ margin: 0 }}>Un avoir émis ne se modifie pas et ne se supprime pas. Il garde l'en-tête de l'entreprise au jour de son émission.</p>
        </section>
      </div>
    </>
  );
}
