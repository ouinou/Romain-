import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { Chargement, dateHeure, useDonnees, useToast } from "../../composants/ui";
import { Montant, dateFr, formatMontant } from "../comptabilite/commun";
import { montantEnLettres } from "../../lettres";
import { OperationModale } from "../tresorerie/OperationModale";
import { comptesTresorerie, type CompteTresorerie } from "../tresorerie/commun";
import { BadgePaiement, tauxTexte, type Facture } from "./commun";

/** Impression directe : le PDF est chargé dans un cadre invisible de la même origine, puis la boîte d'impression s'ouvre. */
function imprimerPdf(url: string, surErreur: () => void) {
  document.getElementById("cadre-impression")?.remove();
  const cadre = document.createElement("iframe");
  cadre.id = "cadre-impression";
  cadre.style.position = "fixed"; cadre.style.width = "0"; cadre.style.height = "0"; cadre.style.border = "0"; cadre.style.right = "0"; cadre.style.bottom = "0";
  cadre.src = url;
  cadre.onload = () => { try { cadre.contentWindow?.focus(); cadre.contentWindow?.print(); } catch { surErreur(); } };
  document.body.appendChild(cadre);
}

export function FicheFacture({ id }: { id: string }) {
  const { a } = useSession();
  const toast = useToast();
  const f = useDonnees(() => api.get<Facture>(`/api/ventes/factures/${id}`), [id]);
  const [reglement, setReglement] = useState<CompteTresorerie[] | null>(null);
  const dejaImprime = useRef(false);
  const urlPdf = `/api/ventes/factures/${id}/pdf`;
  const imprimer = () => {
    // Démonstration hors serveur : pas de PDF, on imprime l'aperçu HTML (feuille de style d'impression dédiée).
    if (__DEMO__) { try { window.print(); } catch { toast("Démonstration : l'impression n'est pas disponible ici. Dans le logiciel installé, le PDF s'imprime directement."); } return; }
    imprimerPdf(urlPdf, () => { window.open(urlPdf, "_blank", "noopener"); });
  };
  // Après l'émission d'une vente (#…?imprimer=1), proposer l'impression immédiatement.
  useEffect(() => {
    if (f.donnees && !dejaImprime.current && location.hash.includes("imprimer=1")) { dejaImprime.current = true; history.replaceState(null, "", `#/ventes/factures/${id}`); }
  }, [f.donnees, id]);
  if (f.erreur) return <div className="alerte alerte-erreur">{f.erreur} <a href="#/ventes">Retour</a></div>;
  if (!f.donnees) return <Chargement />;
  const x = f.donnees;
  const vientDEtreEmise = dejaImprime.current;
  const peutRegler = x.reste > 0 && (a("treasury.create") || a("cash.create"));
  return (
    <>
      <div><a href="#/ventes" className="btn-lien">← Ventes et factures</a></div>
      <div className="entete-page">
        <div><h2>Facture {x.numero}</h2><p>{x.client.nom} · {dateFr(x.date)} · <BadgePaiement s={x.statutPaiement} /></p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-principal" onClick={imprimer}>🖨 Imprimer la facture</button>
          {!__DEMO__ && <a className="btn" href={urlPdf} target="_blank" rel="noopener">Ouvrir le PDF</a>}
          {peutRegler && <button className="btn" onClick={() => comptesTresorerie().then(setReglement)}>Enregistrer un règlement</button>}
        </div>
      </div>
      {vientDEtreEmise && <div className="alerte alerte-succes">Facture émise. Cliquez sur « Imprimer la facture » pour la remettre au client.</div>}
      <div className="deux">
        <ApercuFacture f={x} />
        <section className="panneau" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div className="entete-panneau" style={{ margin: 0 }}><h3>Suivi</h3></div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", margin: 0 }}>
            <dt className="discret">Total TTC</dt><dd style={{ margin: 0 }}><b><Montant v={x.totalTtc} /> FCFA</b></dd>
            <dt className="discret">Déjà réglé</dt><dd style={{ margin: 0 }}><Montant v={x.paye} /> FCFA</dd>
            <dt className="discret">Reste dû</dt><dd style={{ margin: 0 }}><b><Montant v={x.reste} /> FCFA</b></dd>
            <dt className="discret">Émise par</dt><dd style={{ margin: 0 }}>{x.auteur} · <span className="num">{dateHeure(x.creeLe)}</span></dd>
            <dt className="discret">Écriture</dt><dd style={{ margin: 0 }}>{x.ecriture ? (x.ecriture.statut === "validee" ? `Validée (n° ${x.ecriture.numero})` : "En attente de validation") : "—"}{x.ecriture && a("accounting.read") && <> · <a href={`#/comptabilite/ecritures/${x.ecriture.id}`}>ouvrir</a></>}</dd>
          </dl>
          <h3 style={{ margin: "8px 0 0" }}>Règlements</h3>
          {x.reglements.length === 0 ? <p className="discret" style={{ margin: 0 }}>Aucun règlement enregistré.</p> : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>{x.reglements.map((r) => <li key={r.id}>{dateFr(r.date)} · {r.compte} · <b><Montant v={r.montant} /></b> FCFA · <span className="num" style={{ whiteSpace: "nowrap" }}>{r.reference}</span></li>)}</ul>
          )}
          <p className="discret" style={{ margin: 0 }}>Une facture émise ne se modifie pas. Une erreur se corrige par un avoir (fonction à venir).</p>
        </section>
      </div>
      {reglement && <OperationModale type="entree" comptes={reglement} onFermer={() => setReglement(null)} onFin={f.recharger} />}
    </>
  );
}

