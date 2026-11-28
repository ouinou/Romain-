import { api } from "../api";
import { NOM_LOGICIEL } from "./Marque";
import { useSession } from "../session";
import { dateHeure, useDonnees, useToast } from "./ui";

/**
 * Fiche d'accès remise à un collaborateur avec son code d'invitation (ou de réinitialisation) : l'adresse du serveur
 * à ouvrir sur SON poste, le code entreprise, son e-mail et le code, en caractères faciles à recopier, avec les étapes.
 * Le logiciel ne s'installe que sur le serveur : les autres postes passent par le navigateur. Rien n'est envoyé par
 * e-mail (le logiciel fonctionne sans Internet) : la fiche s'imprime ou se recopie, et se remet en main propre.
 */
export function FicheAcces({ nom, email, jeton, expireLe, type }: { nom: string; email: string; jeton: string; expireLe: string; type: "invitation" | "reinitialisation" }) {
  const { moi } = useSession();
  const toast = useToast();
  const reseau = useDonnees(() => api.get<{ nom: string; adresses: string[]; certificat: string | null }>("/api/reseau").catch(() => null), []);
  const adresses = reseau.donnees?.adresses ?? [];
  const principale = adresses[0] ?? location.origin;
  const code = moi.entreprise.code;
  // Lien direct : il préremplit le code entreprise et le code d'accès sur l'écran d'activation.
  const lien = `${principale}/#/${type === "invitation" ? "activation" : "reinitialisation"}?entreprise=${encodeURIComponent(code)}&code=${encodeURIComponent(jeton)}`;
  const copier = async (texte: string, quoi: string) => {
    try { await navigator.clipboard.writeText(texte); toast(`${quoi} copié.`); }
    catch { toast(`Copie impossible ici : sélectionnez le ${quoi.toLowerCase()} et utilisez Ctrl+C.`, true); }
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="alerte alerte-attention">Ce code ne sera <b>plus jamais affiché</b>. Imprimez la fiche ou recopiez-la maintenant, puis remettez-la en main propre à {nom}. Ne l'envoyez pas par un canal public.</div>
      <article className="fiche-acces" aria-label={`Fiche d'accès de ${nom}`}>
        <h3>{NOM_LOGICIEL} : {type === "invitation" ? "activer votre compte" : "choisir un nouveau mot de passe"}</h3>
        <p className="discret">Pour {nom}. Valable une seule fois, jusqu'au <b>{dateHeure(expireLe)}</b>.</p>
        <ol>
          <li>Sur <b>votre</b> poste, ouvrez Edge ou Chrome à l'adresse du serveur de la pharmacie :
            <div className="valeur-fiche">{principale}</div>
            {adresses.length > 1 && <span className="discret">Si elle ne répond pas : {adresses.slice(1).join(" ou ")}</span>}
            <span className="discret">N'installez pas {NOM_LOGICIEL} sur votre poste : il ne s'installe que sur le serveur, qui garde les données de tous.</span>
          </li>
          {reseau.donnees?.certificat && <li>Si le navigateur affiche une alerte de sécurité : faites installer une fois, sur votre poste, le certificat de la pharmacie
            (<span className="mono">{principale}{reseau.donnees.certificat}</span>, procédure « Brancher un autre poste »).</li>}
          <li>Cliquez sur « {type === "invitation" ? "J'ai reçu un code d'invitation" : "J'ai reçu un code de réinitialisation"} » et saisissez :
            <dl className="valeurs-fiche">
              <dt>Code entreprise</dt><dd className="valeur-fiche">{code}</dd>
              <dt>Votre adresse e-mail</dt><dd className="valeur-fiche">{email}</dd>
              <dt>Code {type === "invitation" ? "d'invitation" : "de réinitialisation"}</dt><dd className="valeur-fiche code-fiche">{jeton}</dd>
            </dl>
            <span className="discret">Le code ne contient ni 0, ni O, ni 1, ni I, ni L. Majuscules, minuscules et espaces sont acceptés.</span>
          </li>
          <li>Choisissez votre mot de passe (12 caractères au moins), puis connectez-vous avec votre adresse e-mail.</li>
        </ol>
      </article>
      <div className="actions-form" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => window.print()}>Imprimer la fiche</button>
        <button type="button" className="btn" onClick={() => copier(jeton, "Code")}>Copier le code</button>
        <button type="button" className="btn" onClick={() => copier(lien, "Lien d'activation")} title="Lien qui préremplit l'écran d'activation : à transmettre par une messagerie interne de confiance">Copier le lien d'activation</button>
      </div>
    </div>
  );
}
