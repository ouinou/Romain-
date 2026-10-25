import { useState } from "react";
import { api, qs } from "../api";
import { useSession } from "../session";
import { aller } from "../routeur";
import { Chargement, dateHeure, useDonnees } from "../composants/ui";
import { Icone } from "../assets/icons/Icone";
import { Graphique } from "../composants/Graphique";
import { libelleAction } from "../libelles";
import { Montant, dateFr, formatMontant } from "./comptabilite/commun";
import { BadgePaiement, type FactureResume } from "./ventes/commun";
import { TYPES_TRESORERIE, comptesTresorerie } from "./tresorerie/commun";
import type { Evenement, Page } from "../types";
import type { EcritureResume } from "./comptabilite/commun";

const JOURNAUX: Record<string, string> = { VT: "Ventes", AC: "Achats", BQ: "Banque", CA: "Caisse", OD: "Opérations diverses" };

/**
 * Tableau de bord : synthèse du jour (ventes, encaissements, crédit, trésorerie, brouillards), trésorerie par compte,
 * documents récents, puis les blocs d'administration. Chaque bloc n'apparaît qu'avec la permission correspondante,
 * et tous les chiffres viennent du serveur (aucune donnée inventée).
 */
export function TableauDeBord() {
  const { moi, a } = useSession();
  const aujourdHui = new Date().toLocaleDateString("sv-SE");
  const voitVentes = a("sales.read"), voitTreso = a("treasury.read") || a("cash.read"), voitCompta = a("accounting.read");

  const ventes = useDonnees(async () => {
    if (!voitVentes) return null;
    const [jour, recents] = await Promise.all([
      api.get<{ total: number; totalTtc: number; totalReste: number }>(`/api/ventes/factures${qs({ du: aujourdHui, au: aujourdHui, taille: 1 })}`),
      api.get<Page<FactureResume>>("/api/ventes/factures?taille=6"),
    ]);
    return { jour, recents: recents.elements };
  }, []);
  const treso = useDonnees(async () => {
    if (!voitTreso) return null;
    const [tableau, comptes] = await Promise.all([api.get<{ total: number; entreesJour: number; sortiesJour: number }>("/api/tresorerie/tableau"), comptesTresorerie()]);
    return { tableau, comptes };
  }, []);
  const brouillardsListe = useDonnees(() => (voitCompta ? api.get<Page<EcritureResume>>("/api/comptabilite/ecritures?statut=brouillard&taille=100") : Promise.resolve(null)), []);
  const brouillards = { donnees: brouillardsListe.donnees?.total ?? null };
  // Brouillards regroupés par journal (comme « Brouillards à valider » de la référence) : nombre et montant.
  const parJournal = Object.entries((brouillardsListe.donnees?.elements ?? []).reduce<Record<string, { n: number; montant: number }>>((acc, e) => {
    const k = acc[e.journal] ?? (acc[e.journal] = { n: 0, montant: 0 }); k.n++; k.montant += e.totalDebit; return acc;
  }, {}));
  const evolution = useDonnees(() => (voitVentes || voitTreso
    ? api.get<{ mois: string[]; ventes: number[] | null; encaissements: number[] | null }>("/api/tableau-de-bord/evolution?mois=6") : Promise.resolve(null)), []);
  const [choix, setChoix] = useState<string | null>(null);

  const comptes = useDonnees(async () => {
    if (!a("users.read")) return null;
    const total = (s?: string) => api.get<Page<unknown>>(`/api/utilisateurs${qs({ taille: 1, statut: s })}`).then((r) => r.total);
    const [tous, actifs, invites, desactives] = await Promise.all([total(), total("active"), total("invited"), total("disabled")]);
    return { tous, actifs, invites, desactives };
  }, []);
  const audit = useDonnees(async () => {
    if (!a("audit.read")) return null;
    const [recents, refus, echecs] = await Promise.all([
      api.get<Page<Evenement>>("/api/audit?taille=6"),
      api.get<Page<Evenement>>(`/api/audit${qs({ taille: 1, resultat: "denied", du: aujourdHui })}`),
      api.get<Page<Evenement>>(`/api/audit${qs({ taille: 1, resultat: "failure", type: "auth", du: aujourdHui })}`),
    ]);
    return { recents: recents.elements, refus: refus.total, echecs: echecs.total };
  }, []);

  const synthese = voitVentes || voitTreso || voitCompta;
  const totalComptes = treso.donnees?.comptes.reduce((t, c) => t + c.solde, 0) ?? 0;
  return (
    <>
      <div className="entete-page">
        <div>
          <h2>Bonjour {moi.utilisateur.nom.split(" ")[0]}</h2>
          <p className="infos">{moi.entreprise.raisonSociale} · code {moi.entreprise.code} · {moi.roles.map((r) => r.libelle).join(", ") || "aucun rôle attribué"}</p>
        </div>
        <span className="discret"><Icone nom="calendrier" taille={16} className="en-ligne" /> {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
      </div>

      {!moi.mfa.active && (
        <div className="alerte alerte-attention">La double authentification n'est pas activée sur votre compte. <a href="#/mon-compte">L'activer maintenant</a>.</div>
      )}

      {synthese && (
        <section className="panneau" aria-labelledby="titre-synthese">
          <div className="entete-panneau"><h3 id="titre-synthese">Synthèse du jour · {dateFr(aujourdHui)}</h3></div>
          <div className="indicateurs">
            {voitVentes && <Indicateur icone="ventes" lib="Ventes TTC" val={ventes.donnees?.jour.totalTtc} aide={ventes.donnees ? `${ventes.donnees.jour.total} facture(s) · FCFA` : "FCFA"} lien="/ventes/direct" />}
            {voitTreso && <Indicateur icone="encaissement" lib="Encaissements" val={treso.donnees?.tableau.entreesJour} aide="Entrées du jour · FCFA" lien="/tresorerie/mouvements" />}
            {voitVentes && <Indicateur icone="facture" lib="À crédit" val={ventes.donnees?.jour.totalReste} aide="Ventes du jour non réglées · FCFA" lien="/ventes" accent />}
            {voitTreso && <Indicateur icone="tresorerie" lib="Trésorerie" val={treso.donnees?.tableau.total} aide="Comptes accessibles · FCFA" lien="/tresorerie" />}
            {voitCompta && <Indicateur icone="valider" lib="Brouillards à valider" val={brouillards.donnees ?? undefined} aide="Écritures en attente" lien="/comptabilite/ecritures?statut=brouillard" alerte={!!brouillards.donnees} nombre />}
          </div>
        </section>
      )}

      {(voitTreso || voitVentes || voitCompta) && (
        <div className="grille-tdb">
          {(voitVentes || voitTreso) && (
            <section className="panneau large">
              <div className="entete-panneau"><h3>Évolution des ventes (6 derniers mois)</h3></div>
              {evolution.erreur ? <div className="alerte alerte-erreur">{evolution.erreur}</div> : !evolution.donnees ? <Chargement /> : (
                <Graphique titre="Évolution des ventes sur 6 mois" mois={evolution.donnees.mois} series={[
                  ...(evolution.donnees.ventes ? [{ nom: "Ventes TTC", couleur: "var(--graphique-1)", valeurs: evolution.donnees.ventes }] : []),
                  ...(evolution.donnees.encaissements ? [{ nom: "Encaissements", couleur: "var(--graphique-2)", valeurs: evolution.donnees.encaissements }] : []),
                ]} />)}
            </section>
          )}
          {voitTreso && (
            <section className="panneau">
              <div className="entete-panneau"><h3>Trésorerie par compte</h3><a className="btn btn-petit" href="#/tresorerie">Caisses et banques</a></div>
              {treso.erreur ? <div className="alerte alerte-erreur">{treso.erreur}</div> : !treso.donnees ? <Chargement /> : treso.donnees.comptes.length === 0
                ? <div className="vide">Aucun compte de trésorerie accessible.</div> : (
                <div className="tableau-conteneur">
                  <table>
                    <thead><tr><th>Compte</th><th className="montant">Solde (FCFA)</th><th className="montant">%</th></tr></thead>
                    <tbody>{treso.donnees.comptes.map((c) => (
                      <tr key={c.id}><td title={TYPES_TRESORERIE[c.type]}><Icone nom={c.type === "cash" ? "caisse" : c.type === "bank" ? "banque" : "mobile"} taille={16} className="en-ligne" /> {c.nom}</td>
                        <td className="montant"><Montant v={c.solde} /></td>
                        <td className="montant">{totalComptes > 0 ? `${(c.solde * 100 / totalComptes).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—"}</td></tr>))}
                    </tbody>
                    <tfoot><tr><th>Total</th><th className="montant">{formatMontant(totalComptes)}</th><th className="montant">{totalComptes > 0 ? "100 %" : "—"}</th></tr></tfoot>
                  </table>
                </div>)}
            </section>
          )}
          {voitCompta && (
            <section className="panneau">
              <div className="entete-panneau"><h3>Brouillards à valider{brouillards.donnees ? <span className="badge badge-rouge" style={{ marginLeft: 8 }}>{brouillards.donnees}</span> : null}</h3></div>
              {brouillardsListe.erreur ? <div className="alerte alerte-erreur">{brouillardsListe.erreur}</div> : !brouillardsListe.donnees ? <Chargement /> : parJournal.length === 0
                ? <div className="vide">Aucun brouillard en attente.</div> : (
                <div className="tableau-conteneur">
                  <table>
                    <thead><tr><th>Journal</th><th className="montant">Nombre</th><th className="montant">Montant (FCFA)</th></tr></thead>
                    <tbody>{parJournal.map(([j, v]) => <tr key={j}><td>{JOURNAUX[j] ?? j}</td><td className="montant">{v.n}</td><td className="montant"><Montant v={v.montant} /></td></tr>)}</tbody>
                  </table>
                </div>)}
              <div style={{ textAlign: "right", marginTop: 8 }}><a href="#/comptabilite/ecritures?statut=brouillard">Voir tout →</a></div>
            </section>
          )}
        </div>
      )}

      {voitVentes && (
        <div className="grille-tdb bas">
          <section className="panneau">
            <div className="entete-panneau"><h3>Documents récents</h3><a className="btn btn-petit" href="#/ventes">Toutes les factures</a></div>
            {ventes.erreur ? <div className="alerte alerte-erreur">{ventes.erreur}</div> : !ventes.donnees ? <Chargement /> : ventes.donnees.recents.length === 0
              ? <div className="vide">Aucune facture pour l'instant.</div> : (
              <div className="tableau-conteneur">
                <table>
                  <thead><tr><th>Date</th><th>Type</th><th>Référence</th><th>Client</th><th className="montant">Montant (FCFA)</th><th>Statut</th></tr></thead>
                  <tbody>{ventes.donnees.recents.map((f) => (
                    <tr key={f.id} className={"cliquable" + ((choix ?? ventes.donnees!.recents[0].id) === f.id ? " selectionnee" : "")} tabIndex={0}
                      onClick={() => setChoix(f.id)} onFocus={() => setChoix(f.id)} onDoubleClick={() => aller(`/ventes/factures/${f.id}`)}
                      onKeyDown={(k) => k.key === "Enter" && aller(`/ventes/factures/${f.id}`)}>
                      <td className="num">{dateFr(f.date)}</td><td>Facture</td><td className="num"><b>{f.numero}</b></td><td>{f.client}</td>
                      <td className="montant"><Montant v={f.totalTtc} /></td><td><BadgePaiement s={f.statutPaiement} /></td>
                    </tr>))}
                  </tbody>
                </table>
              </div>)}
          </section>
          {ventes.donnees && ventes.donnees.recents.length > 0 && (() => {
            const f = ventes.donnees.recents.find((x) => x.id === choix) ?? ventes.donnees.recents[0];
            return (
              <section className="panneau detail-selection" aria-live="polite">
                <div className="entete-panneau"><h3>Détail de la sélection</h3></div>
                <dl>
                  <dt>Facture n°</dt><dd className="num">{f.numero}</dd>
                  <dt>Client</dt><dd>{f.client}</dd>
                  <dt>Date</dt><dd className="num">{dateFr(f.date)}</dd>
                  <dt>Montant HT</dt><dd className="num"><Montant v={f.totalHt} /></dd>
                  <dt>TVA</dt><dd className="num"><Montant v={f.totalTva} /></dd>
                  <dt>Reste dû</dt><dd className="num"><Montant v={f.reste} /></dd>
                </dl>
                <div className="net"><span>Net à payer</span><span className="num">{formatMontant(f.totalTtc)} FCFA</span></div>
                <div style={{ marginTop: 8 }}><a className="btn btn-petit" href={`#/ventes/factures/${f.id}`}>Ouvrir la facture</a></div>
              </section>
            );
          })()}
        </div>
      )}

      {comptes.donnees && (
        <section className="indicateurs" aria-label="Comptes utilisateurs">
          <Indicateur icone="utilisateurs" lib="Comptes" val={comptes.donnees.tous} aide="Toutes les personnes enregistrées" lien="/utilisateurs" nombre />
          <Indicateur icone="valider" lib="Actifs" val={comptes.donnees.actifs} aide="Peuvent se connecter" nombre />
          <Indicateur icone="nouvelutilisateur" lib="Invitations en attente" val={comptes.donnees.invites} aide="Compte pas encore activé" nombre />
          <Indicateur icone="quitter" lib="Désactivés" val={comptes.donnees.desactives} aide="Accès coupé" nombre />
        </section>
      )}
      {audit.donnees && (
        <section className="indicateurs" aria-label="Sécurité du jour">
          <Indicateur icone="roles" lib="Accès refusés aujourd'hui" val={audit.donnees.refus} aide="Tentatives hors des droits" alerte={audit.donnees.refus > 0} lien="/journal" nombre />
          <Indicateur icone="alerte" lib="Échecs de connexion aujourd'hui" val={audit.donnees.echecs} aide="Mot de passe ou code incorrect" alerte={audit.donnees.echecs >= 5} lien="/journal" nombre />
        </section>
      )}
      {a("audit.read") && (
        <section className="panneau">
          <div className="entete-panneau"><h3>Activité récente</h3><a className="btn btn-petit" href="#/journal">Voir le journal</a></div>
          {audit.erreur ? <div className="alerte alerte-erreur">{audit.erreur}</div> : !audit.donnees ? <Chargement /> :
            <div className="liste-evts">
              {audit.donnees.recents.map((e) => (
                <div className="evt" key={e.id}>
                  <div className={"pastille" + (e.resultat === "denied" ? " refus" : e.resultat === "failure" ? " echec" : "")} aria-hidden="true">{e.resultat === "success" ? "✓" : "!"}</div>
                  <div><b>{libelleAction(e.type, e.action, e.resultat)}</b><p>{e.acteur ?? "Système"} · <span className="num">{dateHeure(e.date)}</span></p></div>
                </div>
              ))}
            </div>}
        </section>
      )}
      {!synthese && !a("users.read") && !a("audit.read") && (
        <section className="panneau"><p style={{ margin: 0 }}>Aucun module n'est ouvert à votre rôle pour l'instant. Votre administrateur peut vous attribuer les droits nécessaires.</p></section>
      )}
    </>
  );
}

function Indicateur({ icone, lib, val, aide, alerte, accent, lien, nombre }: {
  icone: string; lib: string; val: number | undefined; aide: string; alerte?: boolean; accent?: boolean; lien?: string; nombre?: boolean;
}) {
  const contenu = <>
    <Icone nom={icone} taille={30} className="icone-ind" />
    <div className="lib">{lib}</div>
    <div className="val">{val === undefined ? "…" : nombre ? val : <Montant v={val} />}</div>
    <div className="aide">{aide}</div>
  </>;
  const classe = "indicateur" + (alerte ? " alerte-ind" : accent ? " accent-ind" : "");
  return lien
    ? <a className={classe + " indicateur-lien"} href={"#" + lien}>{contenu}</a>
    : <div className={classe}>{contenu}</div>;
}
