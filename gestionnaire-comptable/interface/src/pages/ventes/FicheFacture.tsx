import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { Chargement, dateHeure, useDonnees, useToast } from "../../composants/ui";
import { Montant, dateFr, formatMontant } from "../comptabilite/commun";
import { montantEnLettres } from "../../lettres";
import { OperationModale } from "../tresorerie/OperationModale";
import { comptesTresorerie, type CompteTresorerie } from "../tresorerie/commun";
import { BadgePaiement, tauxTexte, type Facture } from "./commun";
import { ModaleAvoir } from "./ModaleAvoir";
import { aller } from "../../routeur";
import { QrCode } from "../../composants/QrCode";
import { assombrirPour, contraste, COULEURS_DEFAUT } from "../../theme";

/** Impression directe : le PDF est chargé dans un cadre invisible de la même origine, puis la boîte d'impression s'ouvre. */
export function imprimerPdf(url: string, surErreur: () => void) {
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
  const [avoir, setAvoir] = useState(false);
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
  const peutCrediter = a("sales.cancel") && x.totalAvoirs < x.totalTtc;
  return (
    <>
      <div><a href="#/ventes" className="btn-lien">← Ventes et factures</a></div>
      <div className="entete-page">
        <div><h2>Facture {x.numero}</h2><p className="infos">{x.client.nom} · {dateFr(x.date)} · <BadgePaiement s={x.statutPaiement} /></p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-principal" onClick={imprimer}>🖨 Imprimer la facture</button>
          {!__DEMO__ && <a className="btn" href={urlPdf} target="_blank" rel="noopener">Ouvrir le PDF</a>}
          {peutRegler && <button className="btn" onClick={() => comptesTresorerie().then(setReglement)}>Enregistrer un règlement</button>}
          {peutCrediter && <button className="btn" onClick={() => setAvoir(true)}>Établir un avoir</button>}
        </div>
      </div>
      {vientDEtreEmise && <div className="alerte alerte-succes">Facture émise. Cliquez sur « Imprimer la facture » pour la remettre au client.</div>}
      <div className="deux">
        <ApercuFacture f={x} />
        <section className="panneau" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div className="entete-panneau" style={{ margin: 0 }}><h3>Suivi</h3></div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", margin: 0 }}>
            <dt className="discret">Total TTC</dt><dd style={{ margin: 0 }}><b><Montant v={x.totalTtc} /> FCFA</b></dd>
            {x.totalAvoirs > 0 && <><dt className="discret">Avoirs</dt><dd style={{ margin: 0 }}><Montant v={-x.totalAvoirs} /> FCFA</dd></>}
            <dt className="discret">Déjà réglé</dt><dd style={{ margin: 0 }}><Montant v={x.paye} /> FCFA</dd>
            <dt className="discret">{x.reste < 0 ? "En faveur du client" : "Reste dû"}</dt><dd style={{ margin: 0 }}><b><Montant v={Math.abs(x.reste)} /> FCFA</b></dd>
            <dt className="discret">Émise par</dt><dd style={{ margin: 0 }}>{x.auteur} · <span className="num">{dateHeure(x.creeLe)}</span></dd>
            <dt className="discret">Écriture</dt><dd style={{ margin: 0 }}>{x.ecriture ? (x.ecriture.statut === "validee" ? `Validée (n° ${x.ecriture.numero})` : "En attente de validation") : "—"}{x.ecriture && a("accounting.read") && <> · <a href={`#/comptabilite/ecritures/${x.ecriture.id}`}>ouvrir</a></>}</dd>
          </dl>
          <h3 style={{ margin: "8px 0 0" }}>Règlements</h3>
          {x.reglements.length === 0 ? <p className="discret" style={{ margin: 0 }}>Aucun règlement enregistré.</p> : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>{x.reglements.map((r) => <li key={r.id}>{dateFr(r.date)} · {r.compte} · <b><Montant v={r.montant} /></b> FCFA · <span className="num" style={{ whiteSpace: "nowrap" }}>{r.reference}</span></li>)}</ul>
          )}
          <h3 style={{ margin: "8px 0 0" }}>Avoirs</h3>
          {x.avoirs.length === 0 ? <p className="discret" style={{ margin: 0 }}>Aucun avoir.</p> : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>{x.avoirs.map((v) => <li key={v.id}><a href={`#/ventes/avoirs/${v.id}`} className="num">{v.numero}</a> · {dateFr(v.date)} · <b><Montant v={v.totalTtc} /></b> FCFA · {v.motif}</li>)}</ul>
          )}
          <p className="discret" style={{ margin: 0 }}>Une facture émise ne se modifie pas. Une erreur se corrige par un avoir{a("sales.cancel") ? "" : " (réservé aux personnes autorisées, en général le directeur financier)"}.</p>
        </section>
      </div>
      {avoir && <ModaleAvoir facture={x} onFermer={() => setAvoir(false)} onFin={(r) => { setAvoir(false); aller(`/ventes/avoirs/${r.id}`); }} />}
      {reglement && <OperationModale type="entree" comptes={reglement} onFermer={() => setReglement(null)} onFin={f.recharger} />}
    </>
  );
}

