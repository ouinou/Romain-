import { useEffect, useState } from "react";
import { api, qs, telecharger } from "../../api";
import { useSession } from "../../session";
import { aller, effacerParametres, useParametres } from "../../routeur";
import { Champ, Chargement, Modale, Pagination, Selection, dateHeure, messageErreur, useDonnees, useRetarde, useToast } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import type { Page } from "../../types";
import { BadgeLot, BadgeStock, Montant, dateFr, formatMontant, optionsCategories, tauxTexte, useReferentiels, type Lot, type Produit } from "./commun";

/** Catalogue : liste des produits, avec recherche (nom, DCI, code interne ou code-barres lu par une douchette). */
export function Produits() {
  const { a } = useSession();
  const toast = useToast();
  const ref = useReferentiels();
  const qp = useParametres();
  const [f, setF] = useState({ recherche: qp.get("recherche") ?? "", categorie: "", statut: "", alerte: qp.get("alerte") ?? "" });
  useEffect(() => {
    const r = qp.get("recherche"), al = qp.get("alerte");
    if (r !== null || al !== null) { setF((x) => ({ ...x, recherche: r ?? x.recherche, alerte: al ?? x.alerte })); setPage(1); effacerParametres(); }
  }, [qp]);
  const [page, setPage] = useState(1);
  const rech = useRetarde(f.recherche);
  const params = { recherche: rech, categorie: f.categorie, statut: f.statut, alerte: f.alerte };
  const liste = useDonnees(() => api.get<Page<Produit>>(`/api/produits${qs({ ...params, page, taille: 25 })}`), [rech, f.categorie, f.statut, f.alerte, page]);
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const exporter = async () => {
    try { await telecharger(`/api/produits/export${qs(params)}`, "catalogue.csv"); toast("Catalogue exporté ; l'export est tracé."); }
    catch (e) { toast(messageErreur(e), true); }
  };
  // Douchette : elle « tape » le code-barres puis Entrée. Un seul résultat exact : on ouvre la fiche.
  const valider = async () => {
    const t = f.recherche.trim();
    if (!t) return;
    const r = await api.get<Page<Produit>>(`/api/produits${qs({ recherche: t, taille: 2 })}`).catch(() => null);
    if (r?.elements.length === 1) aller(`/catalogue/produits/${r.elements[0].id}`);
  };
  return (
    <>
      <div className="entete-page">
        <div><h2>Produits</h2><p>Fiches des médicaments et autres produits. Un produit n'est jamais supprimé : il s'archive.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {a("catalog.export") && <button className="btn" onClick={exporter}>Exporter (CSV)</button>}
          {a("catalog.create") && <button className="btn btn-principal" onClick={() => aller("/catalogue/nouveau")}>+ Nouveau produit</button>}
        </div>
      </div>
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="p-rech">Rechercher</label>
          <input id="p-rech" className="filtre" type="search" autoFocus placeholder="Nom, DCI, code ou code-barres…" value={f.recherche}
            onChange={(e) => set("recherche")(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valider()} style={{ minWidth: 260 }} />
          <label className="cache-visuel" htmlFor="p-cat">Catégorie</label>
          <select id="p-cat" className="filtre" value={f.categorie} onChange={(e) => set("categorie")(e.target.value)}>
            <option value="">Toutes les catégories</option>
            {optionsCategories(ref.donnees?.categories ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="cache-visuel" htmlFor="p-alerte">Stock</label>
          <select id="p-alerte" className="filtre" value={f.alerte} onChange={(e) => set("alerte")(e.target.value)}>
            <option value="">Tout le stock</option><option value="rupture">En rupture</option><option value="seuil">Sous le seuil</option>
          </select>
          <label className="cache-visuel" htmlFor="p-statut">Statut</label>
          <select id="p-statut" className="filtre" value={f.statut} onChange={(e) => set("statut")(e.target.value)}>
            <option value="">Actifs et suspendus</option><option value="active">Actifs</option><option value="suspended">Suspendus</option><option value="archived">Archivés</option>
          </select>
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>Code</th><th>Produit</th><th>Catégorie</th><th className="montant">Prix de vente</th><th className="montant">Stock vendable</th><th>Prochaine péremption</th><th>État</th></tr></thead>
                <tbody>
                  {liste.donnees.elements.length === 0 && <tr><td colSpan={7} className="vide">{f.recherche || f.categorie || f.alerte ? "Aucun produit ne correspond à ces critères." : "Le catalogue est vide : créez un produit ou importez votre liste (CSV)."}</td></tr>}
                  {liste.donnees.elements.map((p) => (
                    <tr key={p.id} className="cliquable" tabIndex={0} onClick={() => aller(`/catalogue/produits/${p.id}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/catalogue/produits/${p.id}`)}>
                      <td className="num">{p.code}</td>
                      <td><b>{p.nom}</b>{(p.dci || p.presentation) && <small className="discret" style={{ display: "block" }}>{[p.dci, p.presentation].filter(Boolean).join(" · ")}</small>}</td>
                      <td>{p.categorie ?? <span className="discret">—</span>}</td>
                      <td className="montant"><Montant v={p.prixVente} /></td>
                      <td className="montant"><b>{formatMontant(p.stock.vendable)}</b></td>
                      <td className="num">{dateFr(p.stock.prochainePeremption)}</td>
                      <td><BadgeStock p={p} /></td>
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

type Saisie = { nom: string; dci: string; codeBarres: string; categorieId: string; formeId: string; dosage: string; presentation: string; fabricant: string;
  fournisseur: string; prixAchat: string; prixVente: string; tauxTvaPdm: string; seuil: string; conservation: string; categorieDelivrance: string };
const vide: Saisie = { nom: "", dci: "", codeBarres: "", categorieId: "", formeId: "", dosage: "", presentation: "", fabricant: "", fournisseur: "",
  prixAchat: "", prixVente: "", tauxTvaPdm: "0", seuil: "0", conservation: "", categorieDelivrance: "" };
const versSaisie = (p: Produit): Saisie => ({ nom: p.nom, dci: p.dci ?? "", codeBarres: p.codeBarres ?? "", categorieId: p.categorieId ?? "", formeId: p.formeId ?? "",
  dosage: p.dosage ?? "", presentation: p.presentation ?? "", fabricant: p.fabricant ?? "", fournisseur: p.fournisseur ?? "", prixAchat: String(p.prixAchat),
  prixVente: String(p.prixVente), tauxTvaPdm: String(p.tauxTvaPdm), seuil: String(p.seuil), conservation: p.conservation ?? "", categorieDelivrance: p.categorieDelivrance ?? "" });

/** Formulaire de fiche produit (création ou modification). Les erreurs du serveur s'affichent sur le champ concerné. */
export function FormulaireProduit({ produit, onFin, onAnnuler }: { produit?: Produit; onFin: (p: Produit) => void; onAnnuler?: () => void }) {
  const ref = useReferentiels();
  const [s, setS] = useState<Saisie>(produit ? versSaisie(produit) : vide);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  if (!ref.donnees) return <Chargement />;
  const { categories, formes, parametres } = ref.donnees;
  const set = (k: keyof Saisie) => (v: string) => { setS({ ...s, [k]: v }); setErreurs(({ [k]: _, ...r }) => r); };
  const entier = (v: string) => { const t = v.replace(/[\s  ]/g, ""); return t === "" ? undefined : /^\d+$/.test(t) ? Number(t) : Number.NaN; };
  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    const err: Record<string, string> = {};
    if (s.nom.trim().length < 2) err.nom = "Nom du produit obligatoire.";
    const pv = entier(s.prixVente), pa = entier(s.prixAchat), seuil = entier(s.seuil);
    if (pv === undefined || Number.isNaN(pv)) err.prixVente = "Prix de vente en francs, sans décimales.";
    if (Number.isNaN(pa)) err.prixAchat = "Prix d'achat en francs, sans décimales.";
    if (Number.isNaN(seuil)) err.seuil = "Seuil en nombre entier.";
    if (Object.keys(err).length) { setErreurs(err); return; }
    const n = (v: string) => v.trim() || null;
    const corps = { nom: s.nom.trim(), dci: n(s.dci), codeBarres: n(s.codeBarres), categorieId: s.categorieId || null, formeId: s.formeId || null, dosage: n(s.dosage),
      presentation: n(s.presentation), fabricant: n(s.fabricant), fournisseur: n(s.fournisseur), prixAchat: pa ?? 0, prixVente: pv, tauxTvaPdm: Number(s.tauxTvaPdm),
      seuil: seuil ?? 0, conservation: n(s.conservation), categorieDelivrance: n(s.categorieDelivrance) };
    setEnvoi(true);
    try {
      onFin(produit ? await api.patch<Produit>(`/api/produits/${produit.id}`, corps) : await api.post<Produit>("/api/produits", corps));
    } catch (er) {
      const champs = (er as { champs?: { champ: string; message: string }[] }).champs;
      if (champs?.length) { setErreurs(Object.fromEntries(champs.map((c) => [c.champ, c.message]))); setErreur("Certaines informations sont invalides : voir les champs en rouge."); }
      else setErreur(messageErreur(er));
    } finally { setEnvoi(false); }
  };
  const champ = (k: keyof Saisie, label: string, o: Partial<Parameters<typeof Champ>[0]> = {}) => <Champ label={label} valeur={s[k]} onChange={set(k)} erreur={erreurs[k]} {...o} />;
  const tva: [string, string][] = [["0", "Non soumis à la TVA"], ...parametres.tauxTva.map((t) => [String(t.tauxPdm), `${t.libelle} (${tauxTexte(t.tauxPdm)})`] as [string, string])];
  return (
    <form onSubmit={envoyer} noValidate style={{ display: "grid", gap: 12 }}>
      <fieldset className="cases-profil"><legend>Identification</legend>
        {champ("nom", "Nom commercial", { requis: true, autoFocus: !produit, placeholder: "Ex. Paracétamol 500 mg" })}
        <div className="grille-champs">{champ("dci", "DCI (dénomination commune)")}{champ("codeBarres", "Code-barres", { aide: "Lu à la douchette ou saisi. Laisser vide s'il n'y en a pas." })}</div>
        <div className="grille-champs">
          <Selection label="Catégorie ou famille" valeur={s.categorieId} onChange={set("categorieId")} options={[["", "—"], ...optionsCategories(categories)]} />
          <Selection label="Forme" valeur={s.formeId} onChange={set("formeId")} options={[["", "—"], ...formes.filter((x) => !x.archive).map((x) => [x.id, x.nom] as [string, string])]} />
        </div>
        <div className="grille-champs">{champ("dosage", "Dosage", { placeholder: "Ex. 500 mg" })}{champ("presentation", "Présentation", { placeholder: "Ex. Boîte de 16 comprimés" })}</div>
        <div className="grille-champs">{champ("fabricant", "Fabricant")}{champ("fournisseur", "Fournisseur habituel")}</div>
      </fieldset>
      <fieldset className="cases-profil"><legend>Prix et stock</legend>
        <div className="grille-champs">
          {champ("prixAchat", "Prix d'achat de référence (FCFA)", { inputMode: "numeric" })}
          {champ("prixVente", "Prix de vente (FCFA)", { requis: true, inputMode: "numeric" })}
        </div>
        <div className="grille-champs">
          <Selection label="TVA" valeur={s.tauxTvaPdm} onChange={set("tauxTvaPdm")} options={tva}
            aide={parametres.tauxTva.length ? undefined : "Aucun taux saisi : la pharmacie les ajoute dans Administration › Pharmacie."} />
          {champ("seuil", "Seuil d'alerte (boîtes)", { inputMode: "numeric", aide: "Alerte quand le stock vendable descend à ce niveau." })}
        </div>
      </fieldset>
      <fieldset className="cases-profil"><legend>Informations complémentaires</legend>
        <div className="grille-champs">
          {champ("conservation", "Conditions de conservation", { placeholder: "Ex. Entre 2 et 8 °C" })}
          {champ("categorieDelivrance", "Catégorie de délivrance", { aide: "Information saisie par la pharmacie ; le logiciel n'en déduit aucune règle." })}
        </div>
      </fieldset>
      {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
      <div className="actions-form">
        {onAnnuler && <button type="button" className="btn" onClick={onAnnuler}>Annuler</button>}
        <button className="btn btn-principal" disabled={envoi} aria-busy={envoi || undefined}>{envoi ? "Enregistrement…" : produit ? "Enregistrer les modifications" : "Créer le produit"}</button>
      </div>
    </form>
  );
}

export function NouveauProduit() {
  const toast = useToast();
  return (
    <>
      <div className="entete-page"><div><h2>Nouveau produit</h2><p>Le code interne est attribué automatiquement. Le stock s'ajoute ensuite par une entrée de stock (lot et péremption).</p></div></div>
      <section className="panneau" style={{ maxWidth: 900 }}>
        <FormulaireProduit onFin={(p) => { toast(`Produit ${p.code} créé.`); aller(`/catalogue/produits/${p.id}`); }} onAnnuler={() => aller("/catalogue")} />
      </section>
    </>
  );
}

/** Fiche produit : informations, prix et historique, lots en stock, statut. */
export function FicheProduit({ id }: { id: string }) {
  const { a } = useSession();
  const toast = useToast();
  const p = useDonnees(() => api.get<Produit>(`/api/produits/${id}`), [id]);
  const lots = useDonnees(() => (a("stock.read") ? api.get<Page<Lot>>(`/api/lots${qs({ produit: id, enStock: "non", taille: 100 })}`) : Promise.resolve(null)), [id]);
  const [edition, setEdition] = useState(false);
  const [statut, setStatut] = useState<null | "active" | "suspended" | "archived">(null);
  if (p.erreur) return <div className="alerte alerte-erreur">{p.erreur} <a href="#/catalogue">Retour</a></div>;
  if (!p.donnees) return <Chargement />;
  const x = p.donnees;
  const ligne = (l: string, v: React.ReactNode) => <><dt className="discret">{l}</dt><dd style={{ margin: 0 }}>{v || <span className="discret">—</span>}</dd></>;
  return (
    <>
      <div><a href="#/catalogue" className="btn-lien">← Produits</a></div>
      <div className="entete-page">
        <div><h2>{x.nom}</h2><p className="infos"><span className="num">{x.code}</span>{x.dci ? ` · ${x.dci}` : ""} · <BadgeStock p={x} /></p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {a("stock.create") && x.statut !== "archived" && <button className="btn btn-principal" onClick={() => aller(`/stock/entree?produit=${x.id}`)}>+ Entrée de stock</button>}
          {a("catalog.update") && x.statut !== "archived" && <button className="btn" onClick={() => setEdition(true)}>Modifier</button>}
          {a("catalog.archive") && (x.statut === "active"
            ? <><button className="btn" onClick={() => setStatut("suspended")}>Suspendre</button><button className="btn btn-danger" onClick={() => setStatut("archived")}>Archiver</button></>
            : <button className="btn" onClick={() => setStatut("active")}>Réactiver</button>)}
        </div>
      </div>
      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><h3>Lots</h3></div>
          {!a("stock.read") ? <p className="discret">Consultation du stock non autorisée.</p> : !lots.donnees ? <Chargement /> : (
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>N° de lot</th><th>Péremption</th><th className="montant">Quantité</th><th>Emplacement</th><th>État</th></tr></thead>
                <tbody>
                  {lots.donnees.elements.length === 0 && <tr><td colSpan={5} className="vide">Aucun lot : faites une entrée de stock.</td></tr>}
                  {lots.donnees.elements.map((l) => (
                    <tr key={l.id} className="cliquable" tabIndex={0} onClick={() => aller(`/stock/lots/${l.id}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/stock/lots/${l.id}`)}>
                      <td className="num"><b>{l.numero}</b></td><td className="num">{dateFr(l.peremption)}</td><td className="montant"><b>{formatMontant(l.quantite)}</b></td>
                      <td>{l.emplacement ?? <span className="discret">—</span>}</td><td>{l.quantite === 0 ? <span className="badge badge-neutre">Épuisé</span> : <BadgeLot l={l} />}</td>
                    </tr>))}
                </tbody>
                <tfoot><tr><th colSpan={2}>Stock vendable / total</th><th className="montant">{formatMontant(x.stock.vendable)} / {formatMontant(x.stock.total)}</th><th colSpan={2}>Seuil : {x.seuil}</th></tr></tfoot>
              </table>
            </div>)}
        </section>
        <section className="panneau" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div className="entete-panneau" style={{ margin: 0 }}><h3>Fiche</h3></div>
          <dl className="resume-profil">
            {ligne("Catégorie", x.categorie)}{ligne("Forme", x.forme)}{ligne("Dosage", x.dosage)}{ligne("Présentation", x.presentation)}
            {ligne("Fabricant", x.fabricant)}{ligne("Fournisseur habituel", x.fournisseur)}{ligne("Code-barres", x.codeBarres && <span className="num">{x.codeBarres}</span>)}
            {ligne("Prix d'achat", <><Montant v={x.prixAchat} /> FCFA</>)}{ligne("Prix de vente", <b><Montant v={x.prixVente} /> FCFA</b>)}{ligne("TVA", tauxTexte(x.tauxTvaPdm))}
            {ligne("Conservation", x.conservation)}{ligne("Catégorie de délivrance", x.categorieDelivrance)}
          </dl>
          <h3 style={{ margin: "4px 0 0" }}>Historique des prix</h3>
          <div className="tableau-conteneur">
            <table>
              <thead><tr><th>Date</th><th className="montant">Achat</th><th className="montant">Vente</th><th>TVA</th><th>Par</th></tr></thead>
              <tbody>{(x.historiquePrix ?? []).map((h, i) => (
                <tr key={i}><td className="num">{dateHeure(h.le)}</td><td className="montant"><Montant v={h.prixAchat} /></td><td className="montant"><Montant v={h.prixVente} /></td><td>{tauxTexte(h.tauxTvaPdm)}</td><td>{h.par}</td></tr>))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {edition && (
        <Modale titre={`Modifier ${x.nom}`} onFermer={() => setEdition(false)} large>
          <FormulaireProduit produit={x} onAnnuler={() => setEdition(false)} onFin={() => { setEdition(false); toast("Fiche enregistrée."); p.recharger(); }} />
        </Modale>)}
      {statut && <ConfirmerAction motif titre={statut === "archived" ? "Archiver ce produit ?" : statut === "suspended" ? "Suspendre ce produit ?" : "Réactiver ce produit ?"}
        libelle={statut === "archived" ? "Archiver" : statut === "suspended" ? "Suspendre" : "Réactiver"} danger={statut === "archived"}
        texte={statut === "archived" ? "Il disparaît des listes et ne pourra plus recevoir de stock ; son historique est conservé. Il peut être réactivé."
          : statut === "suspended" ? "Il reste visible mais ne doit plus être vendu ni commandé." : "Le produit redevient utilisable."}
        onValider={async (motif) => { await api.post(`/api/produits/${x.id}/statut`, { statut, motif }); toast("Statut modifié."); p.recharger(); }}
        onFermer={() => setStatut(null)} />}
    </>
  );
}
