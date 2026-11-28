import { useEffect, useId, useMemo, useState } from "react";
import { FINEXA } from "../jetons";
import { api, ApiErreur } from "../api";
import { useSession } from "../session";
import { Champ, Chargement, Modale, SecretUnique, dateHeure, messageErreur, useDonnees, useToast } from "../composants/ui";
import { ConfirmerAction } from "../composants/Confirmations";
import { BlocIdentite, CachetDocument, PiedIdentite, type Identite } from "../composants/IdentiteEntreprise";
import { appliquerCouleurs, assombrirPour, contraste, COULEURS_DEFAUT, EVENEMENT_APPARENCE, variables, type Couleurs } from "../theme";
import { dateFr } from "./comptabilite/commun";

type Affichage = { telephone: boolean; email: boolean; siteWeb: boolean; slogan: boolean; banque: boolean; moyensPaiement: boolean; cachet: boolean };
interface Ent {
  id: string; code: string; raisonSociale: string; statut: string; pays: string; paysNom: string; devise: string;
  nomCommercial: string | null; sigle: string | null; slogan: string | null; formeJuridique: string | null; capitalSocial: number | null; dateCreation: string | null;
  adresse: string | null; boitePostale: string | null; quartier: string | null; commune: string | null; ville: string | null; region: string | null;
  telephone: string | null; telephone2: string | null; email: string | null; siteWeb: string | null;
  rccm: string | null; niu: string | null; numeroContribuable: string | null; numeroTva: string | null; autresIdentifiants: { libelle: string; valeur: string }[];
  regimeFiscal: string | null; patente: string | null; referentiel: string | null;
  banque: { nom: string; titulaire: string | null; references: string | null } | null; moyensPaiement: string[];
  enTete: string | null; piedDePage: string | null; formatPapier: "A4" | "LETTER"; affichage: Affichage;
  couleurs: Couleurs; logoId: string | null; logoUrl: string | null; cachetId: string | null; cachetUrl: string | null;
  fiscal: { tvaApplicable: boolean; tauxTvaPdm: number }; exercice: { code: string; du: string; au: string } | null;
  identiteDocument: Identite;
  parametres: { mfaObligatoire: boolean; inactiviteJours: number };
  codeMaitre: { actif: boolean; creeLe: string | null; bloque: boolean };
}

const RUBRIQUES = [
  ["identite", "Identité"], ["coordonnees", "Coordonnées"], ["fiscal", "Juridique et fiscal"],
  ["banque", "Banque et paiement"], ["documents", "Documents"], ["securite", "Sécurité"],
] as const;
type Rubrique = (typeof RUBRIQUES)[number][0];
/** Rubrique de chaque champ (pour ouvrir la bonne quand le serveur signale une erreur). */
const RUBRIQUE_DE: Record<string, Rubrique> = {
  raisonSociale: "identite", nomCommercial: "identite", sigle: "identite", slogan: "identite", formeJuridique: "identite", capitalSocial: "identite", dateCreation: "identite",
  adresse: "coordonnees", boitePostale: "coordonnees", quartier: "coordonnees", commune: "coordonnees", ville: "coordonnees", region: "coordonnees",
  telephone: "coordonnees", telephone2: "coordonnees", email: "coordonnees", siteWeb: "coordonnees",
  rccm: "fiscal", niu: "fiscal", numeroContribuable: "fiscal", numeroTva: "fiscal", autresIdentifiants: "fiscal", regimeFiscal: "fiscal", patente: "fiscal", referentiel: "fiscal",
  banque: "banque", moyensPaiement: "banque", enTete: "documents", piedDePage: "documents", formatPapier: "documents", affichage: "documents", couleurs: "documents",
};
const TEXTES = ["raisonSociale", "nomCommercial", "sigle", "slogan", "formeJuridique", "capitalSocial", "dateCreation", "adresse", "boitePostale", "quartier", "commune",
  "ville", "region", "telephone", "telephone2", "email", "siteWeb", "rccm", "niu", "numeroContribuable", "numeroTva", "regimeFiscal", "patente", "referentiel",
  "enTete", "piedDePage", "banqueNom", "banqueTitulaire", "banqueReferences"] as const;
type Formulaire = Record<(typeof TEXTES)[number], string> & {
  autresIdentifiants: { libelle: string; valeur: string }[]; moyensPaiement: string[]; formatPapier: "A4" | "LETTER"; affichage: Affichage; couleurs: Couleurs;
};

