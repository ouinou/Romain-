import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { api } from "../../api";
import { aller } from "../../routeur";
import { dateHeure, messageErreur } from "../../composants/ui";
import { Montant, dateFr } from "../comptabilite/commun";
import { BadgePaiement } from "./commun";

interface Resultat {
  authentique: boolean; raison?: string;
  facture?: { id: string; numero: string; date: string; client: string; totalTtc: number; totalAvoirs?: number; devise: string; statutPaiement: string; auteur: string; creeLe: string };
  avoir?: { id: string; numero: string; date: string; facture: string; client: string; totalTtc: number; devise: string; auteur: string; creeLe: string };
}

/**
 * Vérification d'une facture à partir de son code QR : caméra du poste, douchette USB (qui « tape » le code
 * puis Entrée) ou code collé à la main. Le serveur contrôle la signature puis la présence de la facture en base.
 */
export function VerifierFacture() {
  const [code, setCode] = useState("");
  const [res, setRes] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [camera, setCamera] = useState(false);
  const champ = useRef<HTMLTextAreaElement>(null);

  const verifier = async (contenu: string) => {
    setErreur(null); setRes(null); setEnvoi(true);
    try { setRes(await api.post<Resultat>("/api/ventes/verification", { contenu })); }
    catch (e) { setErreur(messageErreur(e)); }
    finally { setEnvoi(false); }
  };
  const lu = (texte: string) => { setCamera(false); setCode(texte); verifier(texte); };

  return (
    <>
      <div className="entete-page"><div><h2>Vérifier une facture</h2>
        <p>Scannez le code QR imprimé en bas d'une facture ou d'un avoir pour savoir s'il a bien été émis par l'entreprise, et si son montant n'a pas été modifié.</p></div></div>
      <div className="deux">
        <section className="panneau" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) verifier(code); }} style={{ display: "grid", gap: 10 }}>
            <div className="champ">
              <label className="etiquette" htmlFor="code-qr">Code de la facture</label>
              <textarea id="code-qr" ref={champ} rows={3} value={code} autoFocus spellCheck={false} className="mono"
                placeholder="Avec une douchette : cliquez ici puis scannez. Sinon, collez le code (GC1;…)."
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (code.trim()) verifier(code); } }} />
            </div>
            <div className="actions-form" style={{ justifyContent: "flex-start" }}>
              <button className="btn btn-principal" disabled={envoi || !code.trim()}>{envoi ? "Vérification…" : "Vérifier"}</button>
              <button type="button" className="btn" onClick={() => { setRes(null); setErreur(null); setCamera(!camera); }}>{camera ? "Arrêter la caméra" : "📷 Scanner avec la caméra"}</button>
              {code && <button type="button" className="btn btn-lien" onClick={() => { setCode(""); setRes(null); champ.current?.focus(); }}>Effacer</button>}
            </div>
          </form>
          {camera && <Camera onLu={lu} onErreur={(m) => { setCamera(false); setErreur(m); }} />}
          {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        </section>
        <section className="panneau" aria-live="polite" style={{ alignContent: "start", display: "grid", gap: 10 }}>
          {!res ? <p className="discret" style={{ margin: 0 }}>Le résultat de la vérification s'affiche ici.</p>
            : res.authentique && res.facture ? (
              <div className="verdict verdict-ok">
                <div className="verdict-titre">✓ Facture authentique</div>
                <p style={{ margin: 0 }}>Émise par l'entreprise, enregistrée dans le logiciel, montant conforme.</p>
                <dl className="verdict-details">
                  <dt>N°</dt><dd><b>{res.facture.numero}</b></dd>
                  <dt>Date</dt><dd>{dateFr(res.facture.date)}</dd>
                  <dt>Client</dt><dd>{res.facture.client}</dd>
                  <dt>Montant TTC</dt><dd><b><Montant v={res.facture.totalTtc} /> {res.facture.devise === "XAF" ? "FCFA" : res.facture.devise}</b></dd>
                  {!!res.facture.totalAvoirs && <><dt>Avoirs</dt><dd><Montant v={res.facture.totalAvoirs} /> FCFA déjà crédités</dd></>}
                  <dt>Paiement</dt><dd><BadgePaiement s={res.facture.statutPaiement} /></dd>
                  <dt>Émise par</dt><dd>{res.facture.auteur} · {dateHeure(res.facture.creeLe)}</dd>
                </dl>
                <button className="btn" style={{ justifySelf: "start" }} onClick={() => aller(`/ventes/factures/${res.facture!.id}`)}>Ouvrir la facture</button>
              </div>
            ) : res.authentique && res.avoir ? (
              <div className="verdict verdict-ok">
                <div className="verdict-titre">✓ Avoir authentique</div>
                <p style={{ margin: 0 }}>Émis par l'entreprise, enregistré dans le logiciel, montant conforme.</p>
                <dl className="verdict-details">
                  <dt>N°</dt><dd><b>{res.avoir.numero}</b></dd>
                  <dt>Date</dt><dd>{dateFr(res.avoir.date)}</dd>
                  <dt>Sur la facture</dt><dd>{res.avoir.facture}</dd>
                  <dt>Client</dt><dd>{res.avoir.client}</dd>
                  <dt>Montant TTC</dt><dd><b><Montant v={res.avoir.totalTtc} /> {res.avoir.devise === "XAF" ? "FCFA" : res.avoir.devise}</b></dd>
                  <dt>Émis par</dt><dd>{res.avoir.auteur} · {dateHeure(res.avoir.creeLe)}</dd>
                </dl>
                <button className="btn" style={{ justifySelf: "start" }} onClick={() => aller(`/ventes/avoirs/${res.avoir!.id}`)}>Ouvrir l'avoir</button>
              </div>
            ) : (
              <div className="verdict verdict-ko">
                <div className="verdict-titre">✗ Facture non reconnue</div>
                <p style={{ margin: 0 }}>{res.raison}</p>
                <p className="aide" style={{ margin: 0 }}>Ne l'acceptez pas sans contrôle : comparez avec l'original ou contactez l'entreprise.</p>
              </div>
            )}
          <p className="aide" style={{ margin: 0 }}>Chaque vérification est inscrite au journal d'audit.</p>
        </section>
      </div>
    </>
  );
}

