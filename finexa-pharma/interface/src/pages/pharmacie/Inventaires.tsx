import { useEffect, useMemo, useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Champ, Chargement, Modale, Pagination, Selection, dateHeure, messageErreur, useDonnees, useToast } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import type { Page } from "../../types";
import { dateFr, formatMontant, optionsCategories, useReferentiels } from "./commun";

interface ResumeInventaire { id: string; numero: string; libelle: string; statut: string; statutLibelle: string; creeLe: string; clotureLe: string | null; auteur: string; lignes: number; comptees: number }
interface Inventaire {
  id: string; numero: string; libelle: string; statut: "open" | "validated" | "cancelled"; statutLibelle: string; auteur: string; creeLe: string; cloturePar: string | null; clotureLe: string | null;
  lignes: { lotId: string; lot: string; peremption: string; produitId: string; produit: string; codeProduit: string; emplacement: string | null; theorique: number; compte: number | null; ecart: number | null; stockActuel: number }[];
  resume: { lignes: number; comptees: number; ecarts: number; ecartTotal: number };
}
const badge = (s: string, l: string) => <span className={"badge " + (s === "open" ? "badge-orange" : s === "validated" ? "badge-vert" : "badge-neutre")}>{l}</span>;

export function Inventaires() {
  const { a } = useSession();
  const [page, setPage] = useState(1);
  const [ouvrir, setOuvrir] = useState(false);
  const liste = useDonnees(() => api.get<Page<ResumeInventaire>>(`/api/inventaires${qs({ page, taille: 20 })}`), [page]);
  return (
    <>
      <div className="entete-page"><div><h2>Inventaires</h2><p>Comptage physique par lot. Les écarts validés deviennent des mouvements « écart d'inventaire ».</p></div>
        {a("stock.create") && <button className="btn btn-principal" onClick={() => setOuvrir(true)}>+ Nouvel inventaire</button>}</div>
      <section className="panneau">
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur"><table>
              <thead><tr><th>N°</th><th>Libellé</th><th>Ouvert le</th><th>Par</th><th className="montant">Lignes comptées</th><th>Statut</th></tr></thead>
              <tbody>
                {liste.donnees.elements.length === 0 && <tr><td colSpan={6} className="vide">Aucun inventaire pour l'instant.</td></tr>}
                {liste.donnees.elements.map((i) => (
                  <tr key={i.id} className="cliquable" tabIndex={0} onClick={() => aller(`/stock/inventaires/${i.id}`)} onKeyDown={(e) => e.key === "Enter" && aller(`/stock/inventaires/${i.id}`)}>
                    <td className="num">{i.numero}</td><td><b>{i.libelle}</b></td><td className="num">{dateHeure(i.creeLe)}</td><td>{i.auteur}</td>
                    <td className="montant">{i.comptees} / {i.lignes}</td><td>{badge(i.statut, i.statutLibelle)}</td></tr>))}
              </tbody></table></div>
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} />
          </>)}
      </section>
      {ouvrir && <Ouverture onFermer={() => setOuvrir(false)} />}
    </>
  );
}

