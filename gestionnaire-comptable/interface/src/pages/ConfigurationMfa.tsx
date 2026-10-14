import { useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { QrCode } from "../composants/QrCode";
import { Champ, messageErreur, useToast } from "../composants/ui";

/**
 * Activation de la double authentification (application TOTP : Google Authenticator,
 * Microsoft Authenticator, FreeOTP…). Obligatoire pour les rôles sensibles avant tout autre accès.
 */
export function ConfigurationMfa({ obligatoire = false, onTermine }: { obligatoire?: boolean; onTermine?: () => void }) {
  const { moi, rafraichir, deconnecter } = useSession();
  const toast = useToast();
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const generer = async () => {
    setErreur(null);
    try { setSecret(await api.post("/api/auth/mfa/initialisation")); } catch (e) { setErreur(messageErreur(e)); }
  };
  const activer = async (e: React.FormEvent) => {
    e.preventDefault(); setEnvoi(true); setErreur(null);
    try {
      await api.post("/api/auth/mfa/activation", { code });
      toast("Double authentification activée.");
      await rafraichir(); onTermine?.();
    } catch (err) { setErreur(messageErreur(err)); setCode(""); }
    finally { setEnvoi(false); }
  };

  const contenu = (
    <div className="panneau" style={{ display: "grid", gap: 14, maxWidth: 620 }}>
      {obligatoire && <div className="alerte alerte-attention">Votre rôle donne accès à des fonctions sensibles. Activez la double authentification pour continuer.</div>}
      <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
        <li>Installez une application d'authentification sur votre téléphone (Google Authenticator, Microsoft Authenticator, FreeOTP…). Elle fonctionne sans Internet.</li>
        <li>Générez votre clé, puis scannez le QR code avec l'application.</li>
        <li>Saisissez le code à 6 chiffres affiché pour terminer.</li>
      </ol>
      {!secret ? <div><button className="btn btn-principal" onClick={generer}>Générer ma clé</button></div> : (
        <>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
            <QrCode texte={secret.uri} titre="QR code à scanner avec l'application d'authentification" />
            <div style={{ display: "grid", gap: 6, minWidth: 0, flex: "1 1 220px" }}>
              <span className="discret">Impossible de scanner ? Saisissez cette clé dans l'application :</span>
              <div className="secret">{secret.secret.replace(/(.{4})/g, "$1 ").trim()}</div>
              <span className="discret">Compte : {moi.utilisateur.email}</span>
            </div>
          </div>
          <form onSubmit={activer} style={{ display: "grid", gap: 10, maxWidth: 300 }}>
            <Champ label="Code à 6 chiffres" valeur={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} requis inputMode="numeric" autoComplete="one-time-code" />
            <button className="btn btn-principal" disabled={envoi || code.length !== 6}>{envoi ? "Vérification…" : "Activer"}</button>
          </form>
        </>
      )}
      {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
    </div>
  );

  if (!obligatoire) return contenu;
  return (
    <main className="ecran-accueil">
      <div style={{ display: "grid", gap: 12, width: "min(660px, 100%)" }}>
        <div className="marque" style={{ color: "#fff" }}>
          <div className="logo" aria-hidden="true">GC</div>
          <div><h1>Double authentification</h1><p style={{ color: "#c9d8e6" }}>{moi.utilisateur.nom} · {moi.entreprise.raisonSociale}</p></div>
        </div>
        {contenu}
        <div><button className="btn" onClick={deconnecter}>Se déconnecter</button></div>
      </div>
    </main>
  );
}
