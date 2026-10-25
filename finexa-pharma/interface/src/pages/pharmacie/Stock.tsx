import { useEffect, useState } from "react";
import { api, qs, telecharger } from "../../api";
import { useSession } from "../../session";
import { aller, useParametres } from "../../routeur";
import { Champ, Chargement, Modale, Pagination, Selection, dateHeure, messageErreur, useDonnees, useRetarde, useToast } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import type { Page } from "../../types";
import { BadgeLot, Montant, aujourdhui, dateFr, formatMontant, useReferentiels, type Lot, type Mouvement, type Produit } from "./commun";

interface References { natures: Record<string, string>; statutsLot: Record<string, string>; motifsAjustement: { cle: string; libelle: string; sens: "entree" | "sortie" | "les_deux" }[] }
const useReferencesStock = () => useDonnees(() => api.get<References>("/api/stock/references"), []);

/** Lots en stock, classés par date de péremption (le premier à sortir en haut). */
export function Lots() {
  const { a } = useSession();
  const toast = useToast();
  const params = useParametres();
  const [f, setF] = useState({ recherche: "", etat: params.get("etat") ?? "", statut: "", enStock: "oui" });
  const [page, setPage] = useState(1);
  const rech = useRetarde(f.recherche);
  const filtres = { recherche: rech, etat: f.etat, statut: f.statut, enStock: f.enStock === "oui" ? undefined : "non" };
  const liste = useDonnees(() => api.get<Page<Lot> & { delaiAlertePeremption: number }>(`/api/lots${qs({ ...filtres, page, taille: 25 })}`), [rech, f.etat, f.statut, f.enStock, page]);
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const exporter = async () => {
    try { await telecharger(`/api/lots/export${qs(filtres)}`, `stock-par-lot-${aujourdhui()}.csv`); toast("Stock exporté ; l'export est tracé."); }
    catch (e) { toast(messageErreur(e), true); }
  };
  return (
    <>
      <div className="entete-page">
        <div><h2>Lots en stock</h2><p>Quantité par lot, péremption et emplacement. Le stock d'un lot est la somme de ses mouvements.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {a("stock.export") && <button className="btn" onClick={exporter}>Exporter (CSV)</button>}
          {a("stock.create") && <button className="btn btn-principal" onClick={() => aller("/stock/entree")}>+ Entrée de stock</button>}
        </div>
      </div>
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="l-rech">Rechercher</label>
          <input id="l-rech" className="filtre" type="search" placeholder="Produit, code ou n° de lot…" value={f.recherche} onChange={(e) => set("recherche")(e.target.value)} style={{ minWidth: 240 }} />
          <label className="cache-visuel" htmlFor="l-etat">Péremption</label>
          <select id="l-etat" className="filtre" value={f.etat} onChange={(e) => set("etat")(e.target.value)}>
            <option value="">Toutes les dates</option><option value="proche">Péremption proche ({liste.donnees?.delaiAlertePeremption ?? 90} j)</option><option value="perime">Périmés</option>
          </select>
          <label className="cache-visuel" htmlFor="l-statut">Statut</label>
          <select id="l-statut" className="filtre" value={f.statut} onChange={(e) => set("statut")(e.target.value)}>
            <option value="">Tous les statuts</option><option value="available">Disponibles</option><option value="blocked">Bloqués</option><option value="recalled">Rappelés</option>
          </select>
          <label className="case"><input type="checkbox" checked={f.enStock !== "oui"} onChange={(e) => set("enStock")(e.target.checked ? "non" : "oui")} /><span>Lots épuisés aussi</span></label>
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>Produit</th><th>N° de lot</th><th>Péremption</th><th className="montant">Quantité</th><th>Emplacement</th><th>État</th></tr></thead>
                <tbody>
                  {liste.donnees.elements.length === 0 && <tr><td colSpan={6} className="vide">Aucun lot ne correspond à ces critères.</td></tr>}
                  {liste.donnees.elements.map((l) => (
                    <tr key={l.id} className="cliquable" tabIndex={0} onClick={() => aller(`/stock/lots/${l.id}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/stock/lots/${l.id}`)}>
                      <td><b>{l.produit}</b> <span className="discret num">{l.codeProduit}</span></td><td className="num">{l.numero}</td><td className="num">{dateFr(l.peremption)}</td>
                      <td className="montant"><b>{formatMontant(l.quantite)}</b></td><td>{l.emplacement ?? <span className="discret">—</span>}</td>
                      <td>{l.quantite === 0 ? <span className="badge badge-neutre">Épuisé</span> : <BadgeLot l={l} />}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} />
          </>)}
      </section>
    </>
  );
}

