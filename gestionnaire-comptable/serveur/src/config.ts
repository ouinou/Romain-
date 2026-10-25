import { readFileSync } from "node:fs";

/** Configuration lue dans les variables d'environnement (voir .env.exemple). */
export interface Config {
  port: number;
  hote: string;
  baseDeDonnees: string;
  /** Clé AES-256 (32 octets, base64) pour chiffrer les secrets MFA. */
  cleChiffrement: Buffer;
  sessionInactiviteMinutes: number;
  sessionDureeMaxHeures: number;
  cookieSecurise: boolean;
  tls?: { cert: Buffer; key: Buffer };
  /** Durée de validité d'une confirmation par mot de passe avant une opération sensible. */
  confirmationMinutes: number;
  echecsAvantVerrouillage: number;
  verrouillageMinutes: number;
  tentativesParIpParFenetre: number;
  fenetreTentativesMinutes: number;
}

function entier(nom: string, defaut: number): number {
  const v = process.env[nom];
  if (v === undefined || v === "") return defaut;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${nom} doit être un entier positif (reçu : ${v}).`);
  return n;
}

export function chargerConfig(): Config {
  const base = process.env.GC_BASE_DE_DONNEES;
  if (!base) throw new Error("GC_BASE_DE_DONNEES manque (ex. postgres://gc_app:motdepasse@localhost:5432/gestionnaire_comptable).");
  const cle = Buffer.from(process.env.GC_CLE_CHIFFREMENT ?? "", "base64");
  if (cle.length !== 32) throw new Error("GC_CLE_CHIFFREMENT doit contenir 32 octets encodés en base64 (générer avec : node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\").");
  const cert = process.env.GC_TLS_CERTIFICAT, key = process.env.GC_TLS_CLE;
  const tls = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined;
  return {
    port: entier("GC_PORT", 8443),
    hote: process.env.GC_HOTE ?? "0.0.0.0",
    baseDeDonnees: base,
    cleChiffrement: cle,
    sessionInactiviteMinutes: entier("GC_SESSION_INACTIVITE_MINUTES", 15),
    sessionDureeMaxHeures: entier("GC_SESSION_DUREE_MAX_HEURES", 10),
    cookieSecurise: tls !== undefined || process.env.GC_COOKIE_SECURISE === "oui",
    tls,
    confirmationMinutes: entier("GC_CONFIRMATION_MINUTES", 5),
    echecsAvantVerrouillage: entier("GC_ECHECS_AVANT_VERROUILLAGE", 5),
    verrouillageMinutes: entier("GC_VERROUILLAGE_MINUTES", 15),
    tentativesParIpParFenetre: entier("GC_TENTATIVES_PAR_IP", 30),
    fenetreTentativesMinutes: entier("GC_FENETRE_TENTATIVES_MINUTES", 10),
  };
}