/** Aperçu à l'écran, fidèle au contenu du PDF. */
export function ApercuFacture({ f, avoir }: { f: Facture; avoir?: { facture: string; dateFacture: string; motif: string; traitement: string } }) {
  const nom = avoir ? "avoir" : "facture";
  const devise = f.devise === "XAF" ? "FCFA" : f.devise;
  const v = f.vendeur;
  // Couleurs figées sur la facture (celles de l'entreprise le jour de l'émission), comme sur le PDF.
  const c = v.couleurs ?? COULEURS_DEFAUT;
  const titre = assombrirPour(c.principale, "#ffffff", 4.5), numero = assombrirPour(c.accent, "#ffffff", 4.5);
  const surEntete = contraste(c.principale, "#ffffff") >= contraste(c.principale, "#17263b") ? "#ffffff" : "#17263b";
  return (
    <article className="panneau apercu-facture" aria-label={`Aperçu ${avoir ? "de l'avoir" : "de la facture"} ${f.numero}`}
      style={{ borderTop: `6px solid ${c.accent}`, display: "grid", gap: 16, ["--entete-facture" as string]: c.principale, ["--texte-entete-facture" as string]: surEntete }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, display: "flex", gap: 12, alignItems: "flex-start" }}>
          {v.logoUrl && <img src={v.logoUrl} alt="" style={{ width: 72, height: 72, objectFit: "contain", flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 16, color: titre }}>{v.raisonSociale}</b>
            <div className="discret" style={{ fontSize: 12, display: "grid" }}>
              {[v.adresse, v.telephone && `Tél. : ${v.telephone}`, v.email, v.niu && `NIU : ${v.niu}`, v.rccm && `RCCM : ${v.rccm}`,
                v.regimeFiscal && `Régime fiscal : ${v.regimeFiscal}`, v.patente && `Patente : ${v.patente}`].filter(Boolean).map((l) => <span key={String(l)}>{l}</span>)}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: titre }}>{nom.toUpperCase()}</div>
          <div style={{ fontWeight: 800, color: numero }}>N° {f.numero}</div>
          <div className="discret" style={{ fontSize: 12 }}>Date : {dateFr(f.date)}<br />{f.typeLibelle}{avoir && <><br /><b style={{ color: "var(--noir)" }}>Sur la facture {avoir.facture} du {dateFr(avoir.dateFacture)}</b></>}</div>
        </div>
      </div>
      <div style={{ justifySelf: "end", border: "1px solid var(--ligne)", borderRadius: 8, padding: "10px 12px", minWidth: "min(280px, 100%)" }}>
        <div className="discret" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>{avoir ? "CLIENT" : "FACTURÉ À"}</div>
        <b>{f.client.nom}</b>
        <div className="discret" style={{ fontSize: 12, display: "grid" }}>
          {f.client.adresse && <span>{f.client.adresse}</span>}{f.client.telephone && <span>Tél. : {f.client.telephone}</span>}{f.client.niu && <span>NIU : {f.client.niu}</span>}
        </div>
      </div>
      <div className="tableau-conteneur">
        <table className="table-facture">
          <thead><tr><th>Désignation</th><th className="montant">Quantité</th><th className="montant">Prix unitaire</th><th className="montant">Montant ({devise})</th></tr></thead>
          <tbody>{f.lignes.map((l) => (
            <tr key={l.ordre}><td>{l.designation}</td><td className="montant">{l.quantite.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}</td>
              <td className="montant"><Montant v={l.prixUnitaire} /></td><td className="montant"><Montant v={l.montant} /></td></tr>))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total hors taxes</td><td className="montant"><Montant v={f.totalHt} /></td></tr>
            <tr><td colSpan={3}>{f.tauxTvaPdm ? `TVA (${tauxTexte(f.tauxTvaPdm)})` : "TVA"}</td><td className="montant">{f.tauxTvaPdm ? <Montant v={f.totalTva} /> : "Non applicable"}</td></tr>
            <tr className="net-a-payer"><th colSpan={3}>{avoir ? "Montant de l'avoir" : "Net à payer"} ({devise})</th><th className="montant">{formatMontant(f.totalTtc)}</th></tr>
          </tfoot>
        </table>
      </div>
      {f.codeVerification && (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 96, flexShrink: 0 }}><QrCode texte={f.codeVerification} titre={`Code de vérification ${avoir ? "de l'avoir" : "de la facture"} ${f.numero}`} /></div>
          <span className="aide">Code de vérification : scannez-le dans FINEXA ERP (« Vérifier une facture ») pour contrôler l'authenticité de ce document.</span>
        </div>)}
      <p style={{ margin: 0 }}>{avoir ? "Arrêté le présent avoir" : "Arrêtée la présente facture"} à la somme de : <b>{montantEnLettres(f.totalTtc)}</b>.</p>
      {avoir ? <>
        <p style={{ margin: 0 }}><b>Motif : {avoir.motif}</b></p>
        <p className="discret" style={{ margin: 0 }}>Traitement : {avoir.traitement}</p>
      </> : <p className="discret" style={{ margin: 0 }}>Règlement : {f.paiement === "comptant" ? `comptant${f.tresorerie ? ` (${f.tresorerie})` : ""}` : f.reste <= 0 ? "réglée" : "à crédit"}{f.note ? ` · Observation : ${f.note}` : ""}</p>}
    </article>
  );
}