// Suggestions seulement : chaque liste reste modifiable. Régimes : à confirmer auprès du centre des impôts.
const REGIMES = ["Régime du réel", "Régime simplifié", "Impôt libératoire", "Régime de base"];
const FORMES = ["SARL", "SARL unipersonnelle", "SA", "SAS", "SNC", "SCS", "GIE", "Entreprise individuelle", "Société coopérative", "Association", "Établissement public"];
const REFERENTIELS: [string, string][] = [["", "Non précisé"], ["syscohada_normal", "SYSCOHADA révisé, système normal"], ["syscohada_smt", "SYSCOHADA révisé, système minimal de trésorerie"], ["autre", "Autre référentiel"]];
const MOYENS: [string, string][] = [["especes", "Espèces"], ["virement", "Virement bancaire"], ["cheque", "Chèque"], ["mobile_money", "Mobile money"], ["carte", "Carte bancaire"]];
const OPTIONS_AFFICHAGE: [keyof Affichage, string][] = [["telephone", "Téléphones"], ["email", "Adresse e-mail"], ["siteWeb", "Site web"], ["slogan", "Slogan"],
  ["banque", "Coordonnées bancaires"], ["moyensPaiement", "Moyens de paiement acceptés"], ["cachet", "Cachet ou signature"]];

const versFormulaire = (d: Ent): Formulaire => ({
  raisonSociale: d.raisonSociale, nomCommercial: d.nomCommercial ?? "", sigle: d.sigle ?? "", slogan: d.slogan ?? "", formeJuridique: d.formeJuridique ?? "",
  capitalSocial: d.capitalSocial != null ? String(d.capitalSocial) : "", dateCreation: d.dateCreation ?? "",
  adresse: d.adresse ?? "", boitePostale: d.boitePostale ?? "", quartier: d.quartier ?? "", commune: d.commune ?? "", ville: d.ville ?? "", region: d.region ?? "",
  telephone: d.telephone ?? "", telephone2: d.telephone2 ?? "", email: d.email ?? "", siteWeb: d.siteWeb ?? "",
  rccm: d.rccm ?? "", niu: d.niu ?? "", numeroContribuable: d.numeroContribuable ?? "", numeroTva: d.numeroTva ?? "", regimeFiscal: d.regimeFiscal ?? "",
  patente: d.patente ?? "", referentiel: d.referentiel ?? "", enTete: d.enTete ?? "", piedDePage: d.piedDePage ?? "",
  banqueNom: d.banque?.nom ?? "", banqueTitulaire: d.banque?.titulaire ?? "", banqueReferences: d.banque?.references ?? "",
  autresIdentifiants: d.autresIdentifiants.map((x) => ({ ...x })), moyensPaiement: [...d.moyensPaiement], formatPapier: d.formatPapier,
  affichage: { ...d.affichage }, couleurs: { ...d.couleurs },
});

