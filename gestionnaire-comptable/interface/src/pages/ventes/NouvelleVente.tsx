import { useEffect, useMemo, useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Champ, Chargement, messageErreur, useRetarde, useToast } from "../../composants/ui";
import { ChampMontant, formatMontant, lireMontant } from "../comptabilite/commun";
import { comptesTresorerie, type CompteTresorerie } from "../tresorerie/commun";
import { tauxTexte, type Facture } from "./commun";

interface Ligne { cle: number; designation: string; quantite: string; prix: string; nature: "marchandise" | "service" }
let n = 0;
const ligne = (nature: Ligne["nature"]): Ligne => ({ cle: ++n, designation: "", quantite: "1", prix: "", nature });
const lireQuantite = (t: string) => { const v = Number(t.replace(",", ".").replace(/\s/g, "")); return Number.isFinite(v) && v > 0 && Math.round(v * 1000) === v * 1000 ? v : NaN; };

/** Saisie d'une vente ou d'une prestation : totaux et TVA calculés en direct, facture émise puis imprimable. */
export function NouvelleVente() {
  const { a } = useSession();
  const toast = useToast();
  const [fiscal, setFiscal] = useState<{ tvaApplicable: boolean; tauxTvaPdm: number } | null>(null);
  const [comptes, setComptes] = useState<CompteTresorerie[]>([]);
  const [type, setType] = useState<Ligne["nature"]>("marchandise");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [client, setClient] = useState({ id: "", nom: "", niu: "", telephone: "", adresse: "", enregistrer: false });
  const [suggestions, setSuggestions] = useState<{ id: string; nom: string; niu: string | null; telephone: string | null }[]>([]);
  const [lignes, setLignes] = useState<Ligne[]>([ligne("marchandise")]);
  const [mode, setMode] = useState<"comptant" | "credit">("comptant");
  const [compte, setCompte] = useState("");
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const rechClient = useRetarde(client.nom, 250);

  useEffect(() => { api.get("/api/ventes/parametres").then(setFiscal).catch((e) => setErreur(messageErreur(e))); }, []);
  useEffect(() => {
    if (!a("treasury.read") && !a("cash.read")) { setMode("credit"); return; }
    comptesTresorerie().then((c) => { const actifs = c.filter((x) => x.actif); setComptes(actifs); setCompte(actifs[0]?.id ?? ""); if (!actifs.length) setMode("credit"); }).catch(() => setMode("credit"));
  }, [a]);
  useEffect(() => {
    if (client.id || rechClient.trim().length < 2) { setSuggestions([]); return; }
    api.get<typeof suggestions>(`/api/ventes/clients${qs({ recherche: rechClient })}`).then((s) => setSuggestions(s.slice(0, 6))).catch(() => {});
  }, [rechClient, client.id]);

  const calc = useMemo(() => {
    let ht = 0, invalide = false;
    const montants = lignes.map((l) => {
      const q = lireQuantite(l.quantite), p = lireMontant(l.prix);
      if (Number.isNaN(q) || Number.isNaN(p)) { invalide = true; return 0; }
      const m = Math.round(q * p); ht += m; return m;
    });
    const tva = fiscal?.tvaApplicable ? Math.round((ht * fiscal.tauxTvaPdm) / 10000) : 0;
    return { montants, ht, tva, ttc: ht + tva, invalide };
  }, [lignes, fiscal]);
  const maj = (cle: number, champ: keyof Ligne, v: string) => setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, [champ]: v } : l)));

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    const utiles = lignes.filter((l) => l.designation.trim() || l.prix);
    if (!utiles.length) return setErreur("Ajoutez au moins une ligne.");
    for (const [i, l] of utiles.entries()) {
      if (!l.designation.trim()) return setErreur(`Ligne ${i + 1} : indiquez la désignation.`);
      if (Number.isNaN(lireQuantite(l.quantite))) return setErreur(`Ligne ${i + 1} : quantité invalide (3 décimales au plus).`);
      if (Number.isNaN(lireMontant(l.prix)) || !l.prix) return setErreur(`Ligne ${i + 1} : prix unitaire invalide (entier en FCFA).`);
    }
    if (mode === "comptant" && !compte) return setErreur("Choisissez la caisse ou le compte qui reçoit le paiement.");
    setEnvoi(true);
    try {
      const f = await api.post<Facture>("/api/ventes/factures", {
        date, note: note || undefined,
        client: client.id ? { id: client.id } : { nom: client.nom || undefined, niu: client.niu || undefined, telephone: client.telephone || undefined, adresse: client.adresse || undefined, enregistrer: client.enregistrer },
        lignes: utiles.map((l) => ({ designation: l.designation.trim(), quantite: lireQuantite(l.quantite), prixUnitaire: lireMontant(l.prix), nature: l.nature })),
        paiement: mode === "comptant" ? { mode, compteTresorerieId: compte } : { mode },
      });
      toast(`Facture ${f.numero} émise.`);
      aller(`/ventes/factures/${f.id}?imprimer=1`);
    } catch (err) { setErreur(messageErreur(err)); } finally { setEnvoi(false); }
  };

  if (!fiscal) return erreur ? <div className="alerte alerte-erreur">{erreur}</div> : <Chargement />;
  return (
    <>
      <div><a href="#/ventes" className="btn-lien">← Ventes et factures</a></div>
      <div className="entete-page"><div><h2>Nouvelle vente</h2><p>Saisissez la vente ou la prestation : la facture, son écriture comptable et, si le client paie maintenant, l'encaissement sont enregistrés ensemble.</p></div></div>
      <form className="panneau" onSubmit={envoyer} style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="Type de vente">
          {([["marchandise", "Vente de marchandises"], ["service", "Prestation de services"]] as const).map(([v, l]) => (
            <button type="button" key={v} role="radio" aria-checked={type === v} className={"btn" + (type === v ? " btn-principal" : "")}
              onClick={() => { setType(v); setLignes(lignes.map((x) => (x.designation || x.prix ? x : { ...x, nature: v }))); }}>{l}</button>
          ))}
        </div>
        <div className="grille-champs">
          <div className="champ" style={{ position: "relative" }}>
            <label htmlFor="v-client">Client</label>
            <input id="v-client" value={client.nom} placeholder="Nom du client (vide : client comptant)" autoComplete="off"
              onChange={(e) => setClient({ ...client, id: "", nom: e.target.value })} />
            {client.id && <span className="aide">Fiche client existante sélectionnée.</span>}
            {suggestions.length > 0 && (
              <div className="panneau-notifs" style={{ top: 64, left: 0, right: "auto", width: "100%" }} role="listbox">
                {suggestions.map((s) => <button type="button" key={s.id} className="notif btn-lien" style={{ textAlign: "left", width: "100%" }} role="option" aria-selected={false}
                  onClick={() => { setClient({ ...client, id: s.id, nom: s.nom, niu: s.niu ?? "", telephone: s.telephone ?? "" }); setSuggestions([]); }}>
                  <b>{s.nom}</b>{s.telephone && <span className="discret"> · {s.telephone}</span>}</button>)}
              </div>
            )}
          </div>
          <Champ label="Date" type="date" valeur={date} onChange={setDate} requis />
        </div>
        {!client.id && client.nom.trim().length >= 2 && (
          <div className="grille-champs">
            <Champ label="NIU du client (facultatif)" valeur={client.niu} onChange={(v) => setClient({ ...client, niu: v })} />
            <Champ label="Téléphone (facultatif)" valeur={client.telephone} onChange={(v) => setClient({ ...client, telephone: v })} />
            <Champ label="Adresse (facultatif)" valeur={client.adresse} onChange={(v) => setClient({ ...client, adresse: v })} />
            <label className="case" style={{ alignSelf: "end" }}><input type="checkbox" checked={client.enregistrer} onChange={(e) => setClient({ ...client, enregistrer: e.target.checked })} /> Enregistrer ce client pour les prochaines ventes</label>
          </div>
        )}
        <div>
          <div className="entete-panneau"><div><h3>Articles et prestations</h3><p>Prix unitaires {fiscal.tvaApplicable ? "hors taxes" : ""} en FCFA, sans décimales.</p></div>
            <button type="button" className="btn btn-petit" onClick={() => setLignes([...lignes, ligne(type)])}>+ Ajouter une ligne</button></div>
          <div className="tableau-conteneur">
            <table className="lignes-saisie">
              <thead><tr><th>Désignation</th><th style={{ width: 150 }}>Nature</th><th style={{ width: 100 }}>Quantité</th><th className="montant col-montant">Prix unitaire</th><th className="montant" style={{ width: 130 }}>Montant</th><th></th></tr></thead>
              <tbody>{lignes.map((l, i) => (
                <tr key={l.cle}>
                  <td><input aria-label={`Désignation de la ligne ${i + 1}`} value={l.designation} placeholder={l.nature === "service" ? "Ex. Installation, maintenance…" : "Ex. Cartouche d'encre"} onChange={(e) => maj(l.cle, "designation", e.target.value)} /></td>
                  <td><select aria-label={`Nature de la ligne ${i + 1}`} value={l.nature} onChange={(e) => maj(l.cle, "nature", e.target.value)}><option value="marchandise">Marchandise</option><option value="service">Service</option></select></td>
                  <td><input aria-label={`Quantité de la ligne ${i + 1}`} inputMode="decimal" className="montant-saisie" value={l.quantite} onChange={(e) => maj(l.cle, "quantite", e.target.value)} /></td>
                  <td className="col-montant"><ChampMontant label={`Prix unitaire de la ligne ${i + 1}`} valeur={l.prix} onChange={(v) => maj(l.cle, "prix", v)} /></td>
                  <td className="montant" style={{ paddingTop: 14 }}>{formatMontant(calc.montants[i] ?? 0)}</td>
                  <td><button type="button" className="btn btn-petit" aria-label={`Supprimer la ligne ${i + 1}`} disabled={lignes.length <= 1} onClick={() => setLignes(lignes.filter((x) => x.cle !== l.cle))}>×</button></td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <div className="totaux-saisie" aria-live="polite">
            <span>Total HT : <b>{formatMontant(calc.ht)}</b></span>
            <span>{fiscal.tvaApplicable ? <>TVA {tauxTexte(fiscal.tauxTvaPdm)} : <b>{formatMontant(calc.tva)}</b></> : "TVA non applicable"}</span>
            <span className="equilibre" style={{ color: "var(--marine)" }}>Net à payer : <b>{formatMontant(calc.ttc)} FCFA</b></span>
          </div>
        </div>
        <fieldset className="champ" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="etiquette" style={{ marginBottom: 6 }}>Paiement</legend>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label className="case" style={{ flex: "none" }}><input type="radio" name="mode" checked={mode === "comptant"} disabled={!comptes.length} onChange={() => setMode("comptant")} /> Payé maintenant</label>
            {mode === "comptant" && comptes.length > 0 && (
              <select aria-label="Encaissé dans" value={compte} onChange={(e) => setCompte(e.target.value)} className="filtre" style={{ maxWidth: 320 }}>
                {comptes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>)}
            <label className="case" style={{ flex: "none" }}><input type="radio" name="mode" checked={mode === "credit"} onChange={() => setMode("credit")} /> À crédit (réglé plus tard)</label>
          </div>
          {!comptes.length && <span className="aide">Aucune caisse ne vous est attribuée : la vente est enregistrée à crédit.</span>}
        </fieldset>
        <Champ label="Observation (facultatif, imprimée sur la facture)" valeur={note} onChange={setNote} />
        <div className="alerte">Une facture émise reçoit un numéro définitif et ne peut plus être modifiée. Vérifiez le client, les quantités et les prix.</div>
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form">
          <button type="button" className="btn" onClick={() => aller("/ventes")}>Annuler</button>
          <button className="btn btn-principal" disabled={envoi || calc.invalide || calc.ttc <= 0}>{envoi ? "Émission…" : `Émettre la facture (${formatMontant(calc.ttc)} FCFA)`}</button>
        </div>
      </form>
    </>
  );
}
