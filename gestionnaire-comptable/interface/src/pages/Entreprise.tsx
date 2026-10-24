import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { Champ, Chargement, Modale, SecretUnique, dateHeure, messageErreur, useDonnees, useToast } from "../composants/ui";
import { ConfirmerAction } from "../composants/Confirmations";
import { appliquerCouleurs, contraste, COULEURS_DEFAUT, EVENEMENT_APPARENCE, variables, type Couleurs } from "../theme";

interface Ent {
  id: string; code: string; raisonSociale: string; statut: string; pays: string; devise: string; rccm: string | null; niu: string | null;
  adresse: string | null; telephone: string | null; email: string | null; regimeFiscal: string | null; patente: string | null;
  couleurs: Couleurs; logoId: string | null; logoUrl: string | null; parametres: { mfaObligatoire: boolean; inactiviteJours: number };
  codeMaitre: { actif: boolean; creeLe: string | null; bloque: boolean };
}

export function Entreprise() {
  const { a, rafraichir } = useSession();
  const toast = useToast();
  const e = useDonnees(() => api.get<Ent>("/api/entreprise"), []);
  const [form, setForm] = useState({ raisonSociale: "", rccm: "", niu: "", adresse: "", telephone: "", email: "", regimeFiscal: "", patente: "" });
  const [secu, setSecu] = useState({ mfaObligatoire: true, inactiviteJours: "90" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [regen, setRegen] = useState(false);
  const [nouveauCode, setNouveauCode] = useState<string | null>(null);
  useEffect(() => {
    if (!e.donnees) return;
    const d = e.donnees;
    setForm({ raisonSociale: d.raisonSociale, rccm: d.rccm ?? "", niu: d.niu ?? "", adresse: d.adresse ?? "", telephone: d.telephone ?? "",
      email: d.email ?? "", regimeFiscal: d.regimeFiscal ?? "", patente: d.patente ?? "" });
    setSecu({ mfaObligatoire: d.parametres.mfaObligatoire, inactiviteJours: String(d.parametres.inactiviteJours) });
  }, [e.donnees]);

  if (e.erreur) return <div className="alerte alerte-erreur">{e.erreur}</div>;
  if (!e.donnees) return <Chargement />;
  const d = e.donnees;
  const modifiable = a("company.update");
  const enregistrer = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErreur(null);
    const n = (v: string) => v.trim() || null;
    try {
      await api.patch("/api/entreprise", { raisonSociale: form.raisonSociale, rccm: n(form.rccm), niu: n(form.niu), adresse: n(form.adresse), telephone: n(form.telephone),
        email: n(form.email), regimeFiscal: n(form.regimeFiscal), patente: n(form.patente) });
      toast("Informations enregistrées. Elles figureront sur les prochaines factures."); e.recharger(); rafraichir(); window.dispatchEvent(new Event(EVENEMENT_APPARENCE));
    } catch (err) { setErreur(messageErreur(err)); }
  };
  const enregistrerSecu = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      await api.patch("/api/entreprise", { parametres: { mfaObligatoire: secu.mfaObligatoire, inactiviteJours: Number(secu.inactiviteJours) } });
      toast("Paramètres de sécurité enregistrés."); e.recharger();
    } catch (err) { if ((err as { code?: string }).code !== "annulee") toast(messageErreur(err), true); }
  };
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  return (
    <>
      <div className="entete-page"><div><h2>Profil de l'entreprise</h2><p>Identité, logo et couleurs de l'espace {d.code}, repris sur l'écran et sur les factures, et règles de sécurité communes.</p></div></div>
      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Identité</h3><p>Tout ce qui est renseigné ici est imprimé dans l'en-tête des factures</p></div></div>
          <form onSubmit={enregistrer} style={{ display: "grid", gap: 12 }}>
            <Champ label="Raison sociale" valeur={form.raisonSociale} onChange={set("raisonSociale")} requis lectureSeule={!modifiable} />
            <div className="grille-champs">
              <Champ label="RCCM" valeur={form.rccm} onChange={set("rccm")} lectureSeule={!modifiable} aide="Registre du commerce et du crédit mobilier" />
              <Champ label="NIU" valeur={form.niu} onChange={set("niu")} lectureSeule={!modifiable} aide="Numéro d'identifiant unique (fiscal)" />
            </div>
            <div className="grille-champs">
              <div className="champ">
                <label htmlFor="regime">Régime fiscal</label>
                <input id="regime" list="regimes" value={form.regimeFiscal} onChange={(x) => set("regimeFiscal")(x.target.value)} readOnly={!modifiable} maxLength={80} />
                <datalist id="regimes">{REGIMES.map((r) => <option key={r} value={r} />)}</datalist>
                <span className="aide">Choisissez ou saisissez le régime indiqué par votre centre des impôts.</span>
              </div>
              <Champ label="N° de patente" valeur={form.patente} onChange={set("patente")} lectureSeule={!modifiable} aide="Contribution des patentes" />
            </div>
            <Champ label="Adresse" valeur={form.adresse} onChange={set("adresse")} lectureSeule={!modifiable} />
            <div className="grille-champs">
              <Champ label="Téléphone" valeur={form.telephone} onChange={set("telephone")} lectureSeule={!modifiable} />
              <Champ label="Adresse e-mail" type="email" valeur={form.email} onChange={set("email")} lectureSeule={!modifiable} />
            </div>
            <Champ label="Code entreprise" valeur={d.code} onChange={() => {}} lectureSeule aide="Identifiant de connexion, pas un mot de passe. Il figure aussi dans le code QR des factures." />
            <div className="grille-champs">
              <Champ label="Pays" valeur={d.pays} onChange={() => {}} lectureSeule />
              <Champ label="Devise" valeur={d.devise} onChange={() => {}} lectureSeule />
            </div>
            {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
            {modifiable && <div className="actions-form"><button className="btn btn-principal">Enregistrer</button></div>}
          </form>
        </section>
        <div style={{ display: "grid", gap: 16 }}>
          <LogoEtCouleurs ent={d} modifiable={modifiable} onFin={() => { e.recharger(); window.dispatchEvent(new Event(EVENEMENT_APPARENCE)); }} />
          <section className="panneau">
            <div className="entete-panneau"><div><h3>Sécurité</h3><p>Modification réservée à l'administration, avec confirmation</p></div></div>
            <form onSubmit={enregistrerSecu} style={{ display: "grid", gap: 12 }}>
              <label className="case"><input type="checkbox" checked={secu.mfaObligatoire} disabled={!a("company.admin")} onChange={(x) => setSecu({ ...secu, mfaObligatoire: x.target.checked })} />
                <span>Double authentification obligatoire pour les rôles sensibles</span></label>
              <Champ label="Désactiver les comptes inutilisés après (jours)" type="number" min={0} max={3650} valeur={secu.inactiviteJours} onChange={(v) => setSecu({ ...secu, inactiviteJours: v })} lectureSeule={!a("company.admin")} aide="0 = jamais. Le dernier administrateur n'est jamais désactivé automatiquement." />
              {a("company.admin") && <div className="actions-form"><button className="btn btn-principal">Enregistrer</button></div>}
            </form>
          </section>
          <section className="panneau">
            <div className="entete-panneau"><div><h3>Code maître</h3><p>Récupération d'accès d'un administrateur</p></div></div>
            <p style={{ margin: "0 0 10px" }}>
              {d.codeMaitre.bloque ? <span className="badge badge-rouge">Bloqué après des essais incorrects</span>
                : d.codeMaitre.actif ? <span className="badge badge-vert">Actif</span> : <span className="badge badge-orange">Aucun code valable</span>}
              {d.codeMaitre.creeLe && <span className="discret"> · généré le {dateHeure(d.codeMaitre.creeLe)}</span>}
            </p>
            <p className="discret" style={{ margin: "0 0 12px" }}>Conservez-le imprimé, sous enveloppe scellée, chez le dirigeant. Il ne doit pas rester chez l'administrateur informatique. Il ne fonctionne qu'une fois.</p>
            {a("company.admin") && <button className="btn" onClick={() => setRegen(true)}>Générer un nouveau code maître</button>}
          </section>
        </div>
      </div>
      {regen && <ConfirmerAction titre="Générer un nouveau code maître ?" libelle="Générer" danger
        texte="L'ancien code cessera immédiatement de fonctionner. Le nouveau ne sera affiché qu'une seule fois."
        onValider={async () => { const r = await api.post<{ codeMaitre: string }>("/api/entreprise/code-maitre"); setNouveauCode(r.codeMaitre); e.recharger(); }}
        onFermer={() => setRegen(false)} />}
      {nouveauCode && (
        <Modale titre="Nouveau code maître">
          <SecretUnique valeur={nouveauCode} explication={<>Imprimez ou recopiez ce code <b>maintenant</b> : il ne sera plus jamais affiché. Remettez-le sous enveloppe scellée au dirigeant.</>} />
          <div className="actions-form"><button className="btn btn-principal" onClick={() => setNouveauCode(null)}>Je l'ai mis en lieu sûr</button></div>
        </Modale>
      )}
    </>
  );
}

