import { useEffect, useMemo, useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { Champ, Modale, Selection, messageErreur, useToast } from "../../composants/ui";
import { ChampMontant, formatMontant, lireMontant } from "../comptabilite/commun";
import type { Categorie, CompteTresorerie } from "./commun";

export type TypeOperation = "entree" | "sortie" | "transfert";

/**
 * Saisie d'une opération de trésorerie sans connaître le plan comptable :
 * on choisit la caisse ou la banque, une catégorie, un montant. L'écriture est générée automatiquement.
 */
export function OperationModale({ type, comptes, compteInitial, onFermer, onFin }: {
  type: TypeOperation; comptes: CompteTresorerie[]; compteInitial?: string; onFermer: () => void; onFin: () => void;
}) {
  const { a } = useSession();
  const toast = useToast();
  const actifs = comptes.filter((c) => c.actif);
  const [compte, setCompte] = useState(compteInitial ?? actifs[0]?.id ?? "");
  const [vers, setVers] = useState(actifs.find((c) => c.id !== (compteInitial ?? actifs[0]?.id))?.id ?? "");
  const [categories, setCategories] = useState<{ entrees: Categorie[]; sorties: Categorie[] } | null>(null);
  const [categorie, setCategorie] = useState("");
  const [montant, setMontant] = useState("");
  const [tva, setTva] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [libelle, setLibelle] = useState("");
  const [reference, setReference] = useState("");
  const [factures, setFactures] = useState<{ id: string; numero: string; client: string; reste: number }[]>([]);
  const [facture, setFacture] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { api.get("/api/tresorerie/categories").then(setCategories).catch(() => {}); }, []);
  const liste = type === "entree" ? categories?.entrees ?? [] : categories?.sorties ?? [];
  useEffect(() => { if (liste.length && !liste.some((c) => c.code === categorie)) setCategorie(liste[0].code); }, [liste, categorie]);
  const cat = liste.find((c) => c.code === categorie);
  const reglementClient = type === "entree" && categorie === "encaissement_client";
  useEffect(() => {
    if (!reglementClient || !a("sales.read")) return;
    api.get<{ elements: { id: string; numero: string; client: string; reste: number }[] }>(`/api/ventes/factures${qs({ statut: "impayee", taille: 100 })}`)
      .then((r) => { setFactures(r.elements); if (r.elements[0]) { setFacture(r.elements[0].id); } }).catch(() => {});
  }, [reglementClient, a]);
  const factureChoisie = factures.find((f) => f.id === facture);
  useEffect(() => { if (factureChoisie) { setMontant(formatMontant(factureChoisie.reste)); setLibelle(`Règlement ${factureChoisie.numero} : ${factureChoisie.client}`); } }, [factureChoisie]);

  const titre = type === "entree" ? "Encaissement" : type === "sortie" ? "Dépense" : "Transfert entre comptes";
  const m = lireMontant(montant), t = lireMontant(tva);
  const solde = useMemo(() => actifs.find((c) => c.id === compte)?.solde ?? 0, [actifs, compte]);
  const estCaisse = actifs.find((c) => c.id === compte)?.type === "cash";

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    if (!(m > 0)) return setErreur("Indiquez un montant entier positif, en FCFA.");
    if (type !== "entree" && estCaisse && m > solde) return setErreur(`Solde de caisse insuffisant : ${formatMontant(solde)} FCFA disponibles.`);
    setEnvoi(true);
    try {
      if (type === "transfert") {
        const r = await api.post<{ reference: string }>("/api/tresorerie/transferts", { de: compte, vers, montant: m, date, libelle, reference: reference || undefined });
        toast(`Transfert ${r.reference} enregistré.`);
      } else {
        const corps = { compteTresorerieId: compte, sens: type, montant: m, date, libelle, reference: reference || undefined,
          ...(reglementClient && facture ? { factureId: facture } : { categorie }), ...(type === "sortie" && t > 0 ? { tva: t } : {}) };
        const r = await api.post<{ reference: string }>("/api/tresorerie/mouvements", corps);
        toast(`${titre} ${r.reference} enregistré. L'écriture comptable attend la validation du comptable.`);
      }
      onFin(); onFermer();
    } catch (err) { setErreur(messageErreur(err)); } finally { setEnvoi(false); }
  };

  const optionsComptes = (exclure?: string) => actifs.filter((c) => c.id !== exclure).map((c) => [c.id, `${c.nom} (solde ${formatMontant(c.solde)})`] as [string, string]);
  return (
    <Modale titre={titre} onFermer={onFermer}>
      {actifs.length === 0 ? <div className="alerte alerte-attention">Aucune caisse ni banque ne vous est accessible. Demandez au DAF de vous attribuer une caisse.</div> : (
        <form onSubmit={envoyer} style={{ display: "grid", gap: 12 }}>
          <div className="grille-champs">
            <Selection label={type === "transfert" ? "Depuis" : type === "entree" ? "Encaisser dans" : "Payer depuis"} valeur={compte} onChange={setCompte} options={optionsComptes()} />
            {type === "transfert"
              ? <Selection label="Vers" valeur={vers} onChange={setVers} options={optionsComptes(compte)} />
              : <Selection label="Catégorie" valeur={categorie} onChange={setCategorie} options={liste.map((c) => [c.code, c.libelle])} />}
          </div>
          {reglementClient && (factures.length
            ? <Selection label="Facture réglée" valeur={facture} onChange={setFacture} options={factures.map((f) => [f.id, `${f.numero} · ${f.client} · reste ${formatMontant(f.reste)} FCFA`])} />
            : <div className="alerte">Aucune facture impayée.</div>)}
          <div className="grille-champs">
            <div className="champ"><label htmlFor="op-m">Montant (FCFA) *</label><div className="lignes-saisie" id="op-m"><ChampMontant label="Montant" valeur={montant} onChange={setMontant} /></div></div>
            <Champ label="Date" type="date" valeur={date} onChange={setDate} requis />
          </div>
          {type === "sortie" && cat?.tva && <div className="lignes-saisie champ"><label>Dont TVA récupérable (facultatif)</label><ChampMontant label="Dont TVA récupérable" valeur={tva} onChange={setTva} /><span className="aide">Si la facture du fournisseur mentionne la TVA, indiquez son montant.</span></div>}
          <Champ label="Libellé" valeur={libelle} onChange={setLibelle} requis placeholder={type === "sortie" ? "Ex. Achat de ramettes de papier" : "Ex. Vente de cartons usagés"} />
          <Champ label="N° de reçu ou de pièce (facultatif)" valeur={reference} onChange={setReference} aide="Laissé vide, un numéro est attribué automatiquement." />
          {type !== "entree" && estCaisse && <p className="discret" style={{ margin: 0 }}>Solde disponible : <b>{formatMontant(solde)} FCFA</b>. Une caisse ne peut pas passer en négatif.</p>}
          {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
          <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal" disabled={envoi}>{envoi ? "Enregistrement…" : "Enregistrer"}</button></div>
        </form>
      )}
    </Modale>
  );
}
