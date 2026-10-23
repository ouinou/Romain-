/**
 * Accès à l'API du serveur. Toutes les données viennent du serveur ; rien de confidentiel n'est
 * conservé dans le navigateur (pas de localStorage pour les données, cookie de session HttpOnly).
 */
export class ApiErreur extends Error {
  constructor(public statut: number, public code: string, message: string, public champs?: { champ: string; message: string }[]) {
    super(message);
  }
}

type Transport = (methode: string, url: string, corps?: unknown, automatique?: boolean) => Promise<Response>;

const transportReseau: Transport = (methode, url, corps, automatique) =>
  fetch(url, {
    method: methode,
    credentials: "same-origin",
    headers: {
      ...(corps !== undefined ? { "content-type": "application/json" } : {}),
      ...(methode !== "GET" ? { "x-gc-requete": "1" } : {}),
      // Rafraîchissement sans action de l'utilisateur : ne prolonge pas la session (voir validerSession côté serveur).
      ...(automatique ? { "x-gc-automatique": "1" } : {}),
    },
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });

let transport: Transport = transportReseau;
export const definirTransport = (t: Transport) => { transport = t; };

/** Appelé quand le serveur exige une confirmation par mot de passe : doit résoudre à true si confirmée. */
let demanderConfirmation: (() => Promise<boolean>) | null = null;
export const surConfirmationRequise = (f: () => Promise<boolean>) => { demanderConfirmation = f; };

/** Appelé quand la session n'est plus valide (expirée, révoquée). */
let sessionPerdue: ((message: string) => void) | null = null;
export const surSessionPerdue = (f: (message: string) => void) => { sessionPerdue = f; };

async function lire(r: Response) {
  const type = r.headers.get("content-type") ?? "";
  return type.includes("application/json") ? r.json() : r.text();
}

export async function appel<T = any>(methode: string, url: string, corps?: unknown, essai = 0, automatique = false): Promise<T> {
  let r: Response;
  try {
    r = await transport(methode, url, corps, automatique);
  } catch {
    throw new ApiErreur(0, "reseau", "Le serveur ne répond pas. Vérifiez que le poste est bien connecté au réseau de l'entreprise.");
  }
  const contenu = await lire(r);
  if (r.ok) return contenu as T;
  const e = (contenu as { erreur?: { code: string; message: string; champs?: { champ: string; message: string }[] } })?.erreur;
  const err = new ApiErreur(r.status, e?.code ?? "inconnue", e?.message ?? `Erreur ${r.status}.`, e?.champs);
  if (err.code === "confirmation_requise" && essai === 0 && demanderConfirmation) {
    if (await demanderConfirmation()) return appel<T>(methode, url, corps, 1);
    throw new ApiErreur(403, "annulee", "Opération annulée.");
  }
  if (r.status === 401 && ["session_invalide", "non_authentifie"].includes(err.code) && !url.startsWith("/api/auth/connexion"))
    sessionPerdue?.(err.message);
  throw err;
}

export const api = {
  get: <T = any>(url: string) => appel<T>("GET", url),
  /** Lecture déclenchée par une minuterie, pas par l'utilisateur. */
  getAuto: <T = any>(url: string) => appel<T>("GET", url, undefined, 0, true),
  post: <T = any>(url: string, corps: unknown = {}) => appel<T>("POST", url, corps),
  put: <T = any>(url: string, corps: unknown) => appel<T>("PUT", url, corps),
  patch: <T = any>(url: string, corps: unknown) => appel<T>("PATCH", url, corps),
  del: <T = any>(url: string) => appel<T>("DELETE", url),
};

/** Téléchargement d'un fichier produit par le serveur (export CSV), avec la même gestion de confirmation. */
export async function telecharger(url: string, nomParDefaut: string) {
  const texte = await appel<string>("GET", url);
  const blob = new Blob([texte], { type: "text/csv;charset=utf-8" });
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(blob);
  lien.download = nomParDefaut;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 2000);
  return texte;
}

/** Construit une chaîne de requête en ignorant les valeurs vides. */
export function qs(p: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? "?" + s : "";
}
