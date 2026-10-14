import { api } from "../../api";
import { useSession } from "../../session";
import { aller } from "../../routeur";
import { Chargement, useDonnees } from "../../composants/ui";
import { BadgeEcriture, Montant, dateFr, type EcritureResume } from "./commun";
import type { Page } from "../../types";

interface Tableau {
  exercice: { id: string; code: string; debut: string; fin: string; ouvert: boolean };
  validees: number; brouillons: number; brouillonsDesequilibres: number; totalDebit: number; totalCredit: number; comptesMasques: number;
}

export function TableauComptable() {
  const { a } = useSession();
  const t = useDonnees(() => api.get<Tableau>("/api/comptabilite/tableau-de-bord"), []);
  const dernieres = useDonnees(() => api.get<Page<EcritureResume>>("/api/comptabilite/ecritures?taille=6"), []);
  if (t.erreur) return <div className="alerte alerte-erreur">{t.erreur}</div>;
  if (!t.donnees) return <Chargement />;
  const d = t.donnees, ecart = Math.abs(d.totalDebit - d.totalCredit);
  return (
    <>
      <div className="entete-page">
        <div><h2>Comptabilité générale</h2><p>Écritures de l'exercice, équilibre comptable et opérations en attente de validation.</p></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="badge badge-orange badge-neutre">Exercice {d.exercice.code} · {d.exercice.ouvert ? "ouvert" : "clôturé"}</span>
          {a("accounting.create") && d.exercice.ouvert && <button className="btn btn-principal" onClick={() => aller("/comptabilite/ecritures/nouvelle")}>+ Nouvelle écriture</button>}
        </div>
      </div>
      <div className="alerte alerte-attention">Plan comptable et règles en cours de validation : la liste des comptes fournie est restreinte et doit être vérifiée sur le référentiel SYSCOHADA révisé officiel, puis par un professionnel, avant toute utilisation réelle.</div>
      {d.comptesMasques > 0 && <div className="alerte">{d.comptesMasques} compte(s) protégé(s) (banque, personnel, résultat…) sont exclus de vos totaux : vous n'avez pas la permission de les consulter.</div>}
      <section className="indicateurs" aria-label="Synthèse de l'exercice">
        <div className="indicateur"><div className="lib">Écritures validées</div><div className="val">{d.validees}</div><div className="aide">Numérotées, intangibles</div></div>
        <div className={"indicateur" + (d.brouillonsDesequilibres ? " alerte-ind" : "")}><div className="lib">Brouillards</div><div className="val">{d.brouillons}</div><div className="aide">{d.brouillonsDesequilibres ? `dont ${d.brouillonsDesequilibres} déséquilibré(s)` : "En attente de validation"}</div></div>
        <div className="indicateur"><div className="lib">Total débit (FCFA)</div><div className="val"><Montant v={d.totalDebit} /></div><div className="aide">Écritures validées</div></div>
        <div className={"indicateur" + (ecart ? " alerte-ind" : "")}><div className="lib">Écart débit / crédit</div><div className="val"><Montant v={ecart} /></div><div className="aide">{ecart ? "Anomalie : à examiner" : "Équilibré"}</div></div>
      </section>
      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Dernières écritures</h3><p>Brouillards et écritures validées</p></div><a className="btn btn-petit" href="#/comptabilite/ecritures">Toutes les écritures</a></div>
          {!dernieres.donnees ? <Chargement /> : dernieres.donnees.elements.length === 0 ? <div className="vide">Aucune écriture pour l'instant.</div> : (
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>Date</th><th>Journal</th><th>Pièce</th><th>Libellé</th><th className="montant">Montant</th><th>État</th></tr></thead>
                <tbody>{dernieres.donnees.elements.map((e) => (
                  <tr key={e.id} className="cliquable" tabIndex={0} onClick={() => aller(`/comptabilite/ecritures/${e.id}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/comptabilite/ecritures/${e.id}`)}>
                    <td className="num">{dateFr(e.date)}</td><td><span className="etiquette-journal">{e.journal}</span></td><td>{e.piece}</td><td>{e.libelle}</td>
                    <td className="montant"><Montant v={e.totalDebit} /></td><td><BadgeEcriture e={e} /></td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Contrôles comptables</h3><p>Garantis par la base de données</p></div></div>
          <div style={{ display: "grid", gap: 10 }}>
            {[
              ["Équilibre débit = crédit exigé à la validation", true],
              ["Numérotation continue par journal et par exercice", true],
              ["Écriture validée intangible ; correction par extourne motivée", true],
              ["Séparation saisie / validation", true],
              ["Exercice clôturé : plus aucune écriture", true],
              ["Pièces justificatives jointes", false],
              ["Périodes mensuelles verrouillables, à-nouveaux automatiques", false],
            ].map(([t, ok]) => (
              <div key={String(t)} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span className={"badge " + (ok ? "badge-vert" : "badge-orange")}>{ok ? "Actif" : "À venir"}</span><span>{t}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
