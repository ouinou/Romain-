import { useEffect, useState } from "react";
import { LogoFinexa, NOM_LOGICIEL } from "../composants/Marque";
import { api, ApiErreur } from "../api";
import { Champ, SecretUnique, messageErreur } from "../composants/ui";

type Mode = "connexion" | "invitation" | "reinitialisation" | "recuperation";

/** Le code entreprise n'est pas un secret : il est mémorisé sur ce poste pour éviter de le ressaisir. */
const CLE_CODE = "gc.codeEntreprise";
const codeMemorise = () => { try { return localStorage.getItem(CLE_CODE) ?? ""; } catch { return ""; } };
const memoriserCode = (c: string) => { try { localStorage.setItem(CLE_CODE, c); } catch { /* navigation privée */ } };

export function Accueil({ onConnecte, message }: { onConnecte: () => void; message?: string | null }) {
  const [mode, setMode] = useState<Mode>("connexion");
  const [code, setCode] = useState(codeMemorise);
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [mdp2, setMdp2] = useState("");
  const [codeMfa, setCodeMfa] = useState("");
  const [demandeMfa, setDemandeMfa] = useState(false);
  const [jeton, setJeton] = useState("");
  const [codeMaitre, setCodeMaitre] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(message ?? null);
  const [envoi, setEnvoi] = useState(false);
  const [jetonRecupere, setJetonRecupere] = useState<{ jeton: string; expireLe: string } | null>(null);

  // Première installation : formulaire de création de l'entreprise (seulement sur le serveur, tant qu'il n'y en a aucune).
  const [installation, setInstallation] = useState(false);
  useEffect(() => { api.get<{ disponible: boolean }>("/api/installation").then((r) => setInstallation(r.disponible)).catch(() => {}); }, []);
  if (installation) return <PremiereInstallation onFin={(codeEnt, jetonInv) => { setInstallation(false); setCode(codeEnt); memoriserCode(codeEnt); setJeton(jetonInv); setMode("invitation"); setInfo("Choisissez maintenant le mot de passe de l'administrateur."); }} />;

  const changer = (m: Mode) => { setMode(m); setErreur(null); setInfo(null); setMdp(""); setMdp2(""); setDemandeMfa(false); setCodeMfa(""); };

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    setErreur(null); setInfo(null);
    if ((mode === "invitation" || mode === "reinitialisation") && mdp !== mdp2) { setErreur("Les deux mots de passe ne sont pas identiques."); return; }
    setEnvoi(true);
    try {
      if (mode === "connexion") {
        await api.post("/api/auth/connexion", { codeEntreprise: code, email, motDePasse: mdp, ...(demandeMfa ? { codeMfa } : {}) });
        memoriserCode(code.trim().toUpperCase());
        onConnecte();
        return;
      }
      if (mode === "invitation" || mode === "reinitialisation") {
        await api.post(mode === "invitation" ? "/api/auth/invitation/acceptation" : "/api/auth/reinitialisation",
          { codeEntreprise: code, jeton: jeton.trim(), motDePasse: mdp });
        memoriserCode(code.trim().toUpperCase());
        changer("connexion");
        setInfo(mode === "invitation" ? "Compte activé. Connectez-vous avec votre nouveau mot de passe." : "Mot de passe modifié. Connectez-vous.");
        return;
      }
      const r = await api.post<{ reinitialisation: { jeton: string; expireLe: string } }>("/api/auth/recuperation", { codeEntreprise: code, codeMaitre, email });
      setJetonRecupere(r.reinitialisation);
    } catch (err) {
      if (err instanceof ApiErreur && err.code === "mfa_requis") { setDemandeMfa(true); setInfo(err.message); }
      else setErreur(messageErreur(err));
      if (mode === "connexion" && !(err instanceof ApiErreur && err.code === "mfa_requis")) { setMdp(""); setCodeMfa(""); }
    } finally { setEnvoi(false); }
  };

  const titres: Record<Mode, [string, string]> = {
    connexion: ["Connexion", "Accédez à l'espace de votre entreprise avec votre compte personnel."],
    invitation: ["Activer mon compte", "Saisissez le code d'invitation remis par votre administrateur, puis choisissez votre mot de passe."],
    reinitialisation: ["Nouveau mot de passe", "Saisissez le code de réinitialisation remis par votre administrateur."],
    recuperation: ["Récupération par code maître", "Réservé au dirigeant ou à l'administrateur qui détient le code maître de l'entreprise. Chaque usage est tracé et signalé à tous les administrateurs."],
  };

  return (
    <main className="ecran-accueil">
      <div className="boite-accueil">
        <div className="marque-accueil">
          <LogoFinexa />
          <h1 className="cache-visuel">{NOM_LOGICIEL}</h1>
          <p>Espace sécurisé de l'entreprise</p>
        </div>
        <div>
          <h2>{titres[mode][0]}</h2>
          <p className="discret" style={{ margin: "6px 0 0" }}>{titres[mode][1]}</p>
        </div>

        {jetonRecupere ? (
          <>
            <SecretUnique valeur={jetonRecupere.jeton} explication={<>Code de réinitialisation valable jusqu'à {new Date(jetonRecupere.expireLe).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Le code maître vient d'être consommé : générez-en un nouveau après vous être reconnecté.</>} />
            <button className="btn btn-principal" onClick={() => { setJeton(jetonRecupere.jeton); setJetonRecupere(null); changer("reinitialisation"); }}>Choisir mon nouveau mot de passe →</button>
          </>
        ) : (
          <form onSubmit={soumettre} style={{ display: "grid", gap: 12 }}>
            {info && <div className="alerte" role="status">{info}</div>}
            <Champ label="Code entreprise" valeur={code} onChange={(v) => setCode(v.toUpperCase())} requis autoComplete="organization" placeholder="Ex. GC-ENTREPRISE-01" />
            {(mode === "connexion" || mode === "recuperation") &&
              <Champ label={mode === "recuperation" ? "Adresse e-mail de l'administrateur" : "Adresse e-mail"} type="email" valeur={email} onChange={setEmail} requis autoComplete="username" />}
            {mode === "connexion" && <Champ label="Mot de passe" type="password" valeur={mdp} onChange={setMdp} requis autoComplete="current-password" />}
            {mode === "connexion" && demandeMfa &&
              <Champ label="Code de vérification (6 chiffres)" valeur={codeMfa} onChange={(v) => setCodeMfa(v.replace(/\D/g, "").slice(0, 6))} requis inputMode="numeric" autoComplete="one-time-code" autoFocus aide="Code affiché par votre application d'authentification." />}
            {(mode === "invitation" || mode === "reinitialisation") && <>
              <Champ label={mode === "invitation" ? "Code d'invitation" : "Code de réinitialisation"} valeur={jeton} onChange={setJeton} requis />
              <Champ label="Nouveau mot de passe" type="password" valeur={mdp} onChange={setMdp} requis autoComplete="new-password" aide="12 caractères minimum. Une phrase de plusieurs mots est plus sûre et plus facile à retenir." />
              <Champ label="Confirmer le mot de passe" type="password" valeur={mdp2} onChange={setMdp2} requis autoComplete="new-password" />
            </>}
            {mode === "recuperation" && <Champ label="Code maître" valeur={codeMaitre} onChange={setCodeMaitre} requis placeholder="GCM-XXXX-XXXX-…" />}
            {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
            <button className="btn btn-principal btn-plein" disabled={envoi}>
              {envoi ? "Vérification…" : mode === "connexion" ? "Se connecter" : mode === "recuperation" ? "Rétablir l'accès" : "Enregistrer mon mot de passe"}
            </button>
          </form>
        )}

        <div className="liens-accueil">
          {mode !== "connexion" && <button className="btn-lien" onClick={() => changer("connexion")}>← Retour à la connexion</button>}
          {mode !== "invitation" && <button className="btn-lien" onClick={() => changer("invitation")}>J'ai reçu un code d'invitation</button>}
          {mode !== "reinitialisation" && <button className="btn-lien" onClick={() => changer("reinitialisation")}>J'ai reçu un code de réinitialisation</button>}
          {mode !== "recuperation" && <button className="btn-lien" onClick={() => changer("recuperation")}>Administrateur bloqué : utiliser le code maître</button>}
        </div>
        <p className="pied-accueil">Mot de passe oublié ? Demandez un code de réinitialisation à votre administrateur.</p>
      </div>
    </main>
  );
}

function PremiereInstallation({ onFin }: { onFin: (code: string, jeton: string) => void }) {
  const [f, setF] = useState({ code: "", raisonSociale: "", adminNom: "", adminEmail: "", niu: "", rccm: "" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [res, setRes] = useState<{ code: string; codeMaitre: string; invitation: string; adminEmail: string } | null>(null);
  const [note, setNote] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: k === "code" ? v.toUpperCase().replace(/[^A-Z0-9-]/g, "") : v });
  const creer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null); setEnvoi(true);
    try { setRes(await api.post("/api/installation/entreprise", { ...f, niu: f.niu || undefined, rccm: f.rccm || undefined })); }
    catch (err) { setErreur(messageErreur(err)); }
    finally { setEnvoi(false); }
  };
  return (
    <main className="ecran-accueil">
      <div className="boite-accueil" style={{ width: "min(560px, 100%)" }}>
        <div className="marque-accueil">
          <LogoFinexa />
          <h1 className="cache-visuel">{NOM_LOGICIEL}</h1>
          <p>Première installation</p>
        </div>
        {!res ? (
          <form onSubmit={creer} style={{ display: "grid", gap: 12 }}>
            <div><h2>Créer votre entreprise</h2>
              <p className="discret" style={{ margin: "6px 0 0" }}>Le logiciel est installé. Indiquez l'entreprise et la personne qui l'administrera. Cet écran n'apparaît que sur ce serveur, une seule fois.</p></div>
            <Champ label="Raison sociale" valeur={f.raisonSociale} onChange={set("raisonSociale")} requis autoFocus />
            <Champ label="Code entreprise" valeur={f.code} onChange={set("code")} requis placeholder="Ex. GC-MONENTREPRISE" aide="Saisi par chaque utilisateur à la connexion. 4 à 32 lettres, chiffres ou tirets." />
            <div className="grille-champs">
              <Champ label="NIU (facultatif)" valeur={f.niu} onChange={set("niu")} />
              <Champ label="RCCM (facultatif)" valeur={f.rccm} onChange={set("rccm")} />
            </div>
            <div className="grille-champs">
              <Champ label="Nom de l'administrateur" valeur={f.adminNom} onChange={set("adminNom")} requis />
              <Champ label="E-mail de l'administrateur" type="email" valeur={f.adminEmail} onChange={set("adminEmail")} requis />
            </div>
            {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
            <button className="btn btn-principal btn-plein" disabled={envoi}>{envoi ? "Création…" : "Créer l'entreprise"}</button>
          </form>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div><h2>Entreprise {res.code} créée</h2>
              <p className="discret" style={{ margin: "6px 0 0" }}>Deux codes s'affichent <b>une seule fois</b>. Imprimez cette page ou recopiez-les avant de continuer.</p></div>
            <div className="impression-secrets" style={{ display: "grid", gap: 12 }}>
              <div><b>1. Code maître de l'entreprise</b>
                <SecretUnique valeur={res.codeMaitre} explication={<>À remettre <b>sous enveloppe scellée au dirigeant</b>, rangée dans un coffre. Il sert uniquement si l'administrateur perd l'accès. Il ne doit pas rester chez l'administrateur informatique.</>} /></div>
              <div><b>2. Code d'invitation de l'administrateur ({res.adminEmail})</b>
                <SecretUnique valeur={res.invitation} explication="Il permet de choisir le mot de passe de l'administrateur. Valable 72 heures." /></div>
            </div>
            <label className="case"><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} /><span>J'ai imprimé ou recopié les deux codes.</span></label>
            <div className="actions-form">
              <button className="btn" onClick={() => window.print()}>Imprimer</button>
              <button className="btn btn-principal" disabled={!note} onClick={() => onFin(res.code, res.invitation)}>Continuer : mot de passe de l'administrateur →</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
