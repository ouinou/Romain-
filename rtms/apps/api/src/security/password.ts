import argon2 from 'argon2';

// Paramètres OWASP 2024+ pour Argon2id
const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (p: string) => argon2.hash(p, OPTS);
export const verifyPassword = (hash: string, p: string) => argon2.verify(hash, p).catch(() => false);

// Empreinte factice : même coût de calcul quand le compte n'existe pas (anti-énumération)
let dummy: string | undefined;
export async function burnDummyVerify(p: string) {
  dummy ??= await hashPassword('rtms-dummy-password-for-timing');
  await verifyPassword(dummy, p);
}

const COMMON = new Set(['password', 'motdepasse', 'azerty', 'qwerty', '123456', 'admin', 'raha', 'rahatransport', 'transport']);

export function passwordProblems(p: string, email = ''): string[] {
  const out: string[] = [];
  if (p.length < 12) out.push('12 caractères minimum');
  if (p.length > 128) out.push('128 caractères maximum');
  const lower = p.toLowerCase();
  if ([...COMMON].some((w) => lower.includes(w)) && p.length < 20) out.push('contient un mot trop courant');
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) out.push('ne doit pas contenir l’identifiant');
  if (new Set(p).size < 5) out.push('trop peu de caractères différents');
  return out;
}
