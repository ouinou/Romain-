/** Libellés en français des codes techniques renvoyés par le serveur. */
export const STATUTS: Record<string, string> = { invited: "Invité", active: "Actif", disabled: "Désactivé" };

export const RESULTATS: Record<string, string> = { success: "Réussi", denied: "Refusé", failure: "Échec" };

export const TYPES_EVENEMENT: Record<string, string> = {
  auth: "Authentification", users: "Utilisateurs", roles: "Rôles", company: "Entreprise", security: "Sécurité", audit: "Journal", backups: "Sauvegardes",
  accounting: "Comptabilité",
};

const ACTIONS: Record<string, string> = {
  "auth.login": "Connexion", "auth.logout": "Déconnexion", "auth.password_change": "Changement de mot de passe",
  "auth.invitation_accept": "Activation du compte (invitation)", "auth.password_reset": "Réinitialisation du mot de passe",
  "auth.session_revoke": "Fermeture d'une session", "auth.step_up": "Confirmation par mot de passe",
  "users.create": "Création d'un compte", "users.invite": "Invitation", "users.invite_renew": "Nouveau code d'invitation",
  "users.update": "Modification d'un compte", "users.disable": "Désactivation d'un compte", "users.enable": "Réactivation d'un compte",
  "users.password_reset_issue": "Code de réinitialisation délivré", "users.auto_disable_inactive": "Désactivation automatique (compte inutilisé)",
  "roles.create": "Création d'un rôle", "roles.update": "Modification d'un rôle", "roles.permissions_change": "Changement de permissions",
  "roles.assign": "Attribution de rôles", "roles.archive": "Archivage d'un rôle",
  "company.create": "Création de l'entreprise", "company.update": "Modification de l'entreprise",
  "security.access_denied": "Accès refusé", "security.account_locked": "Compte verrouillé", "security.account_unlock": "Compte déverrouillé",
  "security.unusual_login": "Connexion inhabituelle", "security.mfa_enable": "Double authentification activée",
  "security.sessions_revoke": "Fermeture des sessions", "security.self_change_denied": "Modification de ses propres droits refusée",
  "security.audit_tamper_attempt": "Tentative de modification du journal", "security.security_settings_change": "Paramètres de sécurité modifiés",
  "security.master_code_recovery": "Récupération par code maître", "security.master_code_regenerate": "Nouveau code maître",
  "audit.verify": "Vérification d'intégrité du journal", "audit.export": "Export du journal",
  "accounting.entry_create": "Saisie d'une écriture (brouillard)", "accounting.entry_update": "Modification d'un brouillard",
  "accounting.entry_delete": "Suppression d'un brouillard", "accounting.entry_validate": "Validation d'une écriture",
  "accounting.entry_reverse": "Extourne d'une écriture", "accounting.export": "Export d'un état comptable",
  "accounting.account_create": "Création d'un compte", "accounting.account_update": "Modification d'un compte",
  "accounting.accounts_import": "Import du plan comptable", "accounting.journal_create": "Création d'un journal",
  "accounting.journal_update": "Modification d'un journal", "accounting.fiscal_year_create": "Création d'un exercice",
  "accounting.fiscal_year_close": "Clôture d'un exercice", "security.accounting_settings_change": "Paramètres comptables modifiés",
  "security.protected_accounts_change": "Comptes protégés modifiés",
};
export const libelleAction = (type: string, action: string, resultat?: string) =>
  (ACTIONS[`${type}.${action}`] ?? `${TYPES_EVENEMENT[type] ?? type} : ${action}`) +
  (resultat === "failure" ? " (échec)" : resultat === "denied" ? " (refusée)" : "");

export const MODULES: Record<string, string> = {
  users: "Utilisateurs", roles: "Rôles", audit: "Journal d'audit", company: "Entreprise", backups: "Sauvegardes",
  accounting: "Comptabilité", treasury: "Trésorerie", cash: "Caisse", sales: "Ventes", purchases: "Achats", stock: "Stocks",
  hr: "Ressources humaines", payroll: "Paie", reports: "Rapports",
};
export const ACTIONS_PERM: Record<string, string> = {
  read: "consulter", create: "créer", update: "modifier", submit: "soumettre", approve: "valider", cancel: "annuler",
  archive: "archiver", print: "imprimer", export: "exporter", admin: "administrer",
};

/** Remplace récursivement les clés de permission (« cash.approve ») par leur libellé (« Caisse : valider »). */
export function traduireValeur(v: unknown): unknown {
  if (typeof v === "string") {
    const m = /^([a-z_]+)\.([a-z_]+)$/.exec(v);
    return m && MODULES[m[1]] && ACTIONS_PERM[m[2]] ? `${MODULES[m[1]]} : ${ACTIONS_PERM[m[2]]}` : v;
  }
  if (Array.isArray(v)) return v.map(traduireValeur);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, traduireValeur(x)]));
  return v;
}
