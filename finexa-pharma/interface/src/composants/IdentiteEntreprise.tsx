/**
 * Identité de l'entreprise sur les documents affichés à l'écran (aperçu de facture, d'avoir, profil).
 * Même logique que serveur/src/domaine/profil-entreprise.ts (lignesIdentite), qui produit les PDF :
 * les deux doivent rester alignés. Les données viennent toujours du serveur (identité figée du document
 * ou profil de l'entreprise active) ; rien n'est écrit en dur ici.
 */
export interface Identite {
  raisonSociale: string; nomCommercial?: string | null; sigle?: string | null; slogan?: string | null;
  formeJuridique?: string | null; capitalSocial?: number | null; devise?: string;
  adresse?: string | null; boitePostale?: string | null; localite?: string | null; region?: string | null; pays?: string | null;
  telephone?: string | null; email?: string | null; siteWeb?: string | null;
  niu?: string | null; rccm?: string | null; numeroContribuable?: string | null; numeroTva?: string | null;
  autresIdentifiants?: { libelle: string; valeur: string }[]; regimeFiscal?: string | null; patente?: string | null;
  enTete?: string | null; piedDePage?: string | null; banque?: { nom: string; titulaire: string | null; references: string | null } | null;
  moyensPaiement?: string[]; couleurs?: { principale: string; accent: string };
  logoId?: string | null; logoUrl?: string | null; cachetId?: string | null; cachetUrl?: string | null; formatPapier?: string;
}

const entier = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const devise = (d?: string) => (d === "XAF" || d === "XOF" || !d ? "FCFA" : d);
export const siteAffiche = (s: string) => s.replace(/^https?:\/\//, "");

export function lignesIdentite(v: Identite) {
  const sousTitre = [v.sigle !== v.raisonSociale && v.sigle, v.nomCommercial !== v.raisonSociale && v.nomCommercial].filter(Boolean).join(" · ") || null;
  const forme = v.formeJuridique
    ? `${v.formeJuridique}${v.capitalSocial ? ` au capital de ${entier(v.capitalSocial)} ${devise(v.devise)}` : ""}`
    : v.capitalSocial ? `Capital social : ${entier(v.capitalSocial)} ${devise(v.devise)}` : null;
  const bp = v.boitePostale ? (/^b\.?\s?p\b/i.test(v.boitePostale) ? v.boitePostale : `BP ${v.boitePostale}`) : null;
  const entete = [
    forme, v.enTete, v.adresse, [bp, v.localite].filter(Boolean).join(" · ") || null, [v.region, v.pays].filter(Boolean).join(", ") || null,
    v.telephone && `Tél. : ${v.telephone}`, v.email, v.siteWeb && siteAffiche(v.siteWeb),
    v.niu && `NIU : ${v.niu}`, v.rccm && `RCCM : ${v.rccm}`, v.numeroContribuable && `N° contribuable : ${v.numeroContribuable}`,
    v.numeroTva && `N° TVA : ${v.numeroTva}`, ...(v.autresIdentifiants ?? []).map((x) => `${x.libelle} : ${x.valeur}`),
    v.regimeFiscal && `Régime fiscal : ${v.regimeFiscal}`, v.patente && `Patente : ${v.patente}`,
  ].filter((l): l is string => !!l);
  const b = v.banque;
  const pied = [
    v.piedDePage,
    b && [`Banque : ${b.nom}`, b.titulaire && `titulaire : ${b.titulaire}`, b.references && `références : ${b.references}`].filter(Boolean).join(" · "),
    v.moyensPaiement?.length ? `Moyens de paiement acceptés : ${v.moyensPaiement.join(", ")}` : null,
  ].filter((l): l is string => !!l);
  return { sousTitre, slogan: v.slogan ?? null, entete, pied };
}

/** Bloc d'en-tête : logo (s'il existe), raison sociale, nom commercial, puis une information par ligne. */
export function BlocIdentite({ v, couleurTitre, couleurSousTitre }: { v: Identite; couleurTitre?: string; couleurSousTitre?: string }) {
  const l = lignesIdentite(v);
  return (
    <div className="bloc-identite">
      {v.logoUrl && <img src={v.logoUrl} alt={`Logo de ${v.raisonSociale}`} className="logo-document" />}
      <div style={{ minWidth: 0 }}>
        <b className="nom-document" style={{ color: couleurTitre }}>{v.raisonSociale}</b>
        {l.sousTitre && <div className="sous-titre-document" style={{ color: couleurSousTitre }}>{l.sousTitre}</div>}
        {l.slogan && <div className="slogan-document">{l.slogan}</div>}
        <div className="discret lignes-document">
          {l.entete.map((x, i) => <span key={i}>{v.siteWeb && x === siteAffiche(v.siteWeb) ? <a href={v.siteWeb} target="_blank" rel="noopener noreferrer">{x}</a> : x}</span>)}
        </div>
      </div>
    </div>
  );
}

/** Pied du document : mention libre, banque, moyens de paiement. Rien si l'entreprise n'a rien renseigné. */
export function PiedIdentite({ v }: { v: Identite }) {
  const l = lignesIdentite(v).pied;
  if (!l.length) return null;
  return <div className="pied-document">{l.map((x, i) => <span key={i}>{x}</span>)}</div>;
}

/** Cachet ou signature scannée, s'il a été figé sur le document. */
export function CachetDocument({ v }: { v: Identite }) {
  if (!v.cachetUrl) return null;
  return <figure className="cachet-document"><figcaption>Cachet et signature</figcaption><img src={v.cachetUrl} alt="Cachet de la pharmacie" /></figure>;
}
