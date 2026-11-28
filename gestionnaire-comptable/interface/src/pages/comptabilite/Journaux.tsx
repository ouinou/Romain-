import { useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { Champ, Chargement, Modale, Selection, messageErreur, useDonnees, useToast } from "../../composants/ui";
import { TYPES_JOURNAL, type JournalCpt } from "./commun";

export function Journaux() {
  const { a } = useSession();
  const [creation, setCreation] = useState(false);
  const liste = useDonnees(() => api.get<JournalCpt[]>("/api/comptabilite/journaux"), []);
  return (
    <>
      <div className="entete-page">
        <div><h2>Journaux comptables</h2><p>Les écritures sont classées par nature d'opération. Chaque journal a sa propre numérotation, continue sur l'exercice.</p></div>
        {a("accounting.admin") && <button className="btn btn-principal" onClick={() => setCreation(true)}>+ Créer un journal</button>}
      </div>
      <div className="deux">
        <section className="panneau">
          {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>Code</th><th>Journal</th><th>Type</th><th className="montant">Validées</th><th className="montant">Brouillards</th><th>État</th></tr></thead>
                <tbody>{liste.donnees.map((j) => (
                  <tr key={j.id}>
                    <td><span className="etiquette-journal">{j.code}</span></td><td><b>{j.libelle}</b></td><td>{TYPES_JOURNAL[j.type] ?? j.type}</td>
                    <td className="montant">{j.validees}</td><td className="montant">{j.brouillons}</td>
                    <td>{j.actif ? <span className="badge badge-vert">Actif</span> : <span className="badge badge-rouge">Archivé</span>}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panneau">
          <div className="entete-panneau"><h3>Règles de saisie</h3></div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Chaque écriture porte une référence de pièce justificative et une date comprise dans un exercice ouvert.</li>
            <li>Un brouillard peut être enregistré déséquilibré ; la validation exige débit = crédit.</li>
            <li>À la validation, la base attribue le numéro suivant du journal, sans trou.</li>
            <li>Une écriture validée ne se modifie ni ne se supprime : on la corrige par une extourne motivée, puis une nouvelle écriture.</li>
            <li>Par défaut, l'auteur d'une écriture ne peut pas la valider lui-même.</li>
          </ul>
        </section>
      </div>
      {creation && <NouveauJournal onFermer={() => setCreation(false)} onFin={liste.recharger} />}
    </>
  );
}

function NouveauJournal({ onFermer, onFin }: { onFermer: () => void; onFin: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [libelle, setLibelle] = useState("");
  const [type, setType] = useState("general");
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    try { await api.post("/api/comptabilite/journaux", { code, libelle, type }); toast("Journal créé."); onFin(); onFermer(); } catch (err) { setErreur(messageErreur(err)); }
  };
  return (
    <Modale titre="Créer un journal" onFermer={onFermer}>
      <form onSubmit={envoyer} style={{ display: "grid", gap: 12 }}>
        <Champ label="Code" valeur={code} onChange={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} requis autoFocus aide="2 à 6 lettres ou chiffres, par exemple BQ2." />
        <Champ label="Intitulé" valeur={libelle} onChange={setLibelle} requis />
        <Selection label="Type" valeur={type} onChange={setType} options={Object.entries(TYPES_JOURNAL)} />
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal">Créer</button></div>
      </form>
    </Modale>
  );
}
