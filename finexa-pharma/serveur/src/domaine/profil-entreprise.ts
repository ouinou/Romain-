import { z } from "zod";
import type { Client } from "../db.js";
import { COULEURS_DEFAUT } from "./marque.js";

/**
 * Profil de l'entreprise : source unique de l'identité imprimée sur les documents (factures, avoirs, reçus,
 * états comptables). Tous les modules passent par ce fichier ; aucun nom ni identifiant n'est écrit en dur ailleurs.
 *
 * Stockage (base PostgreSQL de l'entreprise, rien dans le navigateur) :
 *   - colonnes de companies : raison sociale, RCCM, NIU, adresse, téléphone, pays, devise ;
 *   - companies.settings.profil : le reste (coordonnées, fiscalité, banque, options des documents, logo, cachet) ;
 *   - companies.settings.identiteDocument : l'identité prête à imprimer, recalculée à chaque modification.
 *     Un déclencheur la recopie dans chaque mouvement de trésorerie (reçus) ; factures et avoirs la figent eux-mêmes.
 */

/** Pays de l'espace OHADA (codes ISO 3166-1). */
export const PAYS_OHADA: Record<string, string> = {
  BJ: "Bénin", BF: "Burkina Faso", CM: "Cameroun", CF: "Centrafrique", KM: "Comores", CG: "Congo", CI: "Côte d'Ivoire",
  GA: "Gabon", GN: "Guinée", GW: "Guinée-Bissau", GQ: "Guinée équatoriale", ML: "Mali", NE: "Niger", CD: "République démocratique du Congo",
  SN: "Sénégal", TD: "Tchad", TG: "Togo",
};
export const REFERENTIELS: Record<string, string> = {
  syscohada_normal: "SYSCOHADA révisé, système normal",
  syscohada_smt: "SYSCOHADA révisé, système minimal de trésorerie",
  autre: "Autre référentiel",
};
export const MOYENS_PAIEMENT: Record<string, string> = {
  especes: "Espèces", virement: "Virement bancaire", cheque: "Chèque", mobile_money: "Mobile money", carte: "Carte bancaire",
};
export const FORMATS_PAPIER = ["A4", "LETTER"] as const;

const AFFICHAGE_DEFAUT = { telephone: true, email: true, siteWeb: true, slogan: true, banque: true, moyensPaiement: true, cachet: true };
export type Affichage = typeof AFFICHAGE_DEFAUT;

/** Champs facultatifs du profil (companies.settings.profil). */
export function profilDe(settings: any) {
  const p = settings?.profil ?? {};
  const s = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null);
  return {
    nomCommercial: s("nomCommercial"), sigle: s("sigle"), slogan: s("slogan"), formeJuridique: s("formeJuridique"),
    capitalSocial: typeof p.capitalSocial === "number" ? (p.capitalSocial as number) : null, dateCreation: s("dateCreation"),
    boitePostale: s("boitePostale"), quartier: s("quartier"), commune: s("commune"), ville: s("ville"), region: s("region"),
    telephone2: s("telephone2"), email: s("email"), siteWeb: s("siteWeb"),
    numeroContribuable: s("numeroContribuable"), numeroTva: s("numeroTva"),
    autresIdentifiants: Array.isArray(p.autresIdentifiants) ? (p.autresIdentifiants as { libelle: string; valeur: string }[]) : [],
    regimeFiscal: s("regimeFiscal"), patente: s("patente"), referentiel: s("referentiel"),
    banque: p.banque?.nom ? { nom: String(p.banque.nom), titulaire: p.banque.titulaire ?? null, references: p.banque.references ?? null } as Banque : null,
    moyensPaiement: Array.isArray(p.moyensPaiement) ? (p.moyensPaiement as string[]).filter((m) => m in MOYENS_PAIEMENT) : [],
    enTete: s("enTete"), piedDePage: s("piedDePage"),
    formatPapier: (FORMATS_PAPIER as readonly string[]).includes(p.formatPapier) ? (p.formatPapier as (typeof FORMATS_PAPIER)[number]) : "A4",
    affichage: { ...AFFICHAGE_DEFAUT, ...(p.affichage ?? {}) } as Affichage,
    couleurs: { principale: p.couleurs?.principale ?? COULEURS_DEFAUT.principale, accent: p.couleurs?.accent ?? COULEURS_DEFAUT.accent },
    logoId: s("logoId"), logoUrl: p.logoId ? `/api/entreprise/logos/${p.logoId}` : null,
    cachetId: s("cachetId"), cachetUrl: p.cachetId ? `/api/entreprise/logos/${p.cachetId}` : null,
  };
}
interface Banque { nom: string; titulaire: string | null; references: string | null }

/* ------------------------------------------------------------------ Validation */

const texte = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
/** Téléphone : chiffres, espaces, points, tirets, parenthèses, « + » initial ; 6 à 15 chiffres (norme E.164). */
const telephone = texte(30).refine((v) => v == null || (/^\+?[0-9][0-9 .()-]*$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 6 && (v.match(/\d/g)?.length ?? 0) <= 15),
  "Numéro de téléphone invalide : chiffres, espaces et « + » initial seulement (6 à 15 chiffres).");
