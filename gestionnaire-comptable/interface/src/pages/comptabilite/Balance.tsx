import { usePeriodeImpression } from "../../composants/cadre/etat";
import { Fragment, useState } from "react";
import { api, telecharger } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Chargement, messageErreur, useDonnees, useRetarde, useToast } from "../../composants/ui";
import { FiltresEtats, Montant, dateFr, paramsEtats } from "./commun";

interface LigneBalance { compte: string; libelle: string; classe: number; soldeOuverture: number; mouvementDebit: number; mouvementCredit: number; soldeDebiteur: number; soldeCrediteur: number }
interface BalanceT {
  exercice: { code: string }; du: string; au: string; brouillonsInclus: boolean; lignes: LigneBalance[];
  totaux: { mouvementDebit: number; mouvementCredit: number; soldeDebiteur: number; soldeCrediteur: number };
  comptesMasques: number; complete: boolean; equilibree: boolean; resultat: number | null;
}
const CLASSES = ["", "Ressources durables", "Actif immobilisé", "Stocks", "Tiers", "Trésorerie", "Charges des activités ordinaires", "Produits des activités ordinaires", "Autres charges et autres produits", "Hors bilan"];

export function Balance() {
  const { a } = useSession();
  const toast = useToast();
  const [f, setF] = useState({ exercice: "", du: "", au: "", compte: "", journal: "", brouillons: false });
  const compte = useRetarde(f.compte);
  const params = paramsEtats({ ...f, compte });
  const b = useDonnees(() => api.get<BalanceT>(`/api/comptabilite/balance${params}`), [params]);
  usePeriodeImpression(b.donnees ? `Exercice ${b.donnees.exercice.code} · du ${dateFr(b.donnees.du)} au ${dateFr(b.donnees.au)}${b.donnees.brouillonsInclus ? " · brouillards inclus (document de travail)" : ""}` : null);
  const exporter = async () => {
    if (__DEMO__) return toast("Démonstration : le téléchargement n'est pas disponible dans l'aperçu.");
    try { await telecharger(`/api/comptabilite/balance/export${params}`, "balance.csv"); toast("Balance exportée ; l'export est tracé."); }
    catch (e) { toast(messageErreur(e), true); }
  };
  const parClasse = (l: LigneBalance[]) => {
    const g = new Map<number, LigneBalance[]>();
    for (const x of l) g.set(x.classe, [...(g.get(x.classe) ?? []), x]);
    return [...g.entries()];
  };
  const somme = (l: LigneBalance[], k: keyof LigneBalance) => l.reduce((s, x) => s + (x[k] as number), 0);
  return (
    <>
      <div className="entete-page">
        <div><h2>Balance générale</h2><p>Mouvements et soldes de chaque compte sur la période. Une balance complète est équilibrée : total des débits = total des crédits, total des soldes débiteurs = total des soldes créditeurs.</p></div>
        {a("accounting.export") && <button className="btn" onClick={exporter}>Exporter (CSV)</button>}
      </div>
      <section className="panneau">
        <FiltresEtats f={f} set={(x) => setF({ ...f, ...x })} avecCompte />
        {b.erreur ? <div className="alerte alerte-erreur">{b.erreur}</div> : !b.donnees ? <Chargement /> : (() => {
          const d = b.donnees;
          return (
            <>
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {d.comptesMasques > 0 && <div className="alerte alerte-attention"><b>Balance partielle.</b> {d.comptesMasques} compte(s) protégé(s) sont masqués (banque, personnel, résultat…) : les totaux ci-dessous ne forment pas une balance comptable complète.</div>}
                {d.brouillonsInclus && <div className="alerte alerte-attention">Brouillards inclus : document de travail, non définitif.</div>}
                {d.complete && !d.brouillonsInclus && (d.equilibree
                  ? <div className="alerte alerte-succes">Balance équilibrée : débits = crédits ({<Montant v={d.totaux.mouvementDebit} />} FCFA).</div>
                  : <div className="alerte alerte-erreur" role="alert">Balance déséquilibrée : anomalie à signaler immédiatement.</div>)}
                {d.resultat !== null && <div className="alerte"><b>Résultat de la période</b> (classes 6, 7 et 8) : {d.resultat >= 0 ? "bénéfice" : "perte"} de <b><Montant v={Math.abs(d.resultat)} /> FCFA</b>.</div>}
              </div>
              <p className="discret" style={{ marginTop: 0 }}>Exercice {d.exercice.code} · du {dateFr(d.du)} au {dateFr(d.au)}</p>
              <div className="tableau-conteneur">
                <table>
                  <thead><tr><th>Compte</th><th>Intitulé</th><th className="montant">Mouvements débit</th><th className="montant">Mouvements crédit</th><th className="montant">Solde débiteur</th><th className="montant">Solde créditeur</th></tr></thead>
                  <tbody>
                    {d.lignes.length === 0 && <tr><td colSpan={6} className="vide">Aucun mouvement pour ces critères.</td></tr>}
                    {parClasse(d.lignes).map(([classe, l]) => (
                      <Fragment key={classe}>
                        {l.map((x) => (
                          <tr key={x.compte} className="cliquable" tabIndex={0} title="Voir le grand livre du compte"
                            onClick={() => aller(`/comptabilite/grand-livre?compte=${x.compte}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/comptabilite/grand-livre?compte=${x.compte}`)}>
                            <td className="num"><b>{x.compte}</b></td><td>{x.libelle}</td>
                            <td className="montant"><Montant v={x.mouvementDebit} /></td><td className="montant"><Montant v={x.mouvementCredit} /></td>
                            <td className="montant"><Montant v={x.soldeDebiteur} vide=" " /></td><td className="montant"><Montant v={x.soldeCrediteur} vide=" " /></td>
                          </tr>))}
                        <tr className="sous-total"><td colSpan={2}>Classe {classe} · {CLASSES[classe]}</td>
                          <td className="montant"><Montant v={somme(l, "mouvementDebit")} /></td><td className="montant"><Montant v={somme(l, "mouvementCredit")} /></td>
                          <td className="montant"><Montant v={somme(l, "soldeDebiteur")} /></td><td className="montant"><Montant v={somme(l, "soldeCrediteur")} /></td></tr>
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot><tr><th colSpan={2}>Total {d.complete ? "général" : "(partiel)"}</th>
                    <td className="montant"><Montant v={d.totaux.mouvementDebit} /></td><td className="montant"><Montant v={d.totaux.mouvementCredit} /></td>
                    <td className="montant"><Montant v={d.totaux.soldeDebiteur} /></td><td className="montant"><Montant v={d.totaux.soldeCrediteur} /></td></tr></tfoot>
                </table>
              </div>
            </>
          );
        })()}
      </section>
    </>
  );
}