export function Entreprise() {
  const { a, rafraichir } = useSession();
  const toast = useToast();
  const e = useDonnees(() => api.get<Ent>("/api/entreprise"), []);
  const [rubrique, setRubrique] = useState<Rubrique>("identite");
  const [form, setForm] = useState<Formulaire | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState<string[] | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { if (e.donnees) setForm(versFormulaire(e.donnees)); }, [e.donnees]);
  // Aperçu des couleurs en direct sur tout l'écran ; retour aux couleurs enregistrées en quittant la page.
  useEffect(() => { if (form) appliquerCouleurs(form.couleurs); }, [form?.couleurs]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { window.dispatchEvent(new Event(EVENEMENT_APPARENCE)); }, []);
  const initial = useMemo(() => (e.donnees ? JSON.stringify(versFormulaire(e.donnees)) : ""), [e.donnees]);

  if (e.erreur) return <div className="alerte alerte-erreur">{e.erreur}</div>;
  if (!e.donnees || !form) return <Chargement />;
  const d = e.donnees;
  const modifiable = a("company.update");
  const modifie = JSON.stringify(form) !== initial;
  const set = <K extends keyof Formulaire>(k: K) => (v: Formulaire[K]) => { setForm({ ...form, [k]: v }); setErreurs(({ [k]: _, ...reste }) => reste); };
  const champ = (k: (typeof TEXTES)[number], label: string, opts: Partial<Parameters<typeof Champ>[0]> = {}) => (
    <Champ label={label} valeur={form[k]} onChange={set(k)} lectureSeule={!modifiable} erreur={erreurs[k]} {...opts} />);

  // Corps envoyé au serveur : chaînes vides = champ effacé (null), jamais de valeur inventée.
  const corps = () => {
    const n = (v: string) => v.trim() || null;
    const capital = form.capitalSocial.replace(/\s/g, "");
    return {
      ...Object.fromEntries(TEXTES.filter((k) => !k.startsWith("banque") && k !== "capitalSocial" && k !== "raisonSociale").map((k) => [k, n(form[k])])),
      raisonSociale: form.raisonSociale.trim(), capitalSocial: capital ? Number(capital) : null,
      autresIdentifiants: form.autresIdentifiants.map((x) => ({ libelle: x.libelle.trim(), valeur: x.valeur.trim() })).filter((x) => x.libelle || x.valeur),
      banque: n(form.banqueNom) || n(form.banqueTitulaire) || n(form.banqueReferences) ? { nom: n(form.banqueNom), titulaire: n(form.banqueTitulaire), references: n(form.banqueReferences) } : null,
      moyensPaiement: form.moyensPaiement, formatPapier: form.formatPapier, affichage: form.affichage, couleurs: form.couleurs,
    };
  };
  const verifierLocal = () => {
    const err: Record<string, string> = {};
    if (form.raisonSociale.trim().length < 2) err.raisonSociale = "La raison sociale est obligatoire.";
    if (form.capitalSocial.trim() && !/^\d[\d\s]*$/.test(form.capitalSocial.trim())) err.capitalSocial = "Montant en chiffres, sans décimales (ex. 1 000 000).";
    if ((form.banqueTitulaire.trim() || form.banqueReferences.trim()) && !form.banqueNom.trim()) err.banqueNom = "Indiquez le nom de la banque.";
    return err;
  };
  const demander = (ev: React.FormEvent) => {
    ev.preventDefault(); setErreur(null);
    const err = verifierLocal();
    if (Object.keys(err).length) { setErreurs(err); setRubrique(RUBRIQUE_DE[Object.keys(err)[0]] ?? (Object.keys(err)[0].startsWith("banque") ? "banque" : "identite")); return; }
    // Changements importants (imprimés sur tous les documents) : confirmation explicite.
    const importants = ([["raisonSociale", "raison sociale"], ["niu", "NIU"], ["rccm", "RCCM"], ["formeJuridique", "forme juridique"]] as const)
      .filter(([k]) => form[k].trim() !== (versFormulaire(d)[k] ?? "").trim()).map(([, l]) => l);
    if (importants.length) setConfirmer(importants); else enregistrer();
  };
  const enregistrer = async () => {
    setEnvoi(true); setErreur(null);
    try {
      await api.patch("/api/entreprise", corps());
      toast("Profil enregistré. Les prochains documents reprendront ces informations ; ceux déjà émis ne changent pas.");
      e.recharger(); rafraichir(); window.dispatchEvent(new Event(EVENEMENT_APPARENCE));
    } catch (err) {
      if (err instanceof ApiErreur && err.champs?.length) {
        const parChamp = Object.fromEntries(err.champs.map((c) => [c.champ.split(".")[0] === "banque" ? "banqueNom" : c.champ.split(".")[0], c.message]));
        setErreurs(parChamp);
        const premier = err.champs[0].champ.split(".")[0];
        setRubrique(RUBRIQUE_DE[premier] ?? "identite");
        setErreur("Certaines informations sont invalides : voir les champs signalés en rouge.");
      } else setErreur(messageErreur(err));
    } finally { setEnvoi(false); }
  };

  return (
    <>
      <div className="entete-page">
        <div><h2>Profil de l'entreprise</h2><p>Source unique des informations reprises par le logiciel : en-tête des factures, avoirs et reçus, états comptables, écran. Espace {d.code}.</p></div>
      </div>
      <div className="onglets-profil" role="tablist" aria-label="Rubriques du profil">
        {RUBRIQUES.map(([k, l]) => (
          <button key={k} role="tab" id={`onglet-${k}`} aria-selected={rubrique === k} aria-controls={`rubrique-${k}`} onClick={() => setRubrique(k)}>{l}</button>))}
      </div>

      {rubrique === "securite" ? <Securite ent={d} onFin={e.recharger} /> : (
        <form onSubmit={demander} noValidate>
          <div className="deux">
            <section className="panneau" role="tabpanel" id={`rubrique-${rubrique}`} aria-labelledby={`onglet-${rubrique}`} style={{ display: "grid", gap: 12, alignContent: "start" }}>
              {rubrique === "identite" && <>
                <div className="entete-panneau" style={{ margin: 0 }}><div><h3>Identité de l'entreprise</h3><p>Imprimée en tête de chaque document</p></div></div>
                {champ("raisonSociale", "Raison sociale", { requis: true, aide: "Nom légal, tel qu'inscrit au RCCM." })}
                <div className="grille-champs">{champ("nomCommercial", "Nom commercial", { aide: "Enseigne, si elle diffère de la raison sociale." })}{champ("sigle", "Sigle")}</div>
                {champ("slogan", "Slogan")}
                <div className="grille-champs">
                  <ListeOuSaisie label="Forme juridique" valeur={form.formeJuridique} onChange={set("formeJuridique")} options={FORMES} lectureSeule={!modifiable} erreur={erreurs.formeJuridique} />
                  {champ("capitalSocial", `Capital social (${d.devise === "XAF" ? "FCFA" : d.devise})`, { inputMode: "numeric", aide: "Facultatif. Imprimé avec la forme juridique." })}
                </div>
                {champ("dateCreation", "Date de création", { type: "date", aide: "Facultative." })}
              </>}
              {rubrique === "coordonnees" && <>
                <div className="entete-panneau" style={{ margin: 0 }}><div><h3>Coordonnées</h3><p>Seules les informations renseignées s'impriment</p></div></div>
                {champ("adresse", "Adresse", { placeholder: "Rue, immeuble, repère" })}
                <div className="grille-champs">{champ("quartier", "Quartier")}{champ("commune", "Arrondissement ou commune")}</div>
                <div className="grille-champs">{champ("ville", "Ville")}{champ("boitePostale", "Boîte postale", { placeholder: "Ex. 1234" })}</div>
                <div className="grille-champs">{champ("region", "Région ou département")}<Champ label="Pays" valeur={d.paysNom} onChange={() => {}} lectureSeule aide="Fixé à la création de l'espace." /></div>
                <div className="grille-champs">{champ("telephone", "Téléphone principal", { type: "tel", placeholder: "+237 6XX XX XX XX" })}{champ("telephone2", "Téléphone secondaire", { type: "tel" })}</div>
                <div className="grille-champs">{champ("email", "Adresse e-mail professionnelle", { type: "email" })}{champ("siteWeb", "Site web officiel", { placeholder: "www.monentreprise.cm" })}</div>
              </>}
              {rubrique === "fiscal" && <>
                <div className="entete-panneau" style={{ margin: 0 }}><div><h3>Informations juridiques et fiscales</h3><p>Recopiez les numéros exacts de vos documents officiels</p></div></div>
                <div className="grille-champs">{champ("rccm", "N° RCCM", { aide: "Registre du commerce et du crédit mobilier" })}{champ("niu", "NIU", { aide: "Numéro d'identifiant unique (fiscal)" })}</div>
                <div className="grille-champs">{champ("numeroContribuable", "N° de contribuable", { aide: "S'il est distinct du NIU." })}{champ("patente", "N° de patente")}</div>
                <AutresIdentifiants liste={form.autresIdentifiants} onChange={set("autresIdentifiants")} lectureSeule={!modifiable} erreur={erreurs.autresIdentifiants} />
                <div className="grille-champs">
                  <ListeOuSaisie label="Régime fiscal" valeur={form.regimeFiscal} onChange={set("regimeFiscal")} options={REGIMES} lectureSeule={!modifiable} aide="Celui indiqué par votre centre des impôts." />
                  {champ("numeroTva", "N° de TVA", { aide: d.fiscal.tvaApplicable ? "Facultatif : souvent le NIU." : "Réservé aux entreprises qui appliquent la TVA." })}
                </div>
                <div className="champ">
                  <label htmlFor="referentiel">Référentiel comptable</label>
                  <select id="referentiel" value={form.referentiel} disabled={!modifiable} onChange={(x) => set("referentiel")(x.target.value)}>
                    {REFERENTIELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <span className="aide">Le plan comptable du logiciel suit le SYSCOHADA révisé.</span>
                </div>
                <dl className="resume-profil">
                  <dt>Pays d'immatriculation</dt><dd>{d.paysNom}</dd>
                  <dt>Devise</dt><dd>{d.devise === "XAF" ? "Franc CFA (XAF)" : d.devise} <span className="discret">· fixée à la création, elle ne change pas après les premières écritures</span></dd>
                  <dt>TVA</dt><dd>{d.fiscal.tvaApplicable ? `Appliquée au taux de ${(d.fiscal.tauxTvaPdm / 100).toLocaleString("fr-FR")} %` : "Non appliquée"}{a("accounting.admin") && <> · <a href="#/comptabilite/parametres">modifier</a></>}</dd>
                  <dt>Exercice en cours</dt><dd>{d.exercice ? <>{d.exercice.code} : du {dateFr(d.exercice.du)} au {dateFr(d.exercice.au)}</> : "Aucun exercice ouvert"}{a("accounting.read") && <> · <a href="#/comptabilite/parametres">exercices</a></>}</dd>
                </dl>
              </>}
              {rubrique === "banque" && <>
                <div className="entete-panneau" style={{ margin: 0 }}><div><h3>Banque et paiement</h3><p>Facultatif : utile si vos clients paient par virement</p></div></div>
                {champ("banqueNom", "Nom de la banque")}
                {champ("banqueTitulaire", "Titulaire du compte")}
                {champ("banqueReferences", "Références bancaires (RIB ou IBAN)", { aide: "Telles qu'elles doivent apparaître sur les factures." })}
                <fieldset className="champ cases-profil">
                  <legend>Moyens de paiement acceptés</legend>
                  {MOYENS.map(([k, l]) => (
                    <label key={k} className="case"><input type="checkbox" disabled={!modifiable} checked={form.moyensPaiement.includes(k)}
                      onChange={(x) => set("moyensPaiement")(x.target.checked ? [...form.moyensPaiement, k] : form.moyensPaiement.filter((m) => m !== k))} /><span>{l}</span></label>))}
                </fieldset>
              </>}
              {rubrique === "documents" && <>
                <div className="entete-panneau" style={{ margin: 0 }}><div><h3>Personnalisation des documents</h3><p>Factures, avoirs, reçus</p></div></div>
                <Images ent={d} modifiable={modifiable} onFin={() => { e.recharger(); window.dispatchEvent(new Event(EVENEMENT_APPARENCE)); }} />
                <Couleurs c={form.couleurs} setC={set("couleurs")} modifiable={modifiable} />
                {champ("enTete", "Mention d'en-tête", { aide: "Ligne libre sous le nom (ex. agrément, activité). Facultative." })}
                <div className="champ">
                  <label htmlFor="pied">Pied de page</label>
                  <textarea id="pied" rows={2} maxLength={300} value={form.piedDePage} readOnly={!modifiable} onChange={(x) => set("piedDePage")(x.target.value)} />
                  <span className="aide">Conditions de vente, mentions légales… Facultatif.</span>
                </div>
                <div className="champ">
                  <label htmlFor="format">Format de papier</label>
                  <select id="format" value={form.formatPapier} disabled={!modifiable} onChange={(x) => set("formatPapier")(x.target.value as "A4" | "LETTER")}>
                    <option value="A4">A4 (21 × 29,7 cm)</option><option value="LETTER">Lettre US (21,6 × 27,9 cm)</option>
                  </select>
                </div>
                <fieldset className="champ cases-profil">
                  <legend>Imprimer sur les documents</legend>
                  {OPTIONS_AFFICHAGE.map(([k, l]) => (
                    <label key={k} className="case"><input type="checkbox" disabled={!modifiable} checked={form.affichage[k]}
                      onChange={(x) => set("affichage")({ ...form.affichage, [k]: x.target.checked })} /><span>{l}</span></label>))}
                  <span className="aide">La raison sociale, le NIU et le RCCM s'impriment toujours lorsqu'ils sont renseignés.</span>
                </fieldset>
              </>}
            </section>
            <ApercuEntete d={d} modifie={modifie} />
          </div>
          {modifiable && (
            <div className="barre-enregistrement">
              {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
              <span className="discret">{modifie ? "Modifications non enregistrées." : "Toutes les modifications sont enregistrées."}</span>
              <button type="button" className="btn" disabled={!modifie || envoi} onClick={() => { setForm(versFormulaire(d)); setErreurs({}); setErreur(null); }}>Annuler les modifications</button>
              <button className="btn btn-principal" disabled={!modifie || envoi} aria-busy={envoi || undefined}>{envoi ? "Enregistrement…" : "Enregistrer le profil"}</button>
            </div>)}
        </form>
      )}
      {confirmer && <ConfirmerAction titre="Enregistrer ces changements ?" libelle="Enregistrer"
        texte={<>Vous modifiez : <b>{confirmer.join(", ")}</b>. Ces informations seront imprimées sur tous les <b>nouveaux</b> documents. Les factures, avoirs et reçus déjà émis gardent celles du jour de leur émission.</>}
        onValider={async () => { setConfirmer(null); await enregistrer(); }} onFermer={() => setConfirmer(null)} />}
    </>
  );
}

/** Aperçu de l'en-tête et du pied des prochains documents, d'après le profil enregistré. */
function ApercuEntete({ d, modifie }: { d: Ent; modifie: boolean }) {
  const v = d.identiteDocument;
  const avecImages = { ...v, logoUrl: v.logoId ? `/api/entreprise/logos/${v.logoId}` : null, cachetUrl: v.cachetId ? `/api/entreprise/logos/${v.cachetId}` : null };
  return (
    <section className="panneau apercu-collant" aria-labelledby="titre-apercu" style={{ display: "grid", gap: 12, alignContent: "start" }}>
      <div className="entete-panneau" style={{ margin: 0 }}><div><h3 id="titre-apercu">Aperçu des prochains documents</h3>
        <p>{modifie ? "Profil enregistré ; vos modifications apparaîtront après « Enregistrer »." : `En-tête et pied d'une facture émise aujourd'hui (${d.formatPapier === "LETTER" ? "Lettre US" : "A4"}).`}</p></div></div>
      <div className="apercu-entete" style={{ borderTop: `5px solid ${v.couleurs?.accent ?? COULEURS_DEFAUT.accent}` }}>
        <BlocIdentite v={avecImages} couleurTitre={assombrirPour(v.couleurs?.principale ?? COULEURS_DEFAUT.principale, FINEXA.white, 4.5)}
          couleurSousTitre={assombrirPour(v.couleurs?.accent ?? COULEURS_DEFAUT.accent, FINEXA.white, 4.5)} />
        <div className="discret apercu-corps">… lignes de la facture, totaux, code de vérification …</div>
        <CachetDocument v={avecImages} />
        <PiedIdentite v={avecImages} />
      </div>
    </section>
  );
}

/** Champ libre avec suggestions (datalist). */
function ListeOuSaisie(p: { label: string; valeur: string; onChange: (v: string) => void; options: string[]; lectureSeule: boolean; aide?: string; erreur?: string }) {
  const id = useId();
  return (
    <div className="champ">
      <label htmlFor={id}>{p.label}</label>
      <input id={id} list={id + "-l"} value={p.valeur} onChange={(x) => p.onChange(x.target.value)} readOnly={p.lectureSeule} maxLength={80} aria-invalid={!!p.erreur} />
      <datalist id={id + "-l"}>{p.options.map((o) => <option key={o} value={o} />)}</datalist>
      {p.erreur ? <span className="erreur-champ">{p.erreur}</span> : p.aide && <span className="aide">{p.aide}</span>}
    </div>
  );
}

function AutresIdentifiants({ liste, onChange, lectureSeule, erreur }: { liste: { libelle: string; valeur: string }[]; onChange: (l: { libelle: string; valeur: string }[]) => void; lectureSeule: boolean; erreur?: string }) {
  const maj = (i: number, k: "libelle" | "valeur", v: string) => onChange(liste.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <fieldset className="champ cases-profil">
      <legend>Autres identifiants légaux</legend>
      {liste.map((x, i) => (
        <div key={i} className="ligne-identifiant">
          <input aria-label={`Libellé de l'identifiant ${i + 1}`} placeholder="Ex. N° CNPS" value={x.libelle} readOnly={lectureSeule} maxLength={40} onChange={(ev) => maj(i, "libelle", ev.target.value)} />
          <input aria-label={`Valeur de l'identifiant ${i + 1}`} placeholder="Numéro" value={x.valeur} readOnly={lectureSeule} maxLength={60} onChange={(ev) => maj(i, "valeur", ev.target.value)} />
          {!lectureSeule && <button type="button" className="btn btn-lien" onClick={() => onChange(liste.filter((_, j) => j !== i))} aria-label={`Retirer l'identifiant ${i + 1}`}>Retirer</button>}
        </div>))}
      {!lectureSeule && liste.length < 4 && <button type="button" className="btn" style={{ justifySelf: "start" }} onClick={() => onChange([...liste, { libelle: "", valeur: "" }])}>+ Ajouter un identifiant</button>}
      {erreur ? <span className="erreur-champ">{erreur}</span> : <span className="aide">Selon le pays : CNPS, agrément, numéro statistique… Quatre au plus.</span>}
    </fieldset>
  );
}

/** Réduit l'image (300 px au plus) et la convertit en PNG : supprime les métadonnées et tient sous la limite du serveur. */
async function preparerImage(fichier: File): Promise<string> {
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

/** Logo et cachet : enregistrés immédiatement en base (une version par envoi, les documents émis gardent la leur). */
function Images({ ent, modifiable, onFin }: { ent: Ent; modifiable: boolean; onFin: () => void }) {
  const toast = useToast();
  const [envoi, setEnvoi] = useState<null | "logo" | "cachet">(null);
  const [retrait, setRetrait] = useState<null | "logo" | "cachet">(null);
  const choisir = async (type: "logo" | "cachet", f: File | undefined) => {
    if (!f) return;
    setEnvoi(type);
    try {
      await api.post(`/api/entreprise/${type}`, { image: await preparerImage(f) });
      toast(`${type === "logo" ? "Logo" : "Cachet"} enregistré. Il figurera sur les prochains documents.`); onFin();
    } catch (err) { toast(err instanceof Error && !("code" in err) ? err.message : messageErreur(err), true); }
    finally { setEnvoi(null); }
  };
  const bloc = (type: "logo" | "cachet", url: string | null, titre: string, aide: string) => (
    <div className="bloc-image">
      <div className="cadre-logo">{url ? <img src={url} alt={`${titre} actuel`} /> : <span className="discret">Aucun {type}</span>}</div>
      <div style={{ display: "grid", gap: 6 }}>
        <b>{titre}</b>
        {modifiable && <>
          <label className="btn" style={{ cursor: envoi ? "wait" : "pointer", justifySelf: "start" }}>
            {envoi === type ? "Envoi…" : url ? `Remplacer le ${type}` : `Ajouter un ${type}`}
            <input type="file" accept="image/png,image/jpeg" disabled={!!envoi} style={{ display: "none" }} aria-label={`Fichier du ${type} (PNG ou JPEG)`}
              onChange={(x) => { choisir(type, x.target.files?.[0]); x.target.value = ""; }} />
          </label>
          {url && <button type="button" className="btn btn-lien" style={{ justifySelf: "start" }} onClick={() => setRetrait(type)}>Retirer le {type}</button>}
        </>}
        <span className="aide">{aide}</span>
      </div>
    </div>);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {bloc("logo", ent.logoUrl, "Logo", "PNG ou JPEG, de préférence carré, sur fond blanc ou transparent. Enregistré dans la base de l'entreprise.")}
      {bloc("cachet", ent.cachetUrl, "Cachet ou signature", "Facultatif. Image scannée, imprimée en bas des documents si l'option est cochée.")}
      {retrait && <ConfirmerAction titre={`Retirer le ${retrait} ?`} libelle="Retirer" texte={`Les documents déjà émis gardent leur ${retrait}. Les prochains n'en auront plus.`}
        onValider={async () => { await api.del(`/api/entreprise/${retrait}`); toast(retrait === "logo" ? "Logo retiré." : "Cachet retiré."); setRetrait(null); onFin(); }} onFermer={() => setRetrait(null)} />}
    </div>
  );
}

function Couleurs({ c, setC, modifiable }: { c: Couleurs; setC: (c: Couleurs) => void; modifiable: boolean }) {
  const v = variables(c);
  const ajuste = v["--marine"].toLowerCase() !== c.principale.toLowerCase();
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="grille-champs">
        {(["principale", "accent"] as const).map((k) => (
          <div className="champ" key={k}>
            <label htmlFor={"couleur-" + k}>{k === "principale" ? "Couleur principale" : "Couleur secondaire"}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id={"couleur-" + k} type="color" value={c[k]} disabled={!modifiable} onChange={(x) => setC({ ...c, [k]: x.target.value })} style={{ width: 52, height: 38, padding: 2 }} />
              <span className="mono">{c[k].toUpperCase()}</span>
            </div>
            <span className="aide">{k === "principale" ? "Barre latérale, en-têtes de tableaux des documents." : "Boutons, liens, bandeau des documents."}</span>
          </div>))}
      </div>
      <div className="apercu-couleurs" aria-label="Aperçu des couleurs">
        <span style={{ background: v["--marine"], color: FINEXA.white }}>Menu</span>
        <span style={{ background: v["--accent"], color: v["--accent-texte"] }}>Bouton</span>
        <span style={{ color: v["--lien"], background: FINEXA.white, border: "1px solid var(--ligne)" }}>Lien</span>
        <span style={{ background: c.principale, color: contraste(c.principale, FINEXA.white) >= 4.5 ? FINEXA.white : FINEXA.text }}>En-tête de facture</span>
      </div>
      {ajuste && <p className="aide" style={{ margin: 0 }}>Certaines teintes sont légèrement assombries à l'écran pour que les textes restent lisibles.</p>}
      {modifiable && <button type="button" className="btn" style={{ justifySelf: "start" }} onClick={() => setC(COULEURS_DEFAUT)}>Revenir aux couleurs du logiciel</button>}
    </div>
  );
}

function Securite({ ent: d, onFin }: { ent: Ent; onFin: () => void }) {
  const { a } = useSession();
  const toast = useToast();
  const [secu, setSecu] = useState({ mfaObligatoire: d.parametres.mfaObligatoire, inactiviteJours: String(d.parametres.inactiviteJours) });
  const [regen, setRegen] = useState(false);
  const [nouveauCode, setNouveauCode] = useState<string | null>(null);
  const enregistrerSecu = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      await api.patch("/api/entreprise", { parametres: { mfaObligatoire: secu.mfaObligatoire, inactiviteJours: Number(secu.inactiviteJours) } });
      toast("Paramètres de sécurité enregistrés."); onFin();
    } catch (err) { if ((err as { code?: string }).code !== "annulee") toast(messageErreur(err), true); }
  };
  return (
    <div className="deux" role="tabpanel" id="rubrique-securite" aria-labelledby="onglet-securite">
      <section className="panneau">
        <div className="entete-panneau"><div><h3>Sécurité</h3><p>Modification réservée à l'administration, avec confirmation</p></div></div>
        <form onSubmit={enregistrerSecu} style={{ display: "grid", gap: 12 }}>
          <label className="case"><input type="checkbox" checked={secu.mfaObligatoire} disabled={!a("company.admin")} onChange={(x) => setSecu({ ...secu, mfaObligatoire: x.target.checked })} />
            <span>Double authentification obligatoire pour les rôles sensibles</span></label>
          <Champ label="Désactiver les comptes inutilisés après (jours)" type="number" min={0} max={3650} valeur={secu.inactiviteJours} onChange={(v) => setSecu({ ...secu, inactiviteJours: v })} lectureSeule={!a("company.admin")} aide="0 = jamais. Le dernier administrateur n'est jamais désactivé automatiquement." />
          <Champ label="Code entreprise" valeur={d.code} onChange={() => {}} lectureSeule aide="Identifiant de connexion, pas un mot de passe. Il figure aussi dans le code QR des factures." />
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
      {regen && <ConfirmerAction titre="Générer un nouveau code maître ?" libelle="Générer" danger
        texte="L'ancien code cessera immédiatement de fonctionner. Le nouveau ne sera affiché qu'une seule fois."
        onValider={async () => { const r = await api.post<{ codeMaitre: string }>("/api/entreprise/code-maitre"); setNouveauCode(r.codeMaitre); onFin(); }}
        onFermer={() => setRegen(false)} />}
      {nouveauCode && (
        <Modale titre="Nouveau code maître">
          <SecretUnique valeur={nouveauCode} explication={<>Imprimez ou recopiez ce code <b>maintenant</b> : il ne sera plus jamais affiché. Remettez-le sous enveloppe scellée au dirigeant.</>} />
          <div className="actions-form"><button className="btn btn-principal" onClick={() => setNouveauCode(null)}>Je l'ai mis en lieu sûr</button></div>
        </Modale>
      )}
    </div>
  );
}