/** Site web : « exemple.cm », « www.exemple.cm » ou une adresse http(s) ; enregistré sous la forme https://… */
export function normaliserSiteWeb(v: string): string | null {
  const brut = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  let u: URL;
  try { u = new URL(brut); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || u.username || u.password) return null;
  return u.toString().replace(/\/$/, "");
}
const siteWeb = texte(200).transform((v, ctx) => {
  if (v == null) return v;
  const n = normaliserSiteWeb(v);
  if (!n) { ctx.addIssue({ code: "custom", message: "Adresse du site web invalide (exemple : www.monentreprise.cm)." }); return z.NEVER; }
  return n;
});
const COULEUR = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur au format #RRGGBB.");

export const SCHEMA_PROFIL = z.object({
  // Identité
  raisonSociale: z.string().trim().min(2, "La raison sociale est obligatoire (2 caractères au moins).").max(200).optional(),
  nomCommercial: texte(120), sigle: texte(30), slogan: texte(150), formeJuridique: texte(60),
  capitalSocial: z.number().int().min(0).max(1e15).nullable().optional(),
  dateCreation: z.string().date("Date de création invalide.").nullable().optional()
    .refine((d) => !d || d <= new Date().toISOString().slice(0, 10), "La date de création ne peut pas être dans le futur."),
  // Coordonnées
  adresse: texte(300), boitePostale: texte(30), quartier: texte(80), commune: texte(80), ville: texte(80), region: texte(80),
  telephone, telephone2: telephone,
  email: z.string().trim().max(254).nullable().optional().transform((v) => (v === undefined ? undefined : v || null))
    .refine((v) => v == null || z.string().email().safeParse(v).success, "Adresse e-mail invalide (exemple : contact@monentreprise.cm)."),
  siteWeb,
  // Juridique et fiscal
  rccm: texte(60),        // Registre du commerce et du crédit mobilier (OHADA)
  niu: texte(30),         // Numéro d'identifiant unique (administration fiscale)
  numeroContribuable: texte(40), numeroTva: texte(40),
  autresIdentifiants: z.array(z.object({ libelle: z.string().trim().min(1, "Libellé de l'identifiant manquant.").max(40), valeur: z.string().trim().min(1, "Valeur de l'identifiant manquante.").max(60) }))
    .max(4, "Quatre autres identifiants au plus.").optional(),
  regimeFiscal: texte(80), patente: texte(60),
  referentiel: z.enum(Object.keys(REFERENTIELS) as [string, ...string[]]).nullable().optional(),
  // Banque et paiement (facultatif)
  banque: z.object({ nom: texte(100), titulaire: texte(120), references: texte(80) }).nullable().optional(),
  moyensPaiement: z.array(z.enum(Object.keys(MOYENS_PAIEMENT) as [string, ...string[]])).max(5).optional(),
  // Documents
  enTete: texte(200), piedDePage: texte(300),
  formatPapier: z.enum(FORMATS_PAPIER).optional(),
  affichage: z.object(Object.fromEntries(Object.keys(AFFICHAGE_DEFAUT).map((k) => [k, z.boolean().optional()])) as Record<keyof Affichage, z.ZodOptional<z.ZodBoolean>>).optional(),
  couleurs: z.object({ principale: COULEUR, accent: COULEUR }).optional(),
});
export type ModifProfil = z.infer<typeof SCHEMA_PROFIL>;

/** Champs stockés dans companies.settings.profil (les autres sont des colonnes). */
export const CHAMPS_JSON = ["nomCommercial", "sigle", "slogan", "formeJuridique", "capitalSocial", "dateCreation", "boitePostale", "quartier", "commune",
  "ville", "region", "telephone2", "email", "siteWeb", "numeroContribuable", "numeroTva", "autresIdentifiants", "regimeFiscal", "patente", "referentiel",
  "banque", "moyensPaiement", "enTete", "piedDePage", "formatPapier", "affichage", "couleurs"] as const;

/**
 * Contrôles de cohérence avec le reste du dossier (le schéma ne voit qu'un champ à la fois).
 * Renvoie un message clair, ou null si tout est cohérent.
 */
// Pas de contrôle « numéro de TVA / TVA appliquée » ici : une officine peut être assujettie pour une partie
// seulement de ses produits ; les taux se règlent dans les paramètres de la pharmacie.
export function incoherence(profil: ReturnType<typeof profilDe>): string | null {
  if (profil.banque && !profil.banque.nom) return "Indiquez le nom de la banque.";
  return null;
}

/* ------------------------------------------------------------------ Identité imprimée */

/**
 * Identité de l'entreprise telle qu'elle s'imprime sur un document. Les options d'affichage sont déjà appliquées :
 * le document figé reste identique même si ces options changent ensuite. Aucun champ vide ni valeur inventée.
 */