/** Fiche lot : quantité, historique des mouvements avec solde, blocage ou rappel, ajustement, emplacement. */
export function FicheLot({ id }: { id: string }) {
  const { a } = useSession();
  const toast = useToast();
  const l = useDonnees(() => api.get<Lot>(`/api/lots/${id}`), [id]);
  const ref = useReferentiels();
  const [ajuster, setAjuster] = useState(false);
  const [statut, setStatut] = useState<null | "available" | "blocked" | "recalled">(null);
  if (l.erreur) return <div className="alerte alerte-erreur">{l.erreur} <a href="#/stock">Retour</a></div>;
  if (!l.donnees) return <Chargement />;
  const x = l.donnees;
  const changerEmplacement = async (v: string) => {
    try { await api.patch(`/api/lots/${id}`, { emplacementId: v || null }); toast("Emplacement enregistré."); l.recharger(); }
    catch (e) { toast(messageErreur(e), true); }
  };
  return (
    <>
      <div><a href="#/stock" className="btn-lien">← Lots en stock</a></div>
      <div className="entete-page">
        <div><h2>Lot {x.numero}</h2><p className="infos"><a href={`#/catalogue/produits/${x.produitId}`}>{x.produit}</a> · péremption {dateFr(x.peremption)} · {x.quantite === 0 ? <span className="badge badge-neutre">Épuisé</span> : <BadgeLot l={x} />}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {a("stock.approve") && <button className="btn btn-principal" onClick={() => setAjuster(true)}>Ajuster le stock</button>}
          {a("stock.update") && (x.statut === "available"
            ? <><button className="btn" onClick={() => setStatut("blocked")}>Bloquer</button><button className="btn btn-danger" onClick={() => setStatut("recalled")}>Rappel de lot</button></>
            : <button className="btn" onClick={() => setStatut("available")}>{x.statut === "recalled" ? "Lever le rappel" : "Débloquer"}</button>)}
        </div>
      </div>
      {x.statut !== "available" && <div className="alerte alerte-erreur" role="status"><b>{x.statutLibelle}</b> : {x.motifStatut}. Ce lot ne peut pas être vendu.</div>}
      {x.etat === "perime" && x.quantite > 0 && <div className="alerte alerte-erreur" role="status"><b>Lot périmé encore en stock</b> : retirez-le par un ajustement « Produit périmé retiré du stock ».</div>}
      <div className="indicateurs">
        <div className="indicateur"><div className="lib">Quantité en stock</div><div className="val">{formatMontant(x.quantite)}</div><div className="aide">boîte(s)</div></div>
        <div className="indicateur"><div className="lib">Péremption</div><div className="val" style={{ fontSize: 19 }}>{dateFr(x.peremption)}</div><div className="aide">{x.joursRestants >= 0 ? `dans ${x.joursRestants} jour(s)` : `dépassée de ${-x.joursRestants} jour(s)`}</div></div>
        <div className="indicateur"><div className="lib">Valeur d'achat</div><div className="val"><Montant v={x.quantite * x.prixAchat} /></div><div className="aide">FCFA ({formatMontant(x.prixAchat)} l'unité)</div></div>
      </div>
      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><h3>Mouvements</h3></div>
          <div className="tableau-conteneur">
            <table>
              <thead><tr><th>N°</th><th>Date</th><th>Nature</th><th className="montant">Quantité</th><th className="montant">Solde</th><th>Motif</th><th>Par</th></tr></thead>
              <tbody>{(x.mouvements ?? []).map((m) => (
                <tr key={m.id}><td className="num">{m.numero}</td><td className="num">{dateHeure(m.date)}</td><td>{m.natureLibelle}</td>
                  <td className={"montant" + (m.quantite < 0 ? " negatif" : "")}>{m.quantite > 0 ? "+" : "−"}{formatMontant(Math.abs(m.quantite))}</td><td className="montant"><b>{formatMontant(m.solde)}</b></td>
                  <td>{m.motif ?? ""}</td><td>{m.auteur}</td></tr>))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panneau" style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <div className="entete-panneau" style={{ margin: 0 }}><h3>Lot</h3></div>
          <dl className="resume-profil">
            <dt>Produit</dt><dd>{x.produit} <span className="num discret">{x.codeProduit}</span></dd>
            <dt>Fournisseur</dt><dd>{x.fournisseur ?? "—"}</dd>
            <dt>Reçu le</dt><dd>{dateFr(x.recuLe)}</dd>
            <dt>Prix d'achat</dt><dd><Montant v={x.prixAchat} /> FCFA</dd>
          </dl>
          {a("stock.update") && ref.donnees ? (
            <Selection label="Emplacement" valeur={x.emplacementId ?? ""} onChange={changerEmplacement}
              options={[["", "—"], ...ref.donnees.emplacements.filter((e) => !e.archive || e.id === x.emplacementId).map((e) => [e.id, e.nom] as [string, string])]} />)
            : <p style={{ margin: 0 }}>Emplacement : {x.emplacement ?? "—"}</p>}
          <p className="discret" style={{ margin: 0 }}>Le numéro, la date de péremption et le prix d'un lot enregistré ne se modifient pas. Une erreur de quantité se corrige par un ajustement motivé.</p>
        </section>
      </div>
      {ajuster && <Ajustement lot={x} onFermer={() => setAjuster(false)} onFin={() => { setAjuster(false); l.recharger(); }} />}
      {statut && <ConfirmerAction motif danger={statut === "recalled"}
        titre={statut === "blocked" ? "Bloquer ce lot ?" : statut === "recalled" ? "Enregistrer un rappel de ce lot ?" : x.statut === "recalled" ? "Lever le rappel ?" : "Débloquer ce lot ?"}
        libelle={statut === "available" ? "Confirmer" : statut === "blocked" ? "Bloquer" : "Rappeler le lot"}
        texte={statut === "available" ? "Le lot redevient vendable s'il n'est pas périmé." : "Le lot devient invendable immédiatement. Indiquez la raison (contrôle qualité, référence de l'avis de rappel…)."}
        onValider={async (motif) => { await api.post(`/api/lots/${id}/statut`, { statut, motif }); toast("Statut du lot enregistré."); l.recharger(); }}
        onFermer={() => setStatut(null)} />}
    </>
  );
}