/** Lecture du QR par la caméra (fonctionne en HTTPS ou sur le poste serveur lui-même ; c'est une règle des navigateurs). */
function Camera({ onLu, onErreur }: { onLu: (t: string) => void; onErreur: (m: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  // Rappels gardés dans une référence : la caméra ne redémarre pas à chaque nouvel affichage du parent.
  const rappels = useRef({ onLu, onErreur });
  rappels.current = { onLu, onErreur };
  useEffect(() => {
    const { onLu, onErreur } = { onLu: (t: string) => rappels.current.onLu(t), onErreur: (m: string) => rappels.current.onErreur(m) };
    let flux: MediaStream | null = null, arret = false, minuterie = 0;
    const toile = document.createElement("canvas"), ctx = toile.getContext("2d", { willReadFrequently: true })!;
    const lire = () => {
      const v = video.current;
      if (arret || !v) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const k = Math.min(1, 640 / v.videoWidth);
        toile.width = Math.round(v.videoWidth * k); toile.height = Math.round(v.videoHeight * k);
        ctx.drawImage(v, 0, 0, toile.width, toile.height);
        const r = jsQR(ctx.getImageData(0, 0, toile.width, toile.height).data, toile.width, toile.height, { inversionAttempts: "dontInvert" });
        if (r?.data) { onLu(r.data); return; }
      }
      minuterie = window.setTimeout(lire, 200);
    };
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onErreur("La caméra n'est pas accessible depuis cette adresse (le navigateur l'exige en HTTPS). Utilisez une douchette ou collez le code.");
        return;
      }
      try {
        flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (arret) { flux.getTracks().forEach((t) => t.stop()); return; }
        video.current!.srcObject = flux; await video.current!.play(); lire();
      } catch { onErreur("Caméra refusée ou absente. Autorisez la caméra dans le navigateur, ou utilisez une douchette."); }
    })();
    return () => { arret = true; window.clearTimeout(minuterie); flux?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <div className="cadre-camera">
      <video ref={video} muted playsInline aria-label="Image de la caméra" />
      <span className="aide">Présentez le code QR de la facture devant la caméra.</span>
    </div>
  );
}
