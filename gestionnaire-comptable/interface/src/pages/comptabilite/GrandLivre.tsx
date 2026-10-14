import { useState } from "react";
import { api, telecharger } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Chargement, messageErreur, useDonnees, useRetarde, useToast } from "../../composants/ui";
import { FiltresEtats, Montant, dateFr, paramsEtats } from "./commun";

interface Mouvement { ecritureId: string; date: string; journal: string; numero: number | null; statut: string; piece: string; libelle: string; debit: number; credit: number; solde: number }
interface GL {
  exercice: { code: string; debut: string; fin: string }; du: string; au: string; comptesMasques: number;
  comptes: { id: string; compte: string; libelle: string; soldeOuverture: number; mouvements: Mouvement[]; totalDebit: number; totalCredit: number; soldeCloture: number }[];
  totaux: { debit: number; credit: number };
}

const Solde = ({ v }: { v: number }) => <>{v === 0 ? "0" : <><Montant v={Math.abs(v)} /> {v > 0 ? "D" : "C"}</>}</>;

export function GrandLivre() {
  const { a } = useSession();
  const toast = useToast();
  // Compte initial éventuel (lien depuis la balance) : #/comptabilite/grand-livre?compte=605
  const compteInitial = new URLSearchParams(location.hash.split("?")[1] ?? "").get("compte")?.replace(/\D/g, "") ?? "";
  const [f, setF] = useState({ exercice: "", du: "", au: "", compte: compteInitial, journal: "", brouillons: false });
  const compte = useRetarde(f.compte);
  const params = paramsEtats({ ...f, compte });
  const gl = useDonnees(() => api.get<GL>(`/api/comptabilite/grand-livre${params}`), [params]);
  const exporter = async () => {
    if (__DEMO__) return toast("Démonstration : le téléchargement n'est pas disponible dans l'aperçu.");
    try { await telecharger(`/api/comptabilite/grand-livre/export${params}`, "grand-livre.csv"); toast("Grand livre exporté ; l'export est tracé."); }
    catch (e) { toast(messageErreur(e), true); }
  };
  return (
    <>
      <div className="entete-page">
        <div><h2>Grand livre</h2><p>Mouvements par compte, avec le solde au début de la période, le solde progressif et le solde final. Par défaut, seules les écritures validées sont prises en compte.</p></div>
        {a("accounting.export") && <button className="btn" onClick={exporter}>Exporter (CSV)</button>}
      </div>
      <section className="panneau">
        <FiltresEtats f={f} set={(x) => setF({ ...f, ...x })} avecCompte />
        {gl.donnees && gl.donnees.comptesMasques > 0 && <div className="alerte" style={{ marginBottom: 12 }}>{gl.donnees.comptesMasques} compte(s) protégé(s) ne sont pas affichés : vous n'avez pas la permission de les consulter.</div>}
        {gl.erreur ? <div className="alerte alerte-erreur">{gl.erreur}</div> : !gl.donnees ? <Chargement /> : gl.donnees.comptes.length === 0 ? <div className="vide">Aucun mouvement pour ces critères.</div> : (
          <>
            <p className="discret" style={{ marginTop: 0 }}>Exercice {gl.donnees.exercice.code} · du {dateFr(gl.donnees.du)} au {dateFr(gl.donnees.au)} · {gl.donnees.comptes.length} compte(s)</p>
            {gl.donnees.comptes.map((c) => (
              <div className="bloc-compte" key={c.id}>
                <h4><span><span className="num">{c.compte}</span> · {c.libelle}</span><span className="num">Solde final : <Solde v={c.soldeCloture} /></span></h4>
                <div className="tableau-conteneur" style={{ border: 0, borderRadius: 0 }}>
                  <table>
                    <thead><tr><th>Date</th><th>Journal</th><th>N°</th><th>Pièce</th><th>Libellé</th><th className="montant">Débit</th><th className="montant">Crédit</th><th className="montant">Solde</th></tr></thead>
                    <tbody>
                      <tr className="ligne-ouverture"><td className="num">{dateFr(gl.donnees!.du)}</td><td colSpan={4}>Solde au début de la période</td><td></td><td></td><td className="montant"><Solde v={c.soldeOuverture} /></td></tr>
                      {c.mouvements.map((m, i) => (
                        <tr key={i} className="cliquable" tabIndex={0} onClick={() => aller(`/comptabilite/ecritures/${m.ecritureId}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/comptabilite/ecritures/${m.ecritureId}`)}>
                          <td className="num">{dateFr(m.date)}</td><td><span className="etiquette-journal">{m.journal}</span></td>
                          <td className="num">{m.numero ?? <span className="badge badge-orange">Brouillard</span>}</td><td>{m.piece}</td><td>{m.libelle}</td>
                          <td className="montant"><Montant v={m.debit} vide=" " /></td><td className="montant"><Montant v={m.credit} vide=" " /></td><td className="montant"><Solde v={m.solde} /></td>
                        </tr>))}
                    </tbody>
                    <tfoot><tr><th colSpan={5}>Total des mouvements</th><td className="montant"><Montant v={c.totalDebit} /></td><td className="montant"><Montant v={c.totalCredit} /></td><td className="montant"><Solde v={c.soldeCloture} /></td></tr></tfoot>
                  </table>
                </div>
              </div>
            ))}
            <div className="totaux-saisie"><span>Total débit : <b><Montant v={gl.donnees.totaux.debit} /></b></span><span>Total crédit : <b><Montant v={gl.donnees.totaux.credit} /></b></span></div>
          </>
        )}
      </section>
    </>
  );
}