/** Ajustement motivé (casse, péremption, erreur de saisie…). Opération sensible : confirmation par mot de passe. */
function Ajustement({ lot, onFermer, onFin }: { lot: Lot; onFermer: () => void; onFin: () => void }) {
  const toast = useToast();
  const refs = useReferencesStock();
  const [motif, setMotif] = useState(lot.etat === "perime" ? "peremption" : "casse");
  const [sens, setSens] = useState<"entree" | "sortie">("sortie");
  const [quantite, setQuantite] = useState("");
  const [precision, setPrecision] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const m = refs.donnees?.motifsAjustement.find((x) => x.cle === motif);
  useEffect(() => { if (m && m.sens !== "les_deux") setSens(m.sens); }, [m]);
  const valider = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    const q = Number(quantite);
    if (!Number.isInteger(q) || q < 1) return setErreur("Quantité en nombre entier, au moins 1.");
    setEnvoi(true);
    try {
      const r = await api.post<{ numero: string }>("/api/stock/ajustements", { lotId: lot.id, sens, quantite: q, motif, precision: precision.trim() || undefined });
      toast(`Ajustement ${r.numero} enregistré.`); onFin();
    } catch (er) { if ((er as { code?: string }).code !== "annulee") setErreur(messageErreur(er)); }
    finally { setEnvoi(false); }
  };
  return (
    <Modale titre={`Ajuster le stock du lot ${lot.numero}`} onFermer={onFermer}>
      {!refs.donnees ? <Chargement /> : (
        <form onSubmit={valider} style={{ display: "grid", gap: 12 }}>
          <p className="discret" style={{ margin: 0 }}>{lot.produit} · stock actuel : <b>{formatMontant(lot.quantite)}</b>. L'ajustement crée un mouvement définitif, tracé avec son motif.</p>
          <Selection label="Motif" valeur={motif} onChange={setMotif} options={refs.donnees.motifsAjustement.map((x) => [x.cle, x.libelle])} />
          {m?.sens === "les_deux" && <Selection label="Sens" valeur={sens} onChange={(v) => setSens(v as "entree" | "sortie")} options={[["sortie", "Sortie (le stock diminue)"], ["entree", "Entrée (le stock augmente)"]]} />}
          <Champ label={`Quantité ${sens === "sortie" ? "retirée" : "ajoutée"}`} valeur={quantite} onChange={setQuantite} requis inputMode="numeric" autoFocus />
          <Champ label={motif === "autre" ? "Précision (obligatoire)" : "Précision (facultative)"} valeur={precision} onChange={setPrecision} requis={motif === "autre"} />
          {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
          <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button>
            <button className="btn btn-principal" disabled={envoi} aria-busy={envoi || undefined}>{envoi ? "Enregistrement…" : "Enregistrer l'ajustement"}</button></div>
        </form>)}
    </Modale>
  );
}

