import { useEffect, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { aller, effacerParametres, useParametres } from "../../routeur";
import { Champ, Chargement, Modale, Selection, messageErreur, useDonnees, useToast } from "../../composants/ui";
import { Montant, dateFr } from "../comptabilite/commun";
import { ICONES_TRESORERIE, NATURES, TYPES_TRESORERIE, comptesTresorerie, type CompteTresorerie, type Mouvement } from "./commun";
import { OperationModale, type TypeOperation } from "./OperationModale";
import type { Page } from "../../types";

interface Tableau { total: number; caisses: number; banques: number; entreesJour: number; sortiesJour: number; ecrituresAValider: number | null }

export function Tresorerie() {
  const { a } = useSession();
  const comptes = useDonnees(comptesTresorerie, []);
  const tableau = useDonnees(() => api.get<Tableau>("/api/tresorerie/tableau"), []);
  const derniers = useDonnees(() => api.get<Page<Mouvement>>("/api/tresorerie/mouvements?taille=8"), []);
  const [operation, setOperation] = useState<{ type: TypeOperation; compte?: string } | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const [caissiers, setCaissiers] = useState<CompteTresorerie | null>(null);
  const peutSaisir = a("treasury.create") || a("cash.create");
  const recharger = () => { comptes.recharger(); tableau.recharger(); derniers.recharger(); };
  // Commandes du ruban (Règlement, Dépense, Transfert) : #/tresorerie?action=entree|sortie|transfert.
  const params = useParametres();
  const action = params.get("action");
  useEffect(() => {
    if (!comptes.donnees || !action) return;
    if ((action === "entree" || action === "sortie" || action === "transfert") && peutSaisir) setOperation({ type: action });
    effacerParametres();
  }, [action, comptes.donnees, peutSaisir]);
  if (comptes.erreur) return <div className="alerte alerte-erreur">{comptes.erreur}</div>;
  if (!comptes.donnees || !tableau.donnees) return <Chargement />;
  const t = tableau.donnees;
  return (
    <>
      <div className="entete-page">
        <div><h2>Caisses et banques</h2><p>Enregistrez les encaissements, les dépenses et les transferts. Chaque opération produit son écriture comptable, que le comptable valide ensuite.</p></div>
        {peutSaisir && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-principal" onClick={() => setOperation({ type: "entree" })}>+ Encaissement</button>
          <button className="btn" onClick={() => setOperation({ type: "sortie" })}>− Dépense</button>
          <button className="btn" onClick={() => setOperation({ type: "transfert" })}>⇄ Transfert</button>
          {a("sales.create") && <button className="btn" onClick={() => aller("/ventes/nouvelle")}>Nouvelle vente</button>}
        </div>}
      </div>
      <section className="indicateurs" aria-label="Trésorerie">
        <div className="indicateur"><div className="lib">Trésorerie disponible (FCFA)</div><div className="val"><Montant v={t.total} /></div><div className="aide">Comptes qui vous sont accessibles</div></div>
        <div className="indicateur"><div className="lib">Encaissé aujourd'hui</div><div className="val"><Montant v={t.entreesJour} /></div><div className="aide">Entrées du jour</div></div>
        <div className="indicateur"><div className="lib">Décaissé aujourd'hui</div><div className="val"><Montant v={t.sortiesJour} /></div><div className="aide">Sorties du jour</div></div>
        {t.ecrituresAValider !== null
          ? <div className={"indicateur" + (t.ecrituresAValider ? " alerte-ind" : "")}><div className="lib">Écritures à valider</div><div className="val">{t.ecrituresAValider}</div><div className="aide"><a href="#/comptabilite/ecritures">Générées par les opérations</a></div></div>
          : <div className="indicateur"><div className="lib">Caisses / banques</div><div className="val"><Montant v={t.caisses} /></div><div className="aide">dont banques <Montant v={t.banques} /></div></div>}
      </section>
      <section className="panneau">
        <div className="entete-panneau"><div><h3>Comptes</h3><p>Soldes calculés à partir des opérations enregistrées</p></div>
          {a("treasury.admin") && <button className="btn btn-petit" onClick={() => setNouveau(true)}>+ Caisse, banque ou mobile money</button>}</div>
        {comptes.donnees.length === 0 ? <div className="vide">{a("treasury.admin") ? "Aucun compte : créez votre première caisse." : "Aucune caisse ne vous est attribuée. Demandez au DAF."}</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {comptes.donnees.map((c) => (
              <div key={c.id} className="indicateur repere-orange" style={{ display: "grid", gap: 6, opacity: c.actif ? 1 : .6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b>{ICONES_TRESORERIE[c.type]} {c.nom}</b><span className="badge badge-neutre">{TYPES_TRESORERIE[c.type]}</span>
                </div>
                <div className="val" style={{ margin: 0 }}><Montant v={c.solde} /> <span style={{ fontSize: 13 }}>FCFA</span></div>
                <div className="aide">Compte {c.compte.numero} · journal {c.journal}{c.banque ? ` · ${c.banque}` : ""}</div>
                <div className="aide">Aujourd'hui : +<Montant v={c.entreesJour} /> / −<Montant v={c.sortiesJour} /></div>
                {c.type === "cash" && <div className="aide">Caissier(s) : {c.caissiers.length ? c.caissiers.map((x) => x.nom).join(", ") : "aucun"}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {peutSaisir && c.actif && <><button className="btn btn-petit" onClick={() => setOperation({ type: "entree", compte: c.id })}>+ Encaisser</button>
                    <button className="btn btn-petit" onClick={() => setOperation({ type: "sortie", compte: c.id })}>− Payer</button></>}
                  <a className="btn btn-petit" href={`#/tresorerie/mouvements?compte=${c.id}`}>Historique</a>
                  {a("treasury.admin") && c.type === "cash" && <button className="btn btn-petit" onClick={() => setCaissiers(c)}>Caissiers</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panneau">
        <div className="entete-panneau"><div><h3>Dernières opérations</h3></div><a className="btn btn-petit" href="#/tresorerie/mouvements">Tous les mouvements</a></div>
        {!derniers.donnees ? <Chargement /> : derniers.donnees.elements.length === 0 ? <div className="vide">Aucune opération.</div> : <TableMouvements mouvements={derniers.donnees.elements} />}
      </section>
      {operation && <OperationModale type={operation.type} compteInitial={operation.compte} comptes={comptes.donnees} onFermer={() => setOperation(null)} onFin={recharger} />}
      {nouveau && <NouveauCompte onFermer={() => setNouveau(false)} onFin={recharger} />}
      {caissiers && <Caissiers compte={caissiers} onFermer={() => setCaissiers(null)} onFin={recharger} />}
    </>
  );
}

export function TableMouvements({ mouvements }: { mouvements: Mouvement[] }) {
  return (
    <div className="tableau-conteneur">
      <table>
        <thead><tr><th>Date</th><th>Référence</th><th>Compte</th><th>Opération</th><th>Libellé</th><th className="montant">Entrée</th><th className="montant">Sortie</th><th>Comptabilité</th></tr></thead>
        <tbody>{mouvements.map((m) => (
          <tr key={m.id} className="cliquable" tabIndex={0} onClick={() => aller(`/tresorerie/mouvements/${m.id}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/tresorerie/mouvements/${m.id}`)}>
            <td className="num">{dateFr(m.date)}</td><td className="num">{m.reference}</td><td>{m.compte.nom}</td>
            <td>{NATURES[m.nature] ?? m.nature}{m.annuleePar && <span className="badge badge-neutre" style={{ marginLeft: 6 }}>Annulé</span>}</td>
            <td>{m.libelle}</td>
            <td className="montant">{m.sens === "entree" ? <Montant v={m.montant} /> : ""}</td><td className="montant">{m.sens === "sortie" ? <Montant v={m.montant} /> : ""}</td>
            <td>{m.ecriture ? (m.ecriture.statut === "validee" ? <span className="badge badge-vert">Validée</span> : <span className="badge badge-orange">À valider</span>) : <span className="discret">—</span>}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

function NouveauCompte({ onFermer, onFin }: { onFermer: () => void; onFin: () => void }) {
  const toast = useToast();
  const [type, setType] = useState("caisse");
  const [nom, setNom] = useState("");
  const [banque, setBanque] = useState("");
  const [reference, setReference] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    try { await api.post("/api/tresorerie/comptes", { type, nom, banque: banque || undefined, referenceBancaire: reference || undefined }); toast("Compte de trésorerie créé."); onFin(); onFermer(); }
    catch (err) { setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre="Nouveau compte de trésorerie" onFermer={onFermer}>
      <form onSubmit={envoyer} style={{ display: "grid", gap: 12 }}>
        <Selection label="Type" valeur={type} onChange={setType} options={[["caisse", "Caisse (espèces)"], ["banque", "Compte bancaire"], ["mobile", "Mobile money (Orange Money, MTN MoMo…)"]]} />
        <Champ label="Nom" valeur={nom} onChange={setNom} requis placeholder={type === "caisse" ? "Ex. Caisse boutique Akwa" : "Ex. Compte courant"} />
        {type !== "caisse" && <div className="grille-champs"><Champ label={type === "mobile" ? "Opérateur" : "Banque"} valeur={banque} onChange={setBanque} /><Champ label={type === "mobile" ? "Numéro marchand" : "RIB"} valeur={reference} onChange={setReference} /></div>}
        <p className="discret" style={{ margin: 0 }}>Un sous-compte comptable est créé automatiquement ({type === "caisse" ? "5711, 5712…" : "5211, 5212…"}). Le rattachement du mobile money au compte 52 est à confirmer avec votre expert-comptable.</p>
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal">Créer</button></div>
      </form>
    </Modale>
  );
}

function Caissiers({ compte, onFermer, onFin }: { compte: CompteTresorerie; onFermer: () => void; onFin: () => void }) {
  const toast = useToast();
  const possibles = useDonnees(() => api.get<{ id: string; nom: string }[]>("/api/tresorerie/caissiers-possibles"), []);
  const [choix, setChoix] = useState(compte.caissiers.map((c) => c.id));
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async () => {
    setErreur(null);
    try { await api.patch(`/api/tresorerie/comptes/${compte.id}`, { caissiers: choix }); toast("Caissiers mis à jour."); onFin(); onFermer(); }
    catch (err) { if ((err as { code?: string }).code !== "annulee") setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre={`Caissiers de « ${compte.nom} »`} onFermer={onFermer}>
      <p className="discret" style={{ margin: 0 }}>Un caissier ne voit et n'utilise que les caisses qui lui sont attribuées. Cette modification demande la confirmation de votre mot de passe.</p>
      {!possibles.donnees ? <Chargement /> : possibles.donnees.length === 0 ? <div className="alerte">Aucun utilisateur actif n'a le rôle Caissier.</div> : (
        <div style={{ display: "grid", gap: 8 }}>{possibles.donnees.map((p) => (
          <label key={p.id} className="case"><input type="checkbox" checked={choix.includes(p.id)} onChange={(e) => setChoix(e.target.checked ? [...choix, p.id] : choix.filter((x) => x !== p.id))} /> {p.nom}</label>))}
        </div>
      )}
      {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
      <div className="actions-form"><button className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal" onClick={envoyer}>Enregistrer</button></div>
    </Modale>
  );
}
