import { api, qs } from "../api";
import { useSession } from "../session";
import { Chargement, dateHeure, useDonnees } from "../composants/ui";
import { libelleAction } from "../libelles";
import type { Evenement, Page } from "../types";

/**
 * Tableau de bord : chaque bloc n'apparaît que si l'utilisateur a la permission correspondante.
 * Les indicateurs financiers (revenus, dépenses, trésorerie, budgets, stocks) arriveront avec les modules métier.
 */
export function TableauDeBord() {
  const { moi, a } = useSession();
  const aujourdHui = new Date().toISOString().slice(0, 10);

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

  return (
    <>
      <div className="entete-page">
        <div>
          <h2>Bonjour {moi.utilisateur.nom.split(" ")[0]}</h2>
          <p>{moi.entreprise.raisonSociale} · code {moi.entreprise.code} · {moi.roles.map((r) => r.libelle).join(", ") || "aucun rôle attribué"}</p>
        </div>
      </div>

      {!moi.mfa.active && (
        <div className="alerte alerte-attention">La double authentification n'est pas activée sur votre compte. <a href="#/mon-compte">L'activer maintenant</a>.</div>
      )}

      {comptes.donnees && (
        <section className="indicateurs" aria-label="Comptes utilisateurs">
          <Indicateur lib="Comptes" val={comptes.donnees.tous} aide="Toutes les personnes enregistrées" />
          <Indicateur lib="Actifs" val={comptes.donnees.actifs} aide="Peuvent se connecter" />
          <Indicateur lib="Invitations en attente" val={comptes.donnees.invites} aide="Compte pas encore activé" />
          <Indicateur lib="Désactivés" val={comptes.donnees.desactives} aide="Accès coupé" />
        </section>
      )}

      {audit.donnees && (
        <section className="indicateurs" aria-label="Sécurité du jour">
          <Indicateur lib="Accès refusés aujourd'hui" val={audit.donnees.refus} aide="Tentatives hors des droits" alerte={audit.donnees.refus > 0} />
          <Indicateur lib="Échecs de connexion aujourd'hui" val={audit.donnees.echecs} aide="Mot de passe ou code incorrect" alerte={audit.donnees.echecs >= 5} />
        </section>
      )}

      <div className="deux">
        {a("audit.read") && (
          <section className="panneau">
            <div className="entete-panneau"><div><h3>Activité récente</h3><p>Derniers événements du journal d'audit</p></div><a className="btn btn-petit" href="#/journal">Voir le journal</a></div>
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
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Modules de gestion</h3><p>Prochaines étapes du développement</p></div></div>
          <p className="discret" style={{ margin: 0 }}>Trésorerie, comptabilité SYSCOHADA, revenus et dépenses, budgets, achats, stocks, immobilisations, clients et rapports seront ajoutés ici un par un, chacun avec ses propres permissions. Les indicateurs financiers n'apparaîtront qu'aux personnes autorisées.</p>
        </section>
      </div>
    </>
  );
}

function Indicateur({ lib, val, aide, alerte }: { lib: string; val: number; aide: string; alerte?: boolean }) {
  return (
    <div className={"indicateur" + (alerte ? " alerte-ind" : "")}>
      <div className="lib">{lib}</div>
      <div className="val">{val}</div>
      <div className="aide">{aide}</div>
    </div>
  );
}