// Suggestions seulement : la liste exacte des régimes est à confirmer (Code général des impôts du Cameroun).
const REGIMES = ["Régime du réel", "Régime simplifié", "Impôt libératoire", "Régime de base"];

/** Réduit l'image (300 px au plus) et la convertit en PNG : supprime les métadonnées et tient sous la limite du serveur. */
async function preparerLogo(fichier: File): Promise<string> {
  if (!/^image\/(png|jpeg)$/.test(fichier.type)) throw new Error("Choisissez une image PNG ou JPEG.");
  const img = await createImageBitmap(fichier);
  const k = Math.min(1, 300 / Math.max(img.width, img.height));
  const toile = document.createElement("canvas");
  toile.width = Math.max(1, Math.round(img.width * k)); toile.height = Math.max(1, Math.round(img.height * k));
  toile.getContext("2d")!.drawImage(img, 0, 0, toile.width, toile.height);
  const blob = await new Promise<Blob>((ok, ko) => toile.toBlob((b) => (b ? ok(b) : ko(new Error("Image illisible."))), "image/png"));
  const octets = new Uint8Array(await blob.arrayBuffer());
  let bin = ""; for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(bin);
}

function LogoEtCouleurs({ ent, modifiable, onFin }: { ent: Ent; modifiable: boolean; onFin: () => void }) {
  const toast = useToast();
  const [c, setC] = useState<Couleurs>(ent.couleurs);
  const [envoi, setEnvoi] = useState(false);
  const [retrait, setRetrait] = useState(false);
  useEffect(() => setC(ent.couleurs), [ent.couleurs]);
  // Aperçu en direct sur tout l'écran ; on revient aux couleurs enregistrées en quittant la page sans enregistrer.
  useEffect(() => { appliquerCouleurs(c); }, [c]);
  useEffect(() => () => { window.dispatchEvent(new Event(EVENEMENT_APPARENCE)); }, []);
  const modifie = c.principale !== ent.couleurs.principale || c.accent !== ent.couleurs.accent;
  const v = variables(c);
  const ajuste = v["--marine"].toLowerCase() !== c.principale.toLowerCase();
  const enregistrer = async () => {
    try { await api.patch("/api/entreprise", { couleurs: c }); toast("Couleurs enregistrées."); onFin(); }
    catch (err) { toast(messageErreur(err), true); }
  };
  const choisirLogo = async (f: File | undefined) => {
    if (!f) return;
    setEnvoi(true);
    try { await api.post("/api/entreprise/logo", { image: await preparerLogo(f) }); toast("Logo enregistré. Il figurera sur les prochaines factures."); onFin(); }
    catch (err) { toast(err instanceof Error && !("code" in err) ? err.message : messageErreur(err), true); }
    finally { setEnvoi(false); }
  };
  return (
    <section className="panneau" aria-labelledby="titre-logo">
      <div className="entete-panneau"><div><h3 id="titre-logo">Logo et couleurs</h3><p>Personnalisent l'écran de tous les utilisateurs et les factures</p></div></div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div className="cadre-logo">{ent.logoUrl ? <img src={ent.logoUrl} alt="Logo actuel" /> : <span className="discret">Aucun logo</span>}</div>
        {modifiable && (
          <div style={{ display: "grid", gap: 6 }}>
            <label className="btn" style={{ cursor: envoi ? "wait" : "pointer", justifySelf: "start" }}>
              {envoi ? "Envoi…" : ent.logoUrl ? "Remplacer le logo" : "Ajouter un logo"}
              <input type="file" accept="image/png,image/jpeg" disabled={envoi} style={{ display: "none" }} aria-label="Fichier du logo (PNG ou JPEG)"
                onChange={(x) => { choisirLogo(x.target.files?.[0]); x.target.value = ""; }} />
            </label>
            {ent.logoUrl && <button className="btn btn-lien" style={{ justifySelf: "start" }} onClick={() => setRetrait(true)}>Retirer le logo</button>}
            <span className="aide">PNG ou JPEG, de préférence carré, sur fond blanc ou transparent.</span>
          </div>)}
      </div>
      <div className="grille-champs" style={{ marginTop: 14 }}>
        {(["principale", "accent"] as const).map((k) => (
          <div className="champ" key={k}>
            <label htmlFor={"couleur-" + k}>{k === "principale" ? "Couleur principale" : "Couleur d'accent"}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id={"couleur-" + k} type="color" value={c[k]} disabled={!modifiable} onChange={(x) => setC({ ...c, [k]: x.target.value })} style={{ width: 52, height: 38, padding: 2 }} />
              <span className="mono">{c[k].toUpperCase()}</span>
            </div>
            <span className="aide">{k === "principale" ? "Barre latérale, en-têtes de tableaux des factures." : "Boutons, liens, repères, bandeau des factures."}</span>
          </div>))}
      </div>
      <div className="apercu-couleurs" aria-label="Aperçu">
        <span style={{ background: v["--marine"], color: "#fff" }}>Menu</span>
        <span style={{ background: v["--accent"], color: v["--accent-texte"] }}>Bouton</span>
        <span style={{ color: v["--lien"], background: "#fff", border: "1px solid var(--ligne)" }}>Lien</span>
        <span style={{ background: c.principale, color: contraste(c.principale, "#ffffff") >= 4.5 ? "#fff" : "#17263b" }}>En-tête de facture</span>
      </div>
      {ajuste && <p className="aide" style={{ margin: "6px 0 0" }}>Certaines teintes sont légèrement assombries à l'écran pour que les textes restent lisibles.</p>}
      {modifiable && (
        <div className="actions-form">
          <button className="btn" onClick={() => setC(COULEURS_DEFAUT)}>Couleurs du logiciel</button>
          <button className="btn btn-principal" disabled={!modifie} onClick={enregistrer}>Enregistrer les couleurs</button>
        </div>)}
      {retrait && <ConfirmerAction titre="Retirer le logo ?" libelle="Retirer" texte="Les factures déjà émises gardent leur logo. Les prochaines n'en auront plus."
        onValider={async () => { await api.del("/api/entreprise/logo"); toast("Logo retiré."); onFin(); }} onFermer={() => setRetrait(false)} />}
    </section>
  );
}
