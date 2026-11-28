import { useState, type ReactNode } from "react";
import { api } from "../api";
import { Champ, Modale, ZoneTexte, messageErreur } from "./ui";

/**
 * Fenêtre « Confirmez votre identité » : ouverte automatiquement quand le serveur répond
 * confirmation_requise. Mot de passe + code MFA si nécessaire ; la requête d'origine est ensuite rejouée.
 */
export function FenetreReauthentification({ mfa, onFin }: { mfa: boolean; onFin: (ok: boolean) => void }) {
  const [mdp, setMdp] = useState("");
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const valider = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvoi(true); setErreur(null);
    try {
      await api.post("/api/auth/confirmation", { motDePasse: mdp, ...(mfa ? { codeMfa: code } : {}) });
      onFin(true);
    } catch (err) { setErreur(messageErreur(err)); setMdp(""); setCode(""); }
    finally { setEnvoi(false); }
  };
  return (
    <Modale titre="Confirmez votre identité" onFermer={() => onFin(false)}>
      <p className="discret" style={{ margin: 0 }}>Cette opération est sensible. Ressaisissez votre mot de passe{mfa ? " et le code de votre application d'authentification" : ""}. La confirmation reste valable quelques minutes.</p>
      <form onSubmit={valider} style={{ display: "grid", gap: 12 }}>
        <Champ label="Mot de passe" type="password" valeur={mdp} onChange={setMdp} requis autoComplete="current-password" autoFocus />
        {mfa && <Champ label="Code à 6 chiffres" valeur={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} requis inputMode="numeric" autoComplete="one-time-code" />}
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form">
          <button type="button" className="btn" onClick={() => onFin(false)}>Annuler</button>
          <button className="btn btn-principal" disabled={envoi}>{envoi ? "Vérification…" : "Confirmer"}</button>
        </div>
      </form>
    </Modale>
  );
}

/**
 * Demande de confirmation avant une action (avec motif obligatoire si besoin).
 * L'action est exécutée par onValider ; une erreur s'affiche dans la fenêtre sans la fermer.
 */
export function ConfirmerAction(props: {
  titre: string; texte: ReactNode; libelle: string; danger?: boolean; motif?: boolean;
  onValider: (motif: string) => Promise<void>; onFermer: () => void;
}) {
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const valider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (props.motif && motif.trim().length < 3) { setErreur("Indiquez un motif (3 caractères minimum). Il sera conservé dans le journal d'audit."); return; }
    setEnvoi(true); setErreur(null);
    try { await props.onValider(motif.trim()); props.onFermer(); }
    catch (err) { setErreur(messageErreur(err)); }
    finally { setEnvoi(false); }
  };
  return (
    <Modale titre={props.titre} onFermer={props.onFermer}>
      <div>{props.texte}</div>
      <form onSubmit={valider} style={{ display: "grid", gap: 12 }}>
        {props.motif && <ZoneTexte label="Motif" valeur={motif} onChange={setMotif} requis aide="Conservé dans le journal d'audit." />}
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form">
          <button type="button" className="btn" onClick={props.onFermer}>Annuler</button>
          <button className={"btn " + (props.danger ? "btn-danger" : "btn-principal")} disabled={envoi}>{envoi ? "Traitement…" : props.libelle}</button>
        </div>
      </form>
    </Modale>
  );
}
