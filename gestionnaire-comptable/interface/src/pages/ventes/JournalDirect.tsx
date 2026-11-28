import { useEffect, useRef, useState } from "react";
import { api, qs } from "../../api";
import { aller } from "../../routeur";
import { Chargement, messageErreur } from "../../composants/ui";
import { Montant } from "../comptabilite/commun";
import { BadgePaiement, type FactureResume } from "./commun";

const PERIODE_MS = 5000;
const aujourdhui = () => new Date().toLocaleDateString("sv-SE");   // AAAA-MM-JJ, heure locale
const heure = (d: string) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface Jour { elements: FactureResume[]; total: number; totalTtc: number; totalReste: number }

/**
 * Journal des ventes du jour, mis à jour automatiquement toutes les 5 secondes : la direction et les caisses
 * voient chaque facture apparaître sans recharger la page. La mise à jour s'arrête quand l'onglet est caché.
 */
export function JournalDirect() {
  const [jour, setJour] = useState<Jour | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [maj, setMaj] = useState<Date | null>(null);
  const [nouvelles, setNouvelles] = useState<Set<string>>(new Set());
  const connues = useRef<Set<string> | null>(null);

  useEffect(() => {
    let arret = false, minuterie: number | undefined, premier = true;
    const charger = async () => {
      if (document.hidden) { minuterie = window.setTimeout(charger, PERIODE_MS); return; }
      try {
        const d = aujourdhui();
        const r = await (premier ? api.get<Jour> : api.getAuto<Jour>)(`/api/ventes/factures${qs({ du: d, au: d, taille: 100 })}`);
        if (arret) return;
        if (connues.current) {
          const n = r.elements.filter((f) => !connues.current!.has(f.id)).map((f) => f.id);
          if (n.length) { setNouvelles(new Set(n)); window.setTimeout(() => !arret && setNouvelles(new Set()), 8000); }
        }
        connues.current = new Set(r.elements.map((f) => f.id)); premier = false;
        setJour(r); setMaj(new Date()); setErreur(null);
      } catch (e) { if (!arret) setErreur(messageErreur(e)); }
      if (!arret) minuterie = window.setTimeout(charger, PERIODE_MS);
    };
    charger();
    return () => { arret = true; window.clearTimeout(minuterie); };
  }, []);

  const encaisse = jour ? jour.totalTtc - jour.totalReste : 0;
  return (
    <>
      <div className="entete-page">
        <div><h2>Ventes en direct</h2><p>Factures émises aujourd'hui, par toutes les caisses. La liste se met à jour toute seule.</p></div>
        <span className={"direct" + (erreur ? " direct-coupe" : "")} role="status">
          {erreur ? "Connexion interrompue, nouvel essai…" : maj ? `En direct · mis à jour à ${maj.toLocaleTimeString("fr-FR")}` : "Connexion…"}
        </span>
      </div>
      {jour && <section className="indicateurs" aria-label="Synthèse du jour">
        <div className="indicateur"><div className="lib">Factures du jour</div><div className="val">{jour.total}</div><div className="aide">Toutes caisses</div></div>
        <div className="indicateur"><div className="lib">Chiffre d'affaires (TTC)</div><div className="val"><Montant v={jour.totalTtc} /></div><div className="aide">FCFA</div></div>
        <div className="indicateur"><div className="lib">Encaissé</div><div className="val"><Montant v={encaisse} /></div><div className="aide">FCFA</div></div>
        <div className={"indicateur" + (jour.totalReste ? " alerte-ind" : "")}><div className="lib">À crédit</div><div className="val"><Montant v={jour.totalReste} /></div><div className="aide">Reste à encaisser</div></div>
      </section>}
      <section className="panneau">
        {erreur && !jour ? <div className="alerte alerte-erreur">{erreur}</div> : !jour ? <Chargement /> : jour.elements.length === 0 ? <div className="vide">Aucune facture émise aujourd'hui pour l'instant.</div> : (
          <div className="tableau-conteneur">
            <table aria-live="polite">
              <thead><tr><th>Heure</th><th>N°</th><th>Client</th><th className="montant">TTC</th><th>Paiement</th><th>Émise par</th></tr></thead>
              <tbody>{jour.elements.map((x) => (
                <tr key={x.id} className={"cliquable" + (nouvelles.has(x.id) ? " ligne-nouvelle" : "")} tabIndex={0}
                  onClick={() => aller(`/ventes/factures/${x.id}`)} onKeyDown={(k) => k.key === "Enter" && aller(`/ventes/factures/${x.id}`)}>
                  <td className="num">{heure(x.creeLe)}</td><td className="num"><b>{x.numero}</b></td><td>{x.client}</td>
                  <td className="montant"><b><Montant v={x.totalTtc} /></b></td><td><BadgePaiement s={x.statutPaiement} /></td><td>{x.auteur}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
        {jour && jour.total > jour.elements.length && <p className="aide">Les 100 dernières factures sont affichées. La liste complète est dans « Ventes et factures ».</p>}
      </section>
    </>
  );
}
