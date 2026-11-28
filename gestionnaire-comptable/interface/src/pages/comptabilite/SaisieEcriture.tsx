import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { aller } from "../../routeur";
import { Champ, Chargement, messageErreur, useToast } from "../../composants/ui";
import { ChampMontant, formatMontant, comptesImputables, lireMontant, useReference, type Compte, type Ecriture } from "./commun";

interface Ligne { cle: number; compteId: string; libelle: string; debit: string; credit: string }
let compteur = 0;
const nouvelleLigne = (l: Partial<Ligne> = {}): Ligne => ({ cle: ++compteur, compteId: "", libelle: "", debit: "", credit: "", ...l });

/** Saisie d'une écriture (création ou modification d'un brouillard). */
export function SaisieEcriture({ id }: { id?: string }) {
  const toast = useToast();
  const { journaux } = useReference();
  const [comptes, setComptes] = useState<Compte[] | null>(null);
  const [journalId, setJournalId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [piece, setPiece] = useState("");
  const [libelle, setLibelle] = useState("");
  const [lignes, setLignes] = useState<Ligne[]>([nouvelleLigne(), nouvelleLigne()]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [charge, setCharge] = useState(!id);

  useEffect(() => { comptesImputables().then(setComptes).catch((e) => setErreur(messageErreur(e))); }, []);
  useEffect(() => { if (!journalId && journaux.length) setJournalId(journaux.find((j) => j.actif)?.id ?? ""); }, [journaux, journalId]);
  useEffect(() => {
    if (!id) return;
    api.get<Ecriture>(`/api/comptabilite/ecritures/${id}`).then((e) => {
      if (e.statut !== "brouillard") { aller(`/comptabilite/ecritures/${id}`); return; }
      setJournalId(e.journal.id); setDate(e.date); setPiece(e.piece); setLibelle(e.libelle);
      setLignes(e.lignes.map((l) => nouvelleLigne({ compteId: l.compteId, libelle: l.libelle ?? "", debit: l.debit ? formatMontant(l.debit) : "", credit: l.credit ? formatMontant(l.credit) : "" })));
      setCharge(true);
    }).catch((e) => setErreur(messageErreur(e)));
  }, [id]);

  const totaux = useMemo(() => {
    let d = 0, c = 0, invalide = false;
    for (const l of lignes) {
      const dd = lireMontant(l.debit), cc = lireMontant(l.credit);
      if (Number.isNaN(dd) || Number.isNaN(cc)) invalide = true; else { d += dd; c += cc; }
    }
    return { d, c, ecart: Math.abs(d - c), invalide };
  }, [lignes]);
  const equilibree = !totaux.invalide && totaux.d === totaux.c && totaux.d > 0 && lignes.length >= 2;
  const maj = (cle: number, champ: keyof Ligne, v: string) => setLignes((ls) => ls.map((l) => {
    if (l.cle !== cle) return l;
    const n = { ...l, [champ]: v };
    // Une ligne porte soit un débit, soit un crédit : saisir l'un vide l'autre.
    if (champ === "debit" && v.trim()) n.credit = "";
    if (champ === "credit" && v.trim()) n.debit = "";
    return n;
  }));
  const equilibrer = () => {
    // Reporte l'écart sur la dernière ligne vide.
    const vide = [...lignes].reverse().find((l) => !l.debit && !l.credit);
    if (!vide || totaux.ecart === 0) return;
    maj(vide.cle, totaux.d > totaux.c ? "credit" : "debit", formatMontant(totaux.ecart));
  };

  const enregistrer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    const utiles = lignes.filter((l) => l.compteId || l.debit || l.credit);
    for (const [i, l] of utiles.entries()) {
      const d = lireMontant(l.debit), c = lireMontant(l.credit);
      if (!l.compteId) return setErreur(`Ligne ${i + 1} : choisissez un compte.`);
      if (Number.isNaN(d) || Number.isNaN(c)) return setErreur(`Ligne ${i + 1} : montant invalide (entier en FCFA, sans décimales).`);
      if ((d > 0) === (c > 0)) return setErreur(`Ligne ${i + 1} : indiquez soit un débit, soit un crédit.`);
    }
    if (!utiles.length) return setErreur("Ajoutez au moins une ligne.");
    const corps = { journalId, date, piece, libelle, lignes: utiles.map((l) => ({ compteId: l.compteId, libelle: l.libelle || null, debit: lireMontant(l.debit), credit: lireMontant(l.credit) })) };
    setEnvoi(true);
    try {
      const r = id ? await api.put<Ecriture>(`/api/comptabilite/ecritures/${id}`, corps) : await api.post<Ecriture>("/api/comptabilite/ecritures", corps);
      toast(r.equilibree ? "Brouillard enregistré, prêt à être validé." : "Brouillard enregistré, déséquilibré : il ne pourra pas être validé en l'état.");
      aller(`/comptabilite/ecritures/${r.id}`);
    } catch (err) { setErreur(messageErreur(err)); } finally { setEnvoi(false); }
  };

  if (!charge || !comptes) return erreur ? <div className="alerte alerte-erreur">{erreur}</div> : <Chargement />;
  const optionsComptes = comptes.map((c) => <option key={c.id} value={c.id}>{c.numero} · {c.libelle}</option>);

  return (
    <>
      <div><a href={id ? `#/comptabilite/ecritures/${id}` : "#/comptabilite/ecritures"} className="btn-lien">← Retour</a></div>
      <div className="entete-page"><div><h2>{id ? "Modifier le brouillard" : "Nouvelle écriture"}</h2><p>L'écriture est enregistrée en brouillard. Une autre personne habilitée la validera ; elle sera alors numérotée et ne pourra plus être modifiée.</p></div></div>
      <form className="panneau" onSubmit={enregistrer} style={{ display: "grid", gap: 14 }}>
        <div className="grille-champs">
          <div className="champ"><label htmlFor="s-j">Journal *</label>
            <select id="s-j" value={journalId} onChange={(e) => setJournalId(e.target.value)} required>{journaux.filter((j) => j.actif).map((j) => <option key={j.id} value={j.id}>{j.code} · {j.libelle}</option>)}</select></div>
          <Champ label="Date de l'écriture" type="date" valeur={date} onChange={setDate} requis />
          <Champ label="Référence de la pièce" valeur={piece} onChange={setPiece} requis placeholder="Ex. FAC-2026-014" aide="Numéro de la facture, du reçu ou du relevé." />
          <Champ label="Libellé" valeur={libelle} onChange={setLibelle} requis placeholder="Ex. Achat de fournitures de bureau" />
        </div>
        <div>
          <div className="entete-panneau"><div><h3>Lignes</h3><p>Chaque ligne porte soit un débit, soit un crédit. Montants entiers en FCFA.</p></div>
            <div style={{ display: "flex", gap: 8 }}>
              {!equilibree && totaux.ecart > 0 && <button type="button" className="btn btn-petit" onClick={equilibrer}>Reporter l'écart</button>}
              <button type="button" className="btn btn-petit" onClick={() => setLignes([...lignes, nouvelleLigne()])}>+ Ajouter une ligne</button>
            </div>
          </div>
          <div className="tableau-conteneur">
            <table className="lignes-saisie">
              <thead><tr><th className="col-compte">Compte</th><th>Libellé de la ligne</th><th className="montant col-montant">Débit</th><th className="montant col-montant">Crédit</th><th></th></tr></thead>
              <tbody>{lignes.map((l, i) => (
                <tr key={l.cle}>
                  <td className="col-compte"><select aria-label={`Compte de la ligne ${i + 1}`} value={l.compteId} onChange={(e) => maj(l.cle, "compteId", e.target.value)}>
                    <option value="">Choisir un compte…</option>{optionsComptes}</select></td>
                  <td><input aria-label={`Libellé de la ligne ${i + 1}`} value={l.libelle} placeholder={libelle || "Facultatif"} onChange={(e) => maj(l.cle, "libelle", e.target.value)} /></td>
                  <td className="col-montant"><ChampMontant label={`Débit de la ligne ${i + 1}`} valeur={l.debit} onChange={(v) => maj(l.cle, "debit", v)} /></td>
                  <td className="col-montant"><ChampMontant label={`Crédit de la ligne ${i + 1}`} valeur={l.credit} onChange={(v) => maj(l.cle, "credit", v)} /></td>
                  <td><button type="button" className="btn btn-petit" aria-label={`Supprimer la ligne ${i + 1}`} disabled={lignes.length <= 1} onClick={() => setLignes(lignes.filter((x) => x.cle !== l.cle))}>×</button></td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <div className="totaux-saisie" aria-live="polite">
            <span>Total débit : <b>{formatMontant(totaux.d)}</b></span>
            <span>Total crédit : <b>{formatMontant(totaux.c)}</b></span>
            <span className={equilibree ? "equilibre" : "desequilibre"}>{totaux.invalide ? "Montant invalide" : equilibree ? "Écriture équilibrée" : `Écart : ${formatMontant(totaux.ecart)}`}</span>
          </div>
        </div>
        {!equilibree && !totaux.invalide && <div className="alerte alerte-attention">Vous pouvez enregistrer ce brouillard pour le reprendre plus tard, mais il ne pourra être validé que lorsque débit et crédit seront égaux.</div>}
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form">
          <button type="button" className="btn" onClick={() => aller(id ? `/comptabilite/ecritures/${id}` : "/comptabilite/ecritures")}>Annuler</button>
          <button className="btn btn-principal" disabled={envoi}>{envoi ? "Enregistrement…" : "Enregistrer le brouillard"}</button>
        </div>
      </form>
    </>
  );
}
