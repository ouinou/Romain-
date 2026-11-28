import { useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { Champ, Chargement, Modale, messageErreur, useDonnees, useRetarde, useToast } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import type { Compte } from "./commun";

const CLASSES: [string, string][] = [["", "Toutes les classes"], ["1", "1 · Ressources durables"], ["2", "2 · Actif immobilisé"], ["3", "3 · Stocks"], ["4", "4 · Tiers"],
  ["5", "5 · Trésorerie"], ["6", "6 · Charges des activités ordinaires"], ["7", "7 · Produits des activités ordinaires"], ["8", "8 · Autres charges et produits"], ["9", "9 · Hors bilan, analytique"]];

export function PlanComptable() {
  const { a } = useSession();
  const toast = useToast();
  const [recherche, setRecherche] = useState("");
  const [classe, setClasse] = useState("");
  const [creation, setCreation] = useState(false);
  const [importer, setImporter] = useState(false);
  const [archive, setArchive] = useState<Compte | null>(null);
  const rech = useRetarde(recherche);
  const liste = useDonnees(() => api.get<Compte[]>(`/api/comptabilite/comptes${qs({ recherche: rech, classe })}`), [rech, classe]);
  const admin = a("accounting.admin");
  return (
    <>
      <div className="entete-page">
        <div><h2>Plan comptable</h2><p>Comptes de l'entreprise, issus du plan de référence SYSCOHADA révisé (liste restreinte à vérifier) et des comptes ajoutés. Les classes et comptes à deux chiffres servent au regroupement ; on impute sur les comptes de trois chiffres et plus.</p></div>
        {admin && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setImporter(true)}>Importer un plan (CSV)</button>
          <button className="btn btn-principal" onClick={() => setCreation(true)}>+ Ajouter un compte</button>
        </div>}
      </div>
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="pc-r">Rechercher</label>
          <input id="pc-r" className="filtre" type="search" placeholder="Numéro ou intitulé…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          <label className="cache-visuel" htmlFor="pc-c">Classe</label>
          <select id="pc-c" className="filtre" value={classe} onChange={(e) => setClasse(e.target.value)}>{CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <div className="tableau-conteneur">
            <table>
              <thead><tr><th>Numéro</th><th>Intitulé</th><th>Classe</th><th>Usage</th><th>État</th>{admin && <th></th>}</tr></thead>
              <tbody>
                {liste.donnees.length === 0 && <tr><td colSpan={6} className="vide">Aucun compte ne correspond.</td></tr>}
                {liste.donnees.map((c) => (
                  <tr key={c.id}>
                    <td style={{ paddingLeft: 12 + Math.max(0, c.numero.length - 1) * 10 }}><b className="num">{c.numero}</b></td>
                    <td>{c.numero.length <= 2 ? <b>{c.libelle}</b> : c.libelle}</td>
                    <td>{c.classe}</td>
                    <td>{c.imputable ? "Imputable" : <span className="discret">Regroupement</span>}{c.protege && <span className="badge badge-neutre" style={{ marginLeft: 6 }} title="Mouvements réservés aux personnes autorisées">Protégé</span>}</td>
                    <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {!c.actif && <span className="badge badge-rouge">Archivé</span>}
                      {c.aVerifier && <span className="badge badge-orange" title="Numéro et intitulé à confirmer sur le texte officiel">À vérifier</span>}
                      {c.source !== "reference" && <span className="badge badge-neutre">{c.source === "import" ? "Importé" : "Ajouté"}</span>}
                    </td>
                    {admin && <td>{c.imputable && <button className="btn btn-petit" onClick={() => setArchive(c)}>{c.actif ? "Archiver" : "Réactiver"}</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creation && <NouveauCompte onFermer={() => setCreation(false)} onFin={liste.recharger} />}
      {importer && <ImportPlan onFermer={() => setImporter(false)} onFin={liste.recharger} />}
      {archive && <ConfirmerAction titre={`${archive.actif ? "Archiver" : "Réactiver"} le compte ${archive.numero} ?`} libelle={archive.actif ? "Archiver" : "Réactiver"} danger={archive.actif}
        texte={archive.actif ? "Plus aucune écriture ne pourra y être imputée. Les écritures existantes restent intactes." : "Le compte pourra de nouveau recevoir des écritures."}
        onValider={async () => { await api.patch(`/api/comptabilite/comptes/${archive.id}`, { actif: !archive.actif }); toast("Compte mis à jour."); liste.recharger(); }}
        onFermer={() => setArchive(null)} />}
    </>
  );
}

function NouveauCompte({ onFermer, onFin }: { onFermer: () => void; onFin: () => void }) {
  const toast = useToast();
  const [numero, setNumero] = useState("");
  const [libelle, setLibelle] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    try {
      const r = await api.post<{ parent: { numero: string; libelle: string } }>("/api/comptabilite/comptes", { numero, libelle });
      toast(`Compte ${numero} créé, rattaché à ${r.parent.numero} ${r.parent.libelle}.`); onFin(); onFermer();
    } catch (err) { setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre="Ajouter un compte" onFermer={onFermer}>
      <form onSubmit={envoyer} style={{ display: "grid", gap: 12 }}>
        <Champ label="Numéro" valeur={numero} onChange={(v) => setNumero(v.replace(/\D/g, "").slice(0, 12))} requis inputMode="numeric" autoFocus aide="3 à 12 chiffres. Il doit prolonger un compte existant, par exemple 5211 sous 521." />
        <Champ label="Intitulé" valeur={libelle} onChange={setLibelle} requis />
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal">Créer le compte</button></div>
      </form>
    </Modale>
  );
}

function ImportPlan({ onFermer, onFin }: { onFermer: () => void; onFin: () => void }) {
  const [contenu, setContenu] = useState("");
  const [resultat, setResultat] = useState<{ ajoutes: number; existants: number; erreurs: string[] } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const lireFichier = (f: File | undefined) => { if (!f) return; if (f.size > 2_000_000) { setErreur("Fichier trop volumineux (2 Mo maximum)."); return; } f.text().then(setContenu); };
  const envoyer = async () => {
    setErreur(null);
    try { setResultat(await api.post("/api/comptabilite/comptes/import", { contenu })); onFin(); } catch (err) { setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre="Importer un plan de comptes" onFermer={onFermer} large>
      <p className="discret" style={{ margin: 0 }}>Fichier CSV, une ligne par compte : <code>numero;libelle</code>. Seuls les comptes absents sont ajoutés ; aucun compte existant n'est modifié ni supprimé. Utilisez de préférence le plan officiel SYSCOHADA révisé.</p>
      {!resultat ? <>
        <div className="champ"><label htmlFor="imp-f">Fichier CSV</label><input id="imp-f" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => lireFichier(e.target.files?.[0])} /></div>
        <div className="champ"><label htmlFor="imp-t">Contenu</label><textarea id="imp-t" rows={8} value={contenu} onChange={(e) => setContenu(e.target.value)} placeholder={"numero;libelle\n6061;Eau\n6062;Électricité"} /></div>
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal" disabled={!contenu.trim()} onClick={envoyer}>Importer</button></div>
      </> : <>
        <div className="alerte alerte-succes">{resultat.ajoutes} compte(s) ajouté(s), {resultat.existants} déjà présent(s), {resultat.erreurs.length} ligne(s) ignorée(s).</div>
        {resultat.erreurs.length > 0 && <ul style={{ margin: 0 }}>{resultat.erreurs.map((x) => <li key={x}>{x}</li>)}</ul>}
        <div className="actions-form"><button className="btn btn-principal" onClick={onFermer}>Fermer</button></div>
      </>}
    </Modale>
  );
}
