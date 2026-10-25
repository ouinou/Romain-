import { useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Chargement, messageErreur, useToast } from "../../composants/ui";
import { ConfirmerAction } from "../../composants/Confirmations";
import { useReferentiels, type Categorie, type Element } from "./commun";

const MODELE = "nom;dci;categorie;famille;forme;dosage;presentation;fabricant;fournisseur;code_barres;prix_achat;prix_vente;tva;seuil\r\n"
  + "Paracétamol 500 mg;Paracétamol;Médicaments;Antalgiques;Comprimé;500 mg;Boîte de 16;;;;350;500;;20\r\n";

/**
 * Import d'un catalogue existant (fichier CSV exporté d'un tableur). Toujours en deux temps : vérification
 * (rien n'est créé, toutes les erreurs sont listées avec leur numéro de ligne), puis import complet ou rien.
 */
export function ImportProduits() {
  const toast = useToast();
  const [fichier, setFichier] = useState<{ nom: string; contenu: string } | null>(null);
  const [res, setRes] = useState<{ lignes: number; valides: number; erreurs: { ligne: number; message: string }[]; crees: number; verifie: boolean } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const lire = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) { toast("Fichier trop volumineux (5 Mo au plus).", true); return; }
    const octets = new Uint8Array(await f.arrayBuffer());
    // Excel en français enregistre souvent en Windows-1252 ; on essaie l'UTF-8 d'abord.
    let contenu = new TextDecoder("utf-8").decode(octets);
    if (contenu.includes("\uFFFD")) contenu = new TextDecoder("windows-1252").decode(octets);
    setFichier({ nom: f.name, contenu }); setRes(null);
  };
  const envoyer = async (verifier: boolean) => {
    if (!fichier) return;
    setEnvoi(true);
    try {
      const r = await api.post<{ lignes: number; valides: number; erreurs: { ligne: number; message: string }[]; crees: number }>("/api/produits/import", { contenu: fichier.contenu, verifier });
      setRes({ ...r, verifie: verifier });
      if (!verifier && r.crees) { toast(`${r.crees} produit(s) importé(s).`); aller("/catalogue"); }
    } catch (e) { toast(messageErreur(e), true); }
    finally { setEnvoi(false); }
  };
  const modele = () => {
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob(["﻿" + MODELE], { type: "text/csv;charset=utf-8" }));
    lien.download = "modele-catalogue.csv"; lien.click();
  };
  return (
    <>
      <div className="entete-page"><div><h2>Importer un catalogue</h2><p>Reprise d'une liste de produits depuis un tableur (CSV).</p></div></div>
      <div className="deux">
        <section className="panneau" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div className="entete-panneau" style={{ margin: 0 }}><h3>1. Choisir le fichier</h3></div>
          <p style={{ margin: 0 }}>Une ligne par produit. Colonnes obligatoires : <b>nom</b> et <b>prix_vente</b>. Les catégories, familles et formes absentes sont créées.
            La colonne <b>tva</b> (ex. 19,25) doit correspondre à un taux déjà saisi dans les paramètres de la pharmacie ; vide = non soumis.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="btn" style={{ cursor: "pointer" }}>{fichier ? "Changer de fichier" : "Choisir un fichier CSV"}
              <input type="file" accept=".csv,text/csv" style={{ display: "none" }} aria-label="Fichier CSV du catalogue" onChange={(e) => { lire(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <button type="button" className="btn btn-lien" onClick={modele}>Télécharger un modèle</button>
          </div>
          {fichier && <p className="discret" style={{ margin: 0 }}>Fichier : <b>{fichier.nom}</b></p>}
          <div className="actions-form" style={{ justifyContent: "flex-start" }}>
            <button className="btn btn-principal" disabled={!fichier || envoi} onClick={() => envoyer(true)}>{envoi ? "Vérification…" : "2. Vérifier le fichier"}</button>
            {res?.verifie && res.erreurs.length === 0 && <button className="btn btn-succes" disabled={envoi} onClick={() => envoyer(false)}>3. Importer {res.valides} produit(s)</button>}
          </div>
        </section>
        <section className="panneau" style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <div className="entete-panneau" style={{ margin: 0 }}><h3>Résultat de la vérification</h3></div>
          {!res ? <p className="discret" style={{ margin: 0 }}>Rien n'est créé tant que le fichier n'est pas vérifié sans erreur.</p>
            : res.erreurs.length ? (
              <>
                <div className="alerte alerte-erreur" role="alert">{res.erreurs.length} erreur(s) sur {res.lignes} ligne(s) : corrigez le fichier puis vérifiez-le de nouveau. Aucun produit n'a été créé.</div>
                <div className="tableau-conteneur"><table><thead><tr><th>Ligne</th><th>Problème</th></tr></thead>
                  <tbody>{res.erreurs.map((e, i) => <tr key={i}><td className="num">{e.ligne || "—"}</td><td>{e.message}</td></tr>)}</tbody></table></div>
              </>)
              : <div className="alerte alerte-succes">{res.valides} produit(s) prêts à être importés, aucune erreur.</div>}
        </section>
      </div>
    </>
  );
}

/** Catégories et familles, formes, emplacements : listes de choix de l'officine. On archive, on ne supprime pas. */
export function Referentiels() {
  const { a } = useSession();
  const toast = useToast();
  const ref = useReferentiels();
  const [ajout, setAjout] = useState<null | { type: "categorie" | "famille" | "forme" | "emplacement"; parent?: Categorie }>(null);
  const [archiver, setArchiver] = useState<null | { chemin: string; nom: string; archive: boolean; cle: "archivee" | "archive" }>(null);
  if (ref.erreur) return <div className="alerte alerte-erreur">{ref.erreur}</div>;
  if (!ref.donnees) return <Chargement />;
  const gerer = a("catalog.admin");
  const { categories, formes, emplacements } = ref.donnees;
  const liste = (titre: string, elements: Element[], chemin: string, type: "forme" | "emplacement") => (
    <section className="panneau">
      <div className="entete-panneau"><h3>{titre}</h3>{gerer && <button className="btn btn-petit" onClick={() => setAjout({ type })}>+ Ajouter</button>}</div>
      <ul className="liste-referentiel">{elements.map((x) => (
        <li key={x.id} className={x.archive ? "archive" : ""}><span>{x.nom}{x.natureLibelle && <span className="discret"> · {x.natureLibelle}</span>}{x.archive && <span className="badge badge-neutre">Archivé</span>}</span>
          {gerer && <button className="btn-lien" onClick={() => setArchiver({ chemin: `${chemin}/${x.id}`, nom: x.nom, archive: !x.archive, cle: "archive" })}>{x.archive ? "Réactiver" : "Archiver"}</button>}</li>))}
      </ul>
    </section>);
  return (
    <>
      <div className="entete-page"><div><h2>Catégories et référentiels</h2><p>Classement du catalogue. Un élément utilisé s'archive : il disparaît des listes de choix sans toucher aux fiches existantes.</p></div>
        {gerer && <button className="btn btn-principal" onClick={() => setAjout({ type: "categorie" })}>+ Nouvelle catégorie</button>}</div>
      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><h3>Catégories et familles</h3></div>
          {categories.length === 0 && <p className="discret">Aucune catégorie.</p>}
          {categories.map((c) => (
            <div key={c.id} className="bloc-categorie">
              <div className={"ligne-categorie" + (c.archivee ? " archive" : "")}><b>{c.nom}</b> <span className="discret">{c.produits} produit(s)</span>{c.archivee && <span className="badge badge-neutre">Archivée</span>}
                {gerer && <span className="actions-ligne">
                  {!c.archivee && <button className="btn-lien" onClick={() => setAjout({ type: "famille", parent: c })}>+ Famille</button>}
                  <button className="btn-lien" onClick={() => setArchiver({ chemin: `categories/${c.id}`, nom: c.nom, archive: !c.archivee, cle: "archivee" })}>{c.archivee ? "Réactiver" : "Archiver"}</button>
                </span>}</div>
              <ul className="liste-referentiel">{c.familles.map((f) => (
                <li key={f.id} className={f.archivee ? "archive" : ""}><span>{f.nom} <span className="discret">{f.produits} produit(s)</span>{f.archivee && <span className="badge badge-neutre">Archivée</span>}</span>
                  {gerer && <button className="btn-lien" onClick={() => setArchiver({ chemin: `categories/${f.id}`, nom: f.nom, archive: !f.archivee, cle: "archivee" })}>{f.archivee ? "Réactiver" : "Archiver"}</button>}</li>))}
              </ul>
            </div>))}
        </section>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {liste("Formes pharmaceutiques", formes, "formes", "forme")}
          {liste("Emplacements de rangement", emplacements, "emplacements", "emplacement")}
        </div>
      </div>
      {ajout && <Ajout type={ajout.type} parent={ajout.parent} onFermer={() => setAjout(null)} onFin={() => { setAjout(null); toast("Ajouté."); ref.recharger(); }} />}
      {archiver && <ConfirmerAction titre={`${archiver.archive ? "Archiver" : "Réactiver"} « ${archiver.nom} » ?`} libelle={archiver.archive ? "Archiver" : "Réactiver"}
        texte={archiver.archive ? "Il ne sera plus proposé dans les listes de choix. Les fiches qui l'utilisent restent inchangées." : "Il sera de nouveau proposé dans les listes de choix."}
        onValider={async () => { await api.patch(`/api/referentiels/${archiver.chemin}`, { [archiver.cle]: archiver.archive }); toast("Enregistré."); ref.recharger(); }}
        onFermer={() => setArchiver(null)} />}
    </>
  );
}

function Ajout({ type, parent, onFermer, onFin }: { type: "categorie" | "famille" | "forme" | "emplacement"; parent?: Categorie; onFermer: () => void; onFin: () => void }) {
  const [nom, setNom] = useState("");
  const [nature, setNature] = useState("shelf");
  return (
    <ConfirmerAction titre={type === "famille" ? `Nouvelle famille dans « ${parent!.nom} »` : type === "categorie" ? "Nouvelle catégorie" : type === "forme" ? "Nouvelle forme" : "Nouvel emplacement"}
      libelle="Ajouter" texte={<div style={{ display: "grid", gap: 10 }}>
        <div className="champ"><label htmlFor="ref-nom">Nom *</label><input id="ref-nom" value={nom} autoFocus maxLength={80} onChange={(e) => setNom(e.target.value)} /></div>
        {type === "emplacement" && <div className="champ"><label htmlFor="ref-nat">Nature</label>
          <select id="ref-nat" value={nature} onChange={(e) => setNature(e.target.value)}><option value="shelf">Rayon</option><option value="reserve">Réserve</option><option value="cold">Réfrigérateur</option><option value="other">Autre</option></select></div>}
      </div>}
      onValider={async () => {
        const chemin = type === "forme" ? "formes" : type === "emplacement" ? "emplacements" : "categories";
        await api.post(`/api/referentiels/${chemin}`, { nom, ...(type === "famille" ? { parentId: parent!.id } : {}), ...(type === "emplacement" ? { nature } : {}) });
        onFin();
      }} onFermer={onFermer} />
  );
}
