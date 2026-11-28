import { api, qs } from "../api";
import { useSession } from "../session";
import { Chargement, dateHeure, useDonnees } from "../composants/ui";
import { Icone } from "../assets/icons/Icone";
import { libelleAction } from "../libelles";
import { Montant, dateFr, formatMontant } from "./pharmacie/commun";
import type { Evenement, Page } from "../types";

interface TableauPharmacie {
  autorise: boolean; delaiAlertePeremption: number;
  indicateurs: { produits: number; ruptures: number; sousSeuil: number; peremptionsProches: number; lotsPerimes: number; lotsBloques: number; valeurStock: number | null; entreesJour: number; sortiesJour: number };
  derniersMouvements: { id: string; numero: string; date: string; nature: string; quantite: number; lot: string; produit: string; auteur: string }[];
}

/**
 * Tableau de bord de l'officine : des chiffres qui appellent une action (ruptures, péremptions, lots invendables),
 * les derniers mouvements, puis les blocs d'administration. Chaque bloc n'apparaît qu'avec la permission
 * correspondante, et tous les chiffres viennent du serveur. Pas de graphique décoratif.
 */
export function TableauDeBord() {
  const { moi, a } = useSession();
  const aujourdHui = new Date().toLocaleDateString("sv-SE");
  const voitStock = a("stock.read") || a("catalog.read");
  const tdb = useDonnees(() => (voitStock ? api.get<TableauPharmacie>("/api/tableau-de-bord") : Promise.resolve(null)), []);
  const comptes = useDonnees(async () => {
    if (!a("users.read")) return null;
    const total = (s?: string) => api.get<Page<unknown>>(`/api/utilisateurs${qs({ taille: 1, statut: s })}`).then((r) => r.total);
    const [tous, actifs, invites, desactives] = await Promise.all([total(), total("active"), total("invited"), total("disabled")]);
    return { tous, actifs, invites, desactives };
  }, []);
  const audit = useDonnees(async () => {
    if (!a("audit.read")) return null;
    const [recents, refus, echecs] = await Promise.all([
      api.get<Page<Evenement>>("/api/audit?taille=6"),
      api.get<Page<Evenement>>(`/api/audit${qs({ taille: 1, resultat: "denied", du: aujourdHui })}`),
      api.get<Page<Evenement>>(`/api/audit${qs({ taille: 1, resultat: "failure", type: "auth", du: aujourdHui })}`),
    ]);
    return { recents: recents.elements, refus: refus.total, echecs: echecs.total };
  }, []);
  const k = tdb.donnees?.autorise ? tdb.donnees.indicateurs : null;
  const aFaire = k ? [
    k.lotsPerimes && { lib: `${k.lotsPerimes} lot(s) périmé(s) encore en stock : à retirer`, lien: "/stock/alertes", grave: true },
    k.lotsBloques && { lib: `${k.lotsBloques} lot(s) bloqué(s) ou rappelé(s) en stock`, lien: "/stock/alertes", grave: true },
    k.ruptures && { lib: `${k.ruptures} produit(s) en rupture`, lien: "/catalogue?alerte=rupture", grave: false },
    k.sousSeuil && { lib: `${k.sousSeuil} produit(s) sous le seuil d'alerte`, lien: "/catalogue?alerte=seuil", grave: false },
    k.peremptionsProches && { lib: `${k.peremptionsProches} lot(s) périment dans moins de ${tdb.donnees!.delaiAlertePeremption} jours`, lien: "/stock?etat=proche", grave: false },
  ].filter(Boolean) as { lib: string; lien: string; grave: boolean }[] : [];
  return (
    <>
      <div className="entete-page">
        <div>
          <h2>Bonjour {moi.utilisateur.nom.split(" ")[0]}</h2>
          <p className="infos">{moi.entreprise.raisonSociale} · code {moi.entreprise.code} · {moi.roles.map((r) => r.libelle).join(", ") || "aucun rôle attribué"}</p>
        </div>
        <span className="discret"><Icone nom="calendrier" taille={16} className="en-ligne" /> {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
      </div>

      {!moi.mfa.active && (
        <div className="alerte alerte-attention">La double authentification n'est pas activée sur votre compte. <a href="#/mon-compte">L'activer maintenant</a>.</div>
      )}

      {voitStock && (
        <section className="panneau" aria-labelledby="titre-synthese">
          <div className="entete-panneau"><h3 id="titre-synthese">Stock de l'officine · {dateFr(aujourdHui)}</h3></div>
          {tdb.erreur ? <div className="alerte alerte-erreur">{tdb.erreur}</div> : !k ? <Chargement /> : (
            <div className="indicateurs">
              <Indicateur icone="produit" lib="Produits actifs" val={k.produits} aide="Fiches du catalogue" lien="/catalogue" nombre />
              <Indicateur icone="alerte" lib="Ruptures" val={k.ruptures} aide="Aucun lot vendable" lien="/catalogue?alerte=rupture" alerte={k.ruptures > 0} nombre />
              <Indicateur icone="stock" lib="Sous le seuil" val={k.sousSeuil} aide="Stock vendable ≤ seuil" lien="/catalogue?alerte=seuil" accent={k.sousSeuil > 0} nombre />
              <Indicateur icone="calendrier" lib="Péremptions proches" val={k.peremptionsProches} aide={`Lots, moins de ${tdb.donnees!.delaiAlertePeremption} jours`} lien="/stock?etat=proche" accent={k.peremptionsProches > 0} nombre />
              <Indicateur icone="lot" lib="Périmés ou bloqués" val={k.lotsPerimes + k.lotsBloques} aide="Lots invendables encore en stock" lien="/stock/alertes" alerte={k.lotsPerimes + k.lotsBloques > 0} nombre />
              {k.valeurStock !== null && <Indicateur icone="tresorerie" lib="Valeur du stock" val={k.valeurStock} aide="Au prix d'achat · FCFA" lien="/stock" />}
            </div>)}
        </section>
      )}

      {k && (
        <div className="deux">
          <section className="panneau">
            <div className="entete-panneau"><h3>Derniers mouvements</h3>{a("stock.read") && <a className="btn btn-petit" href="#/stock/mouvements">Tous les mouvements</a>}</div>
            {!tdb.donnees?.derniersMouvements.length ? <div className="vide">Aucun mouvement de stock pour l'instant.</div> : (
              <div className="tableau-conteneur">
                <table>
                  <thead><tr><th>Date</th><th>Nature</th><th>Produit</th><th>Lot</th><th className="montant">Quantité</th></tr></thead>
                  <tbody>{tdb.donnees.derniersMouvements.map((m) => (
                    <tr key={m.id}><td className="num">{dateHeure(m.date)}</td><td>{m.nature}</td><td>{m.produit}</td><td className="num">{m.lot}</td>
                      <td className={"montant" + (m.quantite < 0 ? " negatif" : "")}>{m.quantite > 0 ? "+" : "−"}{formatMontant(Math.abs(m.quantite))}</td></tr>))}
                  </tbody>
                </table>
              </div>)}
            <p className="discret" style={{ margin: "8px 0 0" }}>Aujourd'hui : {formatMontant(k.entreesJour)} entrée(s), {formatMontant(k.sortiesJour)} sortie(s) de stock.</p>
          </section>
          <section className="panneau">
            <div className="entete-panneau"><h3>À traiter</h3>{a("stock.read") && <a className="btn btn-petit" href="#/stock/alertes">Alertes</a>}</div>
            {aFaire.length === 0 ? <div className="vide">Rien à signaler.</div> : (
              <ul className="liste-a-faire">{aFaire.map((x) => (
                <li key={x.lib}><Icone nom="alerte" taille={16} className={"en-ligne" + (x.grave ? " grave" : "")} /> <a href={`#${x.lien}`}>{x.lib}</a></li>))}
              </ul>)}
          </section>
        </div>
      )}

      {comptes.donnees && (
        <section className="indicateurs" aria-label="Comptes utilisateurs">
          <Indicateur icone="utilisateurs" lib="Comptes" val={comptes.donnees.tous} aide="Toutes les personnes enregistrées" lien="/utilisateurs" nombre />
          <Indicateur icone="valider" lib="Actifs" val={comptes.donnees.actifs} aide="Peuvent se connecter" nombre />
          <Indicateur icone="nouvelutilisateur" lib="Invitations en attente" val={comptes.donnees.invites} aide="Compte pas encore activé" nombre />
          <Indicateur icone="quitter" lib="Désactivés" val={comptes.donnees.desactives} aide="Accès coupé" nombre />
        </section>
      )}
      {audit.donnees && (
        <section className="indicateurs" aria-label="Sécurité du jour">
          <Indicateur icone="roles" lib="Accès refusés aujourd'hui" val={audit.donnees.refus} aide="Tentatives hors des droits" alerte={audit.donnees.refus > 0} lien="/journal" nombre />
          <Indicateur icone="alerte" lib="Échecs de connexion aujourd'hui" val={audit.donnees.echecs} aide="Mot de passe ou code incorrect" alerte={audit.donnees.echecs >= 5} lien="/journal" nombre />
        </section>
      )}
      {a("audit.read") && (
        <section className="panneau">
          <div className="entete-panneau"><h3>Activité récente</h3><a className="btn btn-petit" href="#/journal">Voir le journal</a></div>
          {audit.erreur ? <div className="alerte alerte-erreur">{audit.erreur}</div> : !audit.donnees ? <Chargement /> :
            <div className="liste-evts">
              {audit.donnees.recents.map((e) => (
                <div className="evt" key={e.id}>
                  <div className={"pastille" + (e.resultat === "denied" ? " refus" : e.resultat === "failure" ? " echec" : "")} aria-hidden="true">{e.resultat === "success" ? "✓" : "!"}</div>
                  <div><b>{libelleAction(e.type, e.action, e.resultat)}</b><p>{e.acteur ?? "Système"} · <span className="num">{dateHeure(e.date)}</span></p></div>
                </div>
              ))}
            </div>}
        </section>
      )}
      {!voitStock && !a("users.read") && !a("audit.read") && (
        <section className="panneau"><p style={{ margin: 0 }}>Aucun module n'est ouvert à votre rôle pour l'instant. Votre administrateur peut vous attribuer les droits nécessaires.</p></section>
      )}
    </>
  );
}

function Indicateur({ icone, lib, val, aide, alerte, accent, lien, nombre }: {
  icone: string; lib: string; val: number | undefined; aide: string; alerte?: boolean; accent?: boolean; lien?: string; nombre?: boolean;
}) {
  const contenu = <>
    <Icone nom={icone} taille={30} className="icone-ind" />
    <div className="lib">{lib}</div>
    <div className="val">{val === undefined ? "…" : nombre ? val : <Montant v={val} />}</div>
    <div className="aide">{aide}</div>
  </>;
  const classe = "indicateur" + (alerte ? " alerte-ind" : accent ? " accent-ind" : "");
  return lien
    ? <a className={classe + " indicateur-lien"} href={"#" + lien}>{contenu}</a>
    : <div className={classe}>{contenu}</div>;
}
