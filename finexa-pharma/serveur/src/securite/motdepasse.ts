import argon2 from "argon2";

/** Argon2id, paramètres minimaux recommandés par l'OWASP (19 Mio, 2 itérations, 1 fil). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hacherMotDePasse = (mdp: string) => argon2.hash(mdp, OPTIONS);

export async function verifierMotDePasse(hash: string | null, mdp: string): Promise<boolean> {
  // Sans hash (compte inconnu ou invité), on calcule quand même un hash factice :
  // le temps de réponse ne révèle pas si l'adresse existe.
  if (!hash) { await argon2.verify(await hashFactice(), mdp).catch(() => false); return false; }
  try { return await argon2.verify(hash, mdp); } catch { return false; }
}

let factice: Promise<string> | undefined;
const hashFactice = () => (factice ??= argon2.hash("compte-inexistant-" + Math.random(), OPTIONS));

/**
 * Politique : 12 caractères minimum, 128 maximum, sans reprendre l'e-mail ni le nom.
 * Pas de règle de composition imposée (recommandation NIST SP 800-63B) : la longueur compte davantage.
 */
export function politiqueMotDePasse(mdp: string, email?: string, nom?: string): string | null {
  if (mdp.length < 12) return "Le mot de passe doit contenir au moins 12 caractères.";
  if (mdp.length > 128) return "Le mot de passe ne doit pas dépasser 128 caractères.";
  const bas = mdp.toLowerCase();
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && bas.includes(local)) return "Le mot de passe ne doit pas contenir votre adresse e-mail.";
  for (const mot of (nom ?? "").toLowerCase().split(/\s+/)) if (mot.length >= 4 && bas.includes(mot)) return "Le mot de passe ne doit pas contenir votre nom.";
  if (/^(.)\1+$/.test(mdp)) return "Le mot de passe ne doit pas répéter un seul caractère.";
  return null;
}
