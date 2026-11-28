import { Fragment, useState } from "react";
import { api, qs, telecharger } from "../api";
import { useSession } from "../session";
import { Chargement, Pagination, dateHeure, messageErreur, useDonnees, useRetarde, useToast } from "../composants/ui";
import { RESULTATS, TYPES_EVENEMENT, libelleAction, traduireValeur } from "../libelles";
import type { Evenement, Page } from "../types";

interface Integrite { valide: boolean; anomalies: { sequence: number; probleme: string }[]; derniereSequence: number; total: number }

export function Journal() {
  const { a } = useSession();
  const toast = useToast();
  const [type, setType] = useState("");
  const [resultat, setResultat] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [recherche, setRecherche] = useState("");
  const [page, setPage] = useState(1);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [integrite, setIntegrite] = useState<Integrite | null>(null);
  const [verif, setVerif] = useState(false);
  const rech = useRetarde(recherche);
  const filtres = { type, resultat, du, au, recherche: rech };
  const liste = useDonnees(() => api.get<Page<Evenement>>(`/api/audit${qs({ ...filtres, page, taille: 25 })}`), [type, resultat, du, au, rech, page]);
  const f = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setter(e.target.value); setPage(1); };

  const verifier = async () => {
    setVerif(true);
    try { setIntegrite(await api.get<Integrite>("/api/audit/integrite")); liste.recharger(); }
    catch (e) { toast(messageErreur(e), true); } finally { setVerif(false); }
  };
  const exporter = async () => {
    if (__DEMO__) { toast("Démonstration : le téléchargement n'est pas disponible dans l'aperçu en ligne. Dans le logiciel installé, le fichier CSV est téléchargé et l'export est tracé."); return; }
    try { await telecharger(`/api/audit/export${qs(filtres)}`, `journal-audit-${new Date().toISOString().slice(0, 10)}.csv`); toast("Export téléchargé. Il est enregistré dans le journal."); liste.recharger(); }
    catch (e) { if ((e as { code?: string }).code !== "annulee") toast(messageErreur(e), true); }
  };

  return (
    <>
      <div className="entete-page">
        <div><h2>Journal d'audit</h2><p>Historique en ajout seul : personne, administrateur compris, ne peut modifier ou supprimer un événement depuis le logiciel. Chaque événement est chaîné au précédent par une empreinte SHA-256.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={verifier} disabled={verif}>{verif ? "Vérification…" : "Vérifier l'intégrité"}</button>
          {a("audit.export") && <button className="btn" onClick={exporter}>Exporter (CSV)</button>}
        </div>
      </div>
      {integrite && (integrite.valide
        ? <div className="alerte alerte-succes" role="status">Journal intègre : {integrite.total} événement(s) vérifié(s), dernière séquence n° {integrite.derniereSequence}.</div>
        : <div className="alerte alerte-erreur" role="alert"><b>Anomalies détectées.</b> Ne modifiez rien et prévenez le responsable sécurité.
            <ul style={{ margin: "6px 0 0" }}>{integrite.anomalies.map((x, i) => <li key={i}>Séquence {x.sequence} : {x.probleme}</li>)}</ul></div>)}
      <section className="panneau">
        <div className="filtres" role="search">
          <label className="cache-visuel" htmlFor="j-rech">Rechercher</label>
          <input id="j-rech" className="filtre" type="search" placeholder="Rechercher (action, motif, objet…)" value={recherche} onChange={f(setRecherche)} />
          <label className="cache-visuel" htmlFor="j-type">Type</label>
          <select id="j-type" className="filtre" value={type} onChange={f(setType)}>
            <option value="">Tous les types</option>{Object.entries(TYPES_EVENEMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="cache-visuel" htmlFor="j-res">Résultat</label>
          <select id="j-res" className="filtre" value={resultat} onChange={f(setResultat)}>
            <option value="">Tous les résultats</option>{Object.entries(RESULTATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="cache-visuel" htmlFor="j-du">Du</label>
          <input id="j-du" className="filtre" type="date" value={du} onChange={f(setDu)} title="Du" />
          <label className="cache-visuel" htmlFor="j-au">Au</label>
          <input id="j-au" className="filtre" type="date" value={au} onChange={f(setAu)} title="Au" />
        </div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : (
          <>
            <div className="tableau-conteneur">
              <table>
                <thead><tr><th>N°</th><th>Date</th><th>Utilisateur</th><th>Événement</th><th>Résultat</th><th>Motif</th></tr></thead>
                <tbody>
                  {liste.donnees.elements.length === 0 && <tr><td colSpan={6} className="vide">Aucun événement pour ces critères.</td></tr>}
                  {liste.donnees.elements.map((e) => (
                    <Fragment key={e.id}>
                      <tr className="cliquable" tabIndex={0} aria-expanded={ouvert === e.id} onClick={() => setOuvert(ouvert === e.id ? null : e.id)} onKeyDown={(k) => k.key === "Enter" && setOuvert(ouvert === e.id ? null : e.id)}>
                        <td className="num">{e.sequence}</td>
                        <td className="num" style={{ whiteSpace: "nowrap" }}>{dateHeure(e.date)}</td>
                        <td>{e.acteur ?? "Système"}</td>
                        <td><b>{libelleAction(e.type, e.action)}</b><br /><span className="discret">{TYPES_EVENEMENT[e.type] ?? e.type}{e.ip ? ` · ${e.ip}` : ""}</span></td>
                        <td><span className={"badge " + (e.resultat === "success" ? "badge-vert" : e.resultat === "denied" ? "badge-rouge" : "badge-orange")}>{RESULTATS[e.resultat]}</span></td>
                        <td>{e.motif ?? <span className="discret">—</span>}</td>
                      </tr>
                      {ouvert === e.id && (
                        <tr className="evenement-detail"><td colSpan={6}>
                          <div style={{ display: "grid", gap: 8 }}>
                            {e.avant != null && <div><b>Avant</b><pre>{JSON.stringify(traduireValeur(e.avant), null, 2)}</pre></div>}
                            {e.apres != null && <div><b>Après</b><pre>{JSON.stringify(traduireValeur(e.apres), null, 2)}</pre></div>}
                            {Object.keys(e.details ?? {}).length > 0 && <div><b>Détails</b><pre>{JSON.stringify(traduireValeur(e.details), null, 2)}</pre></div>}
                            <div className="discret">Objet : {e.objetType ?? "—"} {e.objetId ?? ""}</div>
                            <div className="mono discret">Empreinte : {e.empreinte}</div>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={liste.donnees.page} taille={liste.donnees.taille} total={liste.donnees.total} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}