/** Aperçu à l'écran, fidèle au contenu du PDF. */
export function ApercuFacture({ f }: { f: Facture }) {
  const devise = f.devise === "XAF" ? "FCFA" : f.devise;
  return (
    <article className="panneau apercu-facture" aria-label={`Aperçu de la facture ${f.numero}`} style={{ borderTop: "6px solid var(--cyan)", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 16 }}>{f.vendeur.raisonSociale}</b>
          <div className="discret" style={{ fontSize: 12, display: "grid" }}>
            {f.vendeur.adresse && <span>{f.vendeur.adresse}</span>}{f.vendeur.telephone && <span>Tél. : {f.vendeur.telephone}</span>}
            {f.vendeur.niu && <span>NIU : {f.vendeur.niu}</span>}{f.vendeur.rccm && <span>RCCM : {f.vendeur.rccm}</span>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--marine)" }}>FACTURE</div>
          <div style={{ fontWeight: 800, color: "var(--lien)" }}>N° {f.numero}</div>
          <div className="discret" style={{ fontSize: 12 }}>Date : {dateFr(f.date)}<br />{f.typeLibelle}</div>
        </div>
      </div>
      <div style={{ justifySelf: "end", border: "1px solid var(--ligne)", borderRadius: 8, padding: "10px 12px", minWidth: "min(280px, 100%)" }}>
        <div className="discret" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>FACTURÉ À</div>
        <b>{f.client.nom}</b>
        <div className="discret" style={{ fontSize: 12, display: "grid" }}>
          {f.client.adresse && <span>{f.client.adresse}</span>}{f.client.telephone && <span>Tél. : {f.client.telephone}</span>}{f.client.niu && <span>NIU : {f.client.niu}</span>}
        </div>
      </div>
      <div className="tableau-conteneur">
        <table>
          <thead><tr><th>Désignation</th><th className="montant">Quantité</th><th className="montant">Prix unitaire</th><th className="montant">Montant ({devise})</th></tr></thead>
          <tbody>{f.lignes.map((l) => (
            <tr key={l.ordre}><td>{l.designation}</td><td className="montant">{l.quantite.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}</td>
              <td className="montant"><Montant v={l.prixUnitaire} /></td><td className="montant"><Montant v={l.montant} /></td></tr>))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total hors taxes</td><td className="montant"><Montant v={f.totalHt} /></td></tr>
            <tr><td colSpan={3}>{f.tauxTvaPdm ? `TVA (${tauxTexte(f.tauxTvaPdm)})` : "TVA"}</td><td className="montant">{f.tauxTvaPdm ? <Montant v={f.totalTva} /> : "Non applicable"}</td></tr>
            <tr className="net-a-payer"><th colSpan={3}>Net à payer ({devise})</th><th className="montant">{formatMontant(f.totalTtc)}</th></tr>
          </tfoot>
        </table>
      </div>
      <p style={{ margin: 0 }}>Arrêtée la présente facture à la somme de : <b>{montantEnLettres(f.totalTtc)}</b>.</p>
      <p className="discret" style={{ margin: 0 }}>Règlement : {f.paiement === "comptant" ? `comptant${f.tresorerie ? ` (${f.tresorerie})` : ""}` : f.reste <= 0 ? "réglée" : "à crédit"}{f.note ? ` · Observation : ${f.note}` : ""}</p>
    </article>
  );
}
