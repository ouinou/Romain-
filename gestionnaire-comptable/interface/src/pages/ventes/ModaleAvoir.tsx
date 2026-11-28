import { useEffect, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { Champ, Modale, Selection, messageErreur, useToast } from "../../composants/ui";
import { formatMontant } from "../comptabilite/commun";
import { comptesTresorerie, type CompteTresorerie } from "../tresorerie/commun";
import type { Avoir, Facture } from "./commun";

const q3 = (q: number) => q.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
/** Saisie « 1,5 » ou « 1.5 » ; NaN si invalide. */
const lireQuantite = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(/\s/g, "").replace(",", ".")));

/**
 * Émission d'un avoir sur une facture : on choisit les lignes et les quantités à créditer (retour, erreur de prix
 * ou de quantité, annulation). Les montants affichés sont une estimation ; le serveur refait le calcul exact
 * (même prix unitaire, même taux de TVA, la ligne qui solde reprend exactement le montant restant).
 */
export function ModaleAvoir({ facture: f, onFermer, onFin }: { facture: Facture; onFermer: () => void; onFin: (a: Avoir) => void }) {
  const { a } = useSession();
  const toast = useToast();
  const restant = (l: Facture["lignes"][number]) => Math.round((l.quantite - l.quantiteCreditee) * 1000) / 1000;
  const [quantites, setQuantites] = useState<Record<number, string>>({});
  const [motif, setMotif] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [comptes, setComptes] = useState<CompteTresorerie[]>([]);
  const [rembourser, setRembourser] = useState(false);
  const [compte, setCompte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const peutRembourser = a("treasury.create") || a("cash.create");
  useEffect(() => {
    if (!peutRembourser) return;
    comptesTresorerie().then((c) => { const actifs = c.filter((x) => x.actif); setComptes(actifs); setCompte(actifs[0]?.id ?? ""); }).catch(() => {});
  }, [peutRembourser]);

  // Estimation des montants (le serveur fait foi).
  const lignes = f.lignes.map((l) => {
    const q = lireQuantite(quantites[l.ordre] ?? ""), r = restant(l);
    const solde = q > 0 && Math.abs(q - r) < 1e-9;
    return { ...l, q, r, invalide: Number.isNaN(q) || q < 0 || q > r + 1e-9, montant: q > 0 ? (solde ? l.montant - l.montantCredite : Math.round(q * l.prixUnitaire)) : 0, solde };
  });
  const choisies = lignes.filter((l) => l.q > 0 && !l.invalide);
  const ht = choisies.reduce((s, l) => s + l.montant, 0);
  const toutSolde = lignes.every((l) => l.r === 0 || l.solde);
  // L'avoir qui solde toute la facture reprend la TVA restante ; sinon TVA = HT × taux (arrondi à l'unité).
  const tva = toutSolde ? f.totalTva - f.tvaAvoirs : Math.round((ht * f.tauxTvaPdm) / 10000);
  const ttc = ht + tva;
  const tropPercu = Math.max(0, Math.min(ttc, f.paye - (f.totalTtc - f.totalAvoirs - ttc)));
  useEffect(() => { if (tropPercu <= 0) setRembourser(false); }, [tropPercu]);

  const toutCrediter = () => setQuantites(Object.fromEntries(f.lignes.filter((l) => restant(l) > 0).map((l) => [l.ordre, q3(restant(l))])));
  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    if (lignes.some((l) => l.invalide)) return setErreur("Une quantité dépasse ce qui reste à créditer ou n'est pas un nombre.");
    if (!choisies.length) return setErreur("Indiquez la quantité à créditer sur au moins une ligne.");
    if (motif.trim().length < 3) return setErreur("Indiquez le motif de l'avoir.");
    setEnvoi(true);
    try {
      const r = await api.post<Avoir>(`/api/ventes/factures/${f.id}/avoirs`, {
        date, motif: motif.trim(), lignes: choisies.map((l) => ({ ordre: l.ordre, quantite: l.q })),
        ...(rembourser && compte ? { rembourser: { compteTresorerieId: compte } } : {}),
      });
      toast(`Avoir ${r.numero} émis${r.remboursement ? `, ${formatMontant(r.remboursement.montant)} FCFA remboursés` : ""}. L'écriture attend la validation du comptable.`);
      onFin(r);
    } catch (err) { setErreur(messageErreur(err)); } finally { setEnvoi(false); }
  };

  return (
    <Modale titre={`Avoir sur la facture ${f.numero}`} onFermer={onFermer} large>
      <form onSubmit={envoyer} style={{ display: "grid", gap: 12 }}>
        <p className="discret" style={{ margin: 0 }}>La facture reste intacte. L'avoir porte son propre numéro, cite la facture et la réduit du montant crédité.</p>
        <div className="tableau-conteneur">
          <table>
            <thead><tr><th>Désignation</th><th className="montant">Facturé</th><th className="montant">Déjà crédité</th><th className="montant">Prix unitaire</th><th className="montant">À créditer</th><th className="montant">Montant HT</th></tr></thead>
            <tbody>{lignes.map((l) => (
              <tr key={l.ordre}>
                <td>{l.designation}</td><td className="montant">{q3(l.quantite)}</td><td className="montant">{l.quantiteCreditee ? q3(l.quantiteCreditee) : "—"}</td>
                <td className="montant">{formatMontant(l.prixUnitaire)}</td>
                <td className="montant">{l.r > 0
                  ? <input aria-label={`Quantité à créditer : ${l.designation}`} inputMode="decimal" style={{ width: 90, textAlign: "right" }} placeholder={`max ${q3(l.r)}`}
                      aria-invalid={l.invalide || undefined} value={quantites[l.ordre] ?? ""} onChange={(e) => setQuantites({ ...quantites, [l.ordre]: e.target.value })} />
                  : <span className="discret">soldée</span>}</td>
                <td className="montant">{l.montant ? formatMontant(l.montant) : "—"}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
        <div><button type="button" className="btn" onClick={toutCrediter}>Tout le reste</button></div>
        <div className="grille-champs">
          <Champ label="Motif" valeur={motif} onChange={setMotif} requis placeholder="Ex. Retour de marchandise abîmée, erreur de prix" />
          <Champ label="Date de l'avoir" type="date" valeur={date} onChange={setDate} requis />
        </div>
        <dl className="detail-selection" style={{ display: "grid", gridTemplateColumns: "auto auto", justifyContent: "start", gap: "4px 16px", margin: 0 }}>
          <dt className="discret">Montant HT</dt><dd style={{ margin: 0 }} className="num">{formatMontant(ht)} FCFA</dd>
          <dt className="discret">TVA</dt><dd style={{ margin: 0 }} className="num">{f.tauxTvaPdm ? `${formatMontant(tva)} FCFA` : "Non applicable"}</dd>
          <dt><b>Montant de l'avoir</b></dt><dd style={{ margin: 0 }} className="num"><b>{formatMontant(ttc)} FCFA</b></dd>
        </dl>
        {peutRembourser && tropPercu > 0 && comptes.length > 0 && (
          <fieldset className="champ" style={{ border: "1px solid var(--ligne)", padding: 10, margin: 0 }}>
            <legend>Remboursement</legend>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={rembourser} onChange={(e) => setRembourser(e.target.checked)} />
              Rembourser {formatMontant(tropPercu)} FCFA au client (il a déjà payé plus que le nouveau montant dû)
            </label>
            {rembourser && <Selection label="Rembourser depuis" valeur={compte} onChange={setCompte} options={comptes.map((c) => [c.id, `${c.nom} (solde ${formatMontant(c.solde)})`])} />}
          </fieldset>)}
        {!rembourser && <p className="discret" style={{ margin: 0 }}>Sans remboursement, l'avoir réduit ce que le client doit sur cette facture{tropPercu > 0 ? " ; ce qu'il a payé en trop reste à son crédit" : ""}.</p>}
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal" disabled={envoi}>{envoi ? "Émission…" : "Émettre l'avoir"}</button></div>
      </form>
    </Modale>
  );
}