function Ouverture({ onFermer }: { onFermer: () => void }) {
  const ref = useReferentiels();
  const toast = useToast();
  const [libelle, setLibelle] = useState(`Inventaire du ${new Date().toLocaleDateString("fr-FR")}`);
  const [categorie, setCategorie] = useState("");
  const [emplacement, setEmplacement] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    try {
      const i = await api.post<Inventaire>("/api/inventaires", { libelle, categorieId: categorie || null, emplacementId: emplacement || null });
      toast(`Inventaire ${i.numero} ouvert : ${i.lignes.length} lot(s) à compter.`); aller(`/stock/inventaires/${i.id}`);
    } catch (er) { setErreur(messageErreur(er)); }
  };
  return (
    <Modale titre="Nouvel inventaire" onFermer={onFermer}>
      {!ref.donnees ? <Chargement /> : (
        <form onSubmit={valider} style={{ display: "grid", gap: 12 }}>
          <Champ label="Libellé" valeur={libelle} onChange={setLibelle} requis />
          <Selection label="Catégorie (facultatif)" valeur={categorie} onChange={setCategorie} options={[["", "Tout le stock"], ...optionsCategories(ref.donnees.categories)]} />
          <Selection label="Emplacement (facultatif)" valeur={emplacement} onChange={setEmplacement} options={[["", "Tous les emplacements"], ...ref.donnees.emplacements.filter((x) => !x.archive).map((x) => [x.id, x.nom] as [string, string])]} />
          <p className="discret" style={{ margin: 0 }}>Une ligne est créée pour chaque lot en stock du périmètre. La vente peut continuer pendant le comptage : le stock théorique est relu au moment où chaque lot est compté.</p>
          {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
          <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal">Ouvrir l'inventaire</button></div>
        </form>)}
    </Modale>
  );
}