export interface IdentiteDocument {
  raisonSociale: string; nomCommercial?: string | null; sigle?: string | null; slogan?: string | null;
  formeJuridique?: string | null; capitalSocial?: number | null; devise?: string;
  adresse?: string | null; boitePostale?: string | null; localite?: string | null; region?: string | null; pays?: string | null;
  telephone?: string | null; email?: string | null; siteWeb?: string | null;
  niu?: string | null; rccm?: string | null; numeroContribuable?: string | null; numeroTva?: string | null;
  autresIdentifiants?: { libelle: string; valeur: string }[]; regimeFiscal?: string | null; patente?: string | null;
  enTete?: string | null; piedDePage?: string | null; banque?: Banque | null; moyensPaiement?: string[];
  couleurs?: { principale: string; accent: string }; logoId?: string | null; cachetId?: string | null; formatPapier?: string;
}

export function identiteDocument(e: Record<string, any>): IdentiteDocument {
  const p = profilDe(e.settings), aff = p.affichage;
  const tels = [e.phone, p.telephone2].filter(Boolean).join(" / ") || null;
  return {
    raisonSociale: e.legal_name, nomCommercial: p.nomCommercial, sigle: p.sigle, slogan: aff.slogan ? p.slogan : null,
    formeJuridique: p.formeJuridique, capitalSocial: p.capitalSocial, devise: e.currency_code,
    adresse: e.address, boitePostale: p.boitePostale, localite: [p.quartier, p.commune, p.ville].filter(Boolean).join(", ") || null,
    region: p.region, pays: PAYS_OHADA[e.country_code] ?? e.country_code ?? null,
    telephone: aff.telephone ? tels : null, email: aff.email ? p.email : null, siteWeb: aff.siteWeb ? p.siteWeb : null,
    niu: e.niu, rccm: e.rccm, numeroContribuable: p.numeroContribuable, numeroTva: p.numeroTva, autresIdentifiants: p.autresIdentifiants,
    regimeFiscal: p.regimeFiscal, patente: p.patente, enTete: p.enTete, piedDePage: p.piedDePage,
    banque: aff.banque ? p.banque : null, moyensPaiement: aff.moyensPaiement ? p.moyensPaiement.map((m) => MOYENS_PAIEMENT[m]) : [],
    couleurs: p.couleurs, logoId: p.logoId, cachetId: aff.cachet ? p.cachetId : null, formatPapier: p.formatPapier,
  };
}

/** Identité actuelle de l'entreprise active (pour un nouveau document). */
export async function identiteActuelle(c: Client, entrepriseId: string): Promise<IdentiteDocument> {
  const { rows: [e] } = await c.query("SELECT legal_name, address, phone, niu, rccm, country_code, currency_code, settings FROM companies WHERE id = $1", [entrepriseId]);
  return identiteDocument(e);
}

/** Identité figée d'un document, avec l'adresse de ses images (logo, cachet) pour l'aperçu à l'écran. */
export const avecUrls = (v: Record<string, any> | null) => ({ ...(v as IdentiteDocument),
  logoUrl: v?.logoId ? `/api/entreprise/logos/${v.logoId}` : null, cachetUrl: v?.cachetId ? `/api/entreprise/logos/${v.cachetId}` : null });

/** Recalcule l'identité mémorisée (copiée dans les reçus par le déclencheur de la migration 008). À appeler après toute modification du profil. */
export async function memoriserIdentite(c: Client, entrepriseId: string) {
  await c.query("UPDATE companies SET settings = jsonb_set(settings, '{identiteDocument}', $2::jsonb) WHERE id = $1",
    [entrepriseId, JSON.stringify(await identiteActuelle(c, entrepriseId))]);
}

const fmtEntier = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, " ");
const siteAffiche = (s: string) => s.replace(/^https?:\/\//, "");
export const deviseTexte = (d?: string) => (d === "XAF" || d === "XOF" || !d ? "FCFA" : d);

/**
 * Lignes de l'en-tête et du pied d'un document, dans l'ordre d'impression. Même logique que
 * interface/src/composants/IdentiteEntreprise.tsx (aperçu à l'écran) : les deux doivent rester alignés.
 * Fonctionne aussi avec les identités figées par les versions précédentes (moins de champs).
 */
export function lignesIdentite(v: IdentiteDocument) {
  const sousTitre = [v.sigle !== v.raisonSociale && v.sigle, v.nomCommercial !== v.raisonSociale && v.nomCommercial].filter(Boolean).join(" · ") || null;
  const forme = v.formeJuridique
    ? `${v.formeJuridique}${v.capitalSocial ? ` au capital de ${fmtEntier(v.capitalSocial)} ${deviseTexte(v.devise)}` : ""}`
    : v.capitalSocial ? `Capital social : ${fmtEntier(v.capitalSocial)} ${deviseTexte(v.devise)}` : null;
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

/** En-tête court des états comptables et rapports (nom, identifiants, ville) : pas de logo ni de coordonnées complètes. */
export function enteteEtat(v: IdentiteDocument) {
  return {
    raisonSociale: v.raisonSociale, sousTitre: lignesIdentite(v).sousTitre,
    lignes: [[v.adresse, v.localite, v.pays].filter(Boolean).join(" · ") || null, [v.niu && `NIU : ${v.niu}`, v.rccm && `RCCM : ${v.rccm}`].filter(Boolean).join(" · ") || null]
      .filter((l): l is string => !!l),
  };
}