/**
 * Entrée de stock hors achat : stock d'ouverture, ou lot reçu avant la mise en service des achats.
 * Si le n° de lot existe déjà pour ce produit (même péremption), la quantité s'y ajoute.
 */
export function EntreeStock() {
  const toast = useToast();
  const params = useParametres();
  const ref = useReferentiels();
  const [recherche, setRecherche] = useState("");
  const [produit, setProduit] = useState<Produit | null>(null);
  const rech = useRetarde(recherche);
  const trouves = useDonnees(() => (rech.trim().length >= 2 && !produit ? api.get<Page<Produit>>(`/api/produits${qs({ recherche: rech, taille: 8 })}`) : Promise.resolve(null)), [rech, produit]);
  useEffect(() => {
    const id = params.get("produit");
    if (id) api.get<Produit>(`/api/produits/${id}`).then(setProduit).catch(() => {});
  }, [params]);
  const [s, setS] = useState({ numero: "", peremption: "", quantite: "", prixAchat: "", fournisseur: "", recuLe: aujourdhui(), emplacementId: "" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [dernier, setDernier] = useState<Lot | null>(null);
  const set = (k: keyof typeof s) => (v: string) => setS({ ...s, [k]: v });
  const choisir = (p: Produit) => { setProduit(p); setRecherche(""); setS({ ...s, prixAchat: String(p.prixAchat || ""), fournisseur: p.fournisseur ?? "" }); };
  const valider = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    if (!produit) return setErreur("Choisissez d'abord le produit.");
    const q = Number(s.quantite), pa = s.prixAchat.trim() === "" ? undefined : Number(s.prixAchat.replace(/\s/g, ""));
    if (!Number.isInteger(q) || q < 1) return setErreur("Quantité en nombre entier de boîtes, au moins 1.");
    if (pa !== undefined && !Number.isInteger(pa)) return setErreur("Prix d'achat en francs, sans décimales.");
    setEnvoi(true);
    try {
      const l = await api.post<Lot>("/api/lots", { produitId: produit.id, numero: s.numero, peremption: s.peremption, quantite: q, prixAchat: pa,
        fournisseur: s.fournisseur.trim() || undefined, recuLe: s.recuLe || undefined, emplacementId: s.emplacementId || null });
      toast(`Lot ${l.numero} : ${formatMontant(l.quantite)} en stock.`);
      setDernier(l); setS({ ...s, numero: "", peremption: "", quantite: "" });
    } catch (er) { setErreur(messageErreur(er)); }
    finally { setEnvoi(false); }
  };
  return (
    <>
      <div className="entete-page"><div><h2>Entrée de stock</h2><p>Stock d'ouverture de l'officine ou lot reçu hors commande. Chaque entrée crée un mouvement daté et signé.</p></div></div>
      <div className="deux">
        <section className="panneau">
          <form onSubmit={valider} noValidate style={{ display: "grid", gap: 12 }}>
            {!produit ? (
              <div className="champ">
                <label htmlFor="e-prod">Produit *</label>
                <input id="e-prod" type="search" autoFocus placeholder="Nom, DCI, code ou code-barres…" value={recherche} onChange={(e) => setRecherche(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (trouves.donnees?.elements.length === 1) choisir(trouves.donnees.elements[0]); } }} />
                {!!trouves.donnees?.elements.length && <ul className="suggestions" role="listbox" aria-label="Produits trouvés">{trouves.donnees.elements.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => choisir(p)}><b>{p.nom}</b> <span className="discret">{p.code}{p.presentation ? ` · ${p.presentation}` : ""}</span></button></li>))}
                </ul>}
                {trouves.donnees && !trouves.donnees.elements.length && <span className="aide">Aucun produit : créez d'abord la fiche dans le catalogue.</span>}
              </div>
            ) : (
              <div className="produit-choisi"><div><b>{produit.nom}</b> <span className="discret">{produit.code} · stock vendable {formatMontant(produit.stock.vendable)}</span></div>
                <button type="button" className="btn-lien" onClick={() => setProduit(null)}>Changer</button></div>
            )}
            <div className="grille-champs">
              <Champ label="N° de lot" valeur={s.numero} onChange={set("numero")} requis aide="Tel qu'imprimé sur la boîte." />
              <Champ label="Date de péremption" type="date" valeur={s.peremption} onChange={set("peremption")} requis min={undefined} />
            </div>
            <div className="grille-champs">
              <Champ label="Quantité (boîtes)" valeur={s.quantite} onChange={set("quantite")} requis inputMode="numeric" />
              <Champ label="Prix d'achat unitaire (FCFA)" valeur={s.prixAchat} onChange={set("prixAchat")} inputMode="numeric" aide="Par défaut : prix d'achat de la fiche produit." />
            </div>
            <div className="grille-champs">
              <Champ label="Fournisseur" valeur={s.fournisseur} onChange={set("fournisseur")} />
              <Champ label="Reçu le" type="date" valeur={s.recuLe} onChange={set("recuLe")} />
            </div>
            {ref.donnees && <Selection label="Emplacement" valeur={s.emplacementId} onChange={set("emplacementId")}
              options={[["", "—"], ...ref.donnees.emplacements.filter((e) => !e.archive).map((e) => [e.id, e.nom] as [string, string])]} />}
            {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
            <div className="actions-form"><button className="btn btn-principal" disabled={envoi} aria-busy={envoi || undefined}>{envoi ? "Enregistrement…" : "Enregistrer l'entrée"}</button></div>
          </form>
        </section>
        <section className="panneau" style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <div className="entete-panneau" style={{ margin: 0 }}><h3>Dernière entrée</h3></div>
          {!dernier ? <p className="discret" style={{ margin: 0 }}>Après l'enregistrement, le produit reste choisi : vous pouvez saisir le lot suivant.</p> : (
            <dl className="resume-profil">
              <dt>Produit</dt><dd>{dernier.produit}</dd><dt>Lot</dt><dd><a href={`#/stock/lots/${dernier.id}`}>{dernier.numero}</a></dd>
              <dt>Péremption</dt><dd>{dateFr(dernier.peremption)}</dd><dt>Quantité du lot</dt><dd><b>{formatMontant(dernier.quantite)}</b></dd>
            </dl>)}
          <p className="discret" style={{ margin: 0 }}>Un lot déjà périmé est refusé. Si le numéro existe déjà pour ce produit avec une autre date, le logiciel le signale : vérifiez la boîte.</p>
        </section>
      </div>
    </>
  );
}