/** Saisie du comptage : une colonne « compté » par lot, l'écart s'affiche à l'enregistrement. */
export function FicheInventaire({ id }: { id: string }) {
  const { a } = useSession();
  const toast = useToast();
  const inv = useDonnees(() => api.get<Inventaire>(`/api/inventaires/${id}`), [id]);
  const [saisies, setSaisies] = useState<Record<string, string>>({});
  const [filtre, setFiltre] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [valider, setValider] = useState(false);
  const [annuler, setAnnuler] = useState(false);
  useEffect(() => { if (inv.donnees) setSaisies(Object.fromEntries(inv.donnees.lignes.map((l) => [l.lotId, l.compte === null ? "" : String(l.compte)]))); }, [inv.donnees]);
  const lignes = useMemo(() => (inv.donnees?.lignes ?? []).filter((l) => !filtre || `${l.produit} ${l.lot} ${l.codeProduit}`.toLowerCase().includes(filtre.toLowerCase())), [inv.donnees, filtre]);
  if (inv.erreur) return <div className="alerte alerte-erreur">{inv.erreur} <a href="#/stock/inventaires">Retour</a></div>;
  if (!inv.donnees) return <Chargement />;
  const x = inv.donnees;
  const ouvert = x.statut === "open" && a("stock.create");
  const modifiees = x.lignes.filter((l) => (saisies[l.lotId] ?? "") !== (l.compte === null ? "" : String(l.compte)));
  const enregistrer = async () => {
    const invalides = modifiees.filter((l) => saisies[l.lotId] !== "" && !/^\d+$/.test(saisies[l.lotId]));
    if (invalides.length) { toast(`Quantité invalide pour ${invalides[0].produit} (lot ${invalides[0].lot}) : nombre entier attendu.`, true); return; }
    setEnvoi(true);
    try {
      await api.put(`/api/inventaires/${id}/comptages`, { lignes: modifiees.map((l) => ({ lotId: l.lotId, compte: saisies[l.lotId] === "" ? null : Number(saisies[l.lotId]) })) });
      toast("Comptages enregistrés."); inv.recharger();
    } catch (e) { toast(messageErreur(e), true); }
    finally { setEnvoi(false); }
  };
  return (
    <>
      <div><a href="#/stock/inventaires" className="btn-lien">← Inventaires</a></div>
      <div className="entete-page">
        <div><h2>{x.libelle}</h2><p className="infos"><span className="num">{x.numero}</span> · ouvert le {dateHeure(x.creeLe)} par {x.auteur} · {badge(x.statut, x.statutLibelle)}
          {x.clotureLe && <> · clos le {dateHeure(x.clotureLe)} par {x.cloturePar}</>}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ouvert && <button className="btn" disabled={!modifiees.length || envoi} onClick={enregistrer}>{envoi ? "Enregistrement…" : `Enregistrer les comptages${modifiees.length ? ` (${modifiees.length})` : ""}`}</button>}
          {x.statut === "open" && a("stock.approve") && <button className="btn btn-succes" disabled={!!modifiees.length || !x.resume.comptees} onClick={() => setValider(true)} title={modifiees.length ? "Enregistrez d'abord les comptages" : undefined}>Valider l'inventaire</button>}
          {x.statut === "open" && a("stock.approve") && <button className="btn btn-danger" onClick={() => setAnnuler(true)}>Annuler</button>}
        </div>
      </div>
      <div className="indicateurs">
        <div className="indicateur"><div className="lib">Lots comptés</div><div className="val">{x.resume.comptees} / {x.resume.lignes}</div><div className="aide">les lots non comptés ne changent pas</div></div>
        <div className="indicateur"><div className="lib">Lots avec écart</div><div className="val">{x.resume.ecarts}</div><div className="aide">après enregistrement</div></div>
        <div className="indicateur"><div className="lib">Écart total</div><div className="val">{x.resume.ecartTotal > 0 ? "+" : ""}{formatMontant(x.resume.ecartTotal)}</div><div className="aide">boîte(s)</div></div>
      </div>
      <section className="panneau">
        <div className="filtres" role="search"><label className="cache-visuel" htmlFor="i-f">Filtrer</label>
          <input id="i-f" className="filtre" type="search" placeholder="Filtrer par produit ou n° de lot…" value={filtre} onChange={(e) => setFiltre(e.target.value)} /></div>
        <div className="tableau-conteneur"><table>
          <thead><tr><th>Produit</th><th>Lot</th><th>Péremption</th><th>Emplacement</th><th className="montant">Théorique</th><th className="montant">Compté</th><th className="montant">Écart</th></tr></thead>
          <tbody>{lignes.map((l) => (
            <tr key={l.lotId}>
              <td><b>{l.produit}</b> <span className="discret num">{l.codeProduit}</span></td><td className="num">{l.lot}</td><td className="num">{dateFr(l.peremption)}</td><td>{l.emplacement ?? "—"}</td>
              <td className="montant">{formatMontant(l.compte === null ? l.stockActuel : l.theorique)}</td>
              <td className="montant">{ouvert
                ? <input className="saisie-compte" inputMode="numeric" aria-label={`Quantité comptée : ${l.produit}, lot ${l.lot}`} value={saisies[l.lotId] ?? ""} onChange={(e) => setSaisies({ ...saisies, [l.lotId]: e.target.value.replace(/[^\d]/g, "") })} />
                : l.compte === null ? <span className="discret">non compté</span> : formatMontant(l.compte)}</td>
              <td className={"montant" + (l.ecart && l.ecart < 0 ? " negatif" : "")}>{l.ecart === null ? "" : l.ecart === 0 ? "0" : `${l.ecart > 0 ? "+" : "−"}${formatMontant(Math.abs(l.ecart))}`}</td>
            </tr>))}
          </tbody></table></div>
      </section>
      {valider && <ConfirmerAction titre={`Valider l'inventaire ${x.numero} ?`} libelle="Valider"
        texte={<>Chaque écart enregistré ({x.resume.ecarts} lot(s), total {x.resume.ecartTotal > 0 ? "+" : ""}{x.resume.ecartTotal}) devient un mouvement définitif. Les {x.resume.lignes - x.resume.comptees} lot(s) non compté(s) restent inchangés. L'inventaire sera figé.</>}
        onValider={async () => { await api.post(`/api/inventaires/${id}/validation`, {}); toast("Inventaire validé."); inv.recharger(); }} onFermer={() => setValider(false)} />}
      {annuler && <ConfirmerAction motif danger titre="Annuler cet inventaire ?" libelle="Annuler l'inventaire" texte="Aucun mouvement ne sera créé. Les comptages saisis restent consultables."
        onValider={async (motif) => { await api.post(`/api/inventaires/${id}/annulation`, { motif }); toast("Inventaire annulé."); inv.recharger(); }} onFermer={() => setAnnuler(false)} />}
    </>
  );
}
