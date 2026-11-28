export interface Moi {
  utilisateur: { id: string; email: string; nom: string; mfaActive: boolean };
  entreprise: { id: string; code: string; raisonSociale: string; pays: string; devise: string };
  roles: { id: string; cle: string; libelle: string }[];
  permissions: string[];
  mfa: { active: boolean; requise: boolean };
  session: { id: string; inactiviteMinutes: number };
}

export interface RoleCourt { id: string; cle: string; libelle: string }

export interface Utilisateur {
  id: string; email: string; nom: string; statut: "invited" | "active" | "disabled"; verrouille: boolean;
  accesExpireLe: string | null; derniereConnexion: string | null; creeLe: string; mfaActive: boolean; roles: RoleCourt[];
}

export interface Role {
  id: string; cle: string; libelle: string; description: string | null; systeme: boolean; mfaRequise: boolean;
  archiveLe: string | null; permissions: string[]; utilisateurs: number;
}

export interface Evenement {
  sequence: number; id: string; date: string; type: string; action: string; resultat: "success" | "denied" | "failure";
  objetType: string | null; objetId: string | null; avant: unknown; apres: unknown; motif: string | null;
  details: Record<string, unknown>; ip: string | null; acteur: string | null; acteurId: string | null; empreinte: string;
}

export interface Page<T> { elements: T[]; total: number; page: number; taille: number }

export interface Notification { id: string; type: "info" | "warning" | "security"; titre: string; texte: string | null; date: string; lue: boolean }