/** Historique de tous les mouvements, filtrable et exportable. */
export function Mouvements() {
  const { a } = useSession();
  const toast = useToast();
  const refs = useReferencesStock();
  const [f, setF] = useState({ recherche: "", nature: "", du: "", au: "" });
  const [page, setPage] = useState(1);
  const rech = useRetarde(f.recherche);
  const filtres = { recherche: rech, nature: f.nature, du: f.du, au: f.au };
  const liste = useDonnees(() => api.get<Page<Mouvement>>(`/api/stock/mouvements${qs({ ...filtres, page, taille: 30 })}`), [rech, f.nature, f.du, f.au, page]);
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const exporter = async () => {
    try { await telecharger(`/api/stock/mouvements/export${qs(filtres)}`, `mouvements-${aujourdhui()}.csv`); toast("Mouvements exportés ; l'export est tracé."); }
    catch (e) { toast(messageErreur(e), true); }
  };
  return (
    <>
      <div className="entete-page"><div><h2>Mouvements de stock</h2><p>Chaque entrée et chaque sortie, avec son auteur et son motif. Un mouvement ne se modifie ni ne se supprime.</p></div>
        {a("stock.export") && <button className="btn" onClick={exporter}>Exporter (CSV)</button>}</div>
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="m-rech">Rechercher</label>
          <input id="m-rech" className="filtre" type="search" placeholder="Produit, n° de lot ou de mouvement…" value={f.recherche} onChange={(e) => set("recherche")(e.target.value)} />
          <label className="cache-visuel" htmlFor="m-nat">Nature</label>
          <select id="m-nat" className="filtre" value={f.nature} onChange={(e) => set("nature")(e.target.value)}>
            <option value="">Toutes les natures</option>{refs.donnees && Object.entries(refs.donnees.natures).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="cache-visuel" htmlFor="m-du">Du</label><input id="m-du" className="filtre" type="date" value={f.du} onChange={(e) => set("du")(e.target.value)} title="Du" />
          <label className="cache-visuel" htmlFor="m-au">Au</label><input id="m-au" className="filtre" type="date" value={f.au} onChange={(e) => set("au")(e.target.value)} title="Au" />
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>N°</th><th>Date</th><th>Nature</th><th>Produit</th><th>Lot</th><th className="montant">Quantité</th><th>Motif</th><th>Par</th></tr></thead>
                <tbody>
                  {liste.donnees.elements.length === 0 && <tr><td colSpan={8} className="vide">Aucun mouvement pour ces critères.</td></tr>}
                  {liste.donnees.elements.map((m) => (
                    <tr key={m.id} className="cliquable" tabIndex={0} onClick={() => aller(`/stock/lots/${m.lotId}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/stock/lots/${m.lotId}`)}>
                      <td className="num">{m.numero}</td><td className="num">{dateHeure(m.date)}</td><td>{m.natureLibelle}</td><td>{m.produit}</td><td className="num">{m.lot}</td>
                      <td className={"montant" + (m.quantite < 0 ? " negatif" : "")}>{m.quantite > 0 ? "+" : "−"}{formatMontant(Math.abs(m.quantite))}</td><td>{m.motif ?? ""}</td><td>{m.auteur}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} />
          </>)}
      </section>
    </>
  );
}

interface Alertes { delaiAlertePeremption: number; ruptures: { id: string; nom: string; code: string; vendable: number; seuil: number }[];
  sousSeuil: { id: string; nom: string; code: string; vendable: number; seuil: number }[]; perimes: Lot[]; proches: Lot[]; bloques: Lot[] }

/** Ce qui demande une action : lots périmés ou bloqués, péremptions proches, ruptures, produits sous le seuil. */
export function Alertes() {
  const al = useDonnees(() => api.get<Alertes>("/api/stock/alertes"), []);
  if (al.erreur) return <div className="alerte alerte-erreur">{al.erreur}</div>;
  if (!al.donnees) return <Chargement />;
  const d = al.donnees;
  const lots = (titre: string, l: Lot[], vide: string) => (
    <section className="panneau">
      <div className="entete-panneau"><h3>{titre} <span className="badge badge-neutre">{l.length}</span></h3></div>
      <div className="tableau-conteneur"><table>
        <thead><tr><th>Produit</th><th>Lot</th><th>Péremption</th><th className="montant">Quantité</th><th>État</th></tr></thead>
        <tbody>{l.length === 0 ? <tr><td colSpan={5} className="vide">{vide}</td></tr> : l.map((x) => (
          <tr key={x.id} className="cliquable" tabIndex={0} onClick={() => aller(`/stock/lots/${x.id}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/stock/lots/${x.id}`)}>
            <td>{x.produit}</td><td className="num">{x.numero}</td><td className="num">{dateFr(x.peremption)}</td><td className="montant">{formatMontant(x.quantite)}</td><td><BadgeLot l={x} /></td></tr>))}
        </tbody></table></div>
    </section>);
  const produits = (titre: string, l: Alertes["ruptures"], vide: string) => (
    <section className="panneau">
      <div className="entete-panneau"><h3>{titre} <span className="badge badge-neutre">{l.length}</span></h3></div>
      <div className="tableau-conteneur"><table>
        <thead><tr><th>Code</th><th>Produit</th><th className="montant">Stock vendable</th><th className="montant">Seuil</th></tr></thead>
        <tbody>{l.length === 0 ? <tr><td colSpan={4} className="vide">{vide}</td></tr> : l.map((p) => (
          <tr key={p.id} className="cliquable" tabIndex={0} onClick={() => aller(`/catalogue/produits/${p.id}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/catalogue/produits/${p.id}`)}>
            <td className="num">{p.code}</td><td>{p.nom}</td><td className="montant"><b>{formatMontant(p.vendable)}</b></td><td className="montant">{p.seuil}</td></tr>))}
        </tbody></table></div>
    </section>);
  return (
    <>
      <div className="entete-page"><div><h2>Alertes de stock</h2><p>Péremption proche : moins de {d.delaiAlertePeremption} jours (réglable dans Administration › Pharmacie).</p></div></div>
      <div className="deux">
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {lots("Lots périmés encore en stock", d.perimes, "Aucun lot périmé en stock.")}
          {lots("Lots bloqués ou rappelés", d.bloques, "Aucun lot bloqué.")}
          {lots(`Péremption dans moins de ${d.delaiAlertePeremption} jours`, d.proches, "Aucune péremption proche.")}
        </div>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {produits("Ruptures", d.ruptures, "Aucune rupture.")}
          {produits("Sous le seuil d'alerte", d.sousSeuil, "Aucun produit sous son seuil.")}
        </div>
      </div>
    </>
  );
}
