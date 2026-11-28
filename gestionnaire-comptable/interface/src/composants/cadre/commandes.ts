/**
 * Modules (menu latéral et onglets du ruban) et commandes du ruban.
 * Chaque commande mène à un écran ou à une action qui existe réellement ; aucune commande décorative.
 * Une commande dont la permission manque n'est pas affichée (le serveur refuse de toute façon l'opération).
 */
export type Permission = string | string[];

export interface Entree { chemin: string; libelle: string; permission?: Permission }
export interface Module { id: string; libelle: string; icone: string; entrees: Entree[] }
export interface Commande {
  id: string; libelle: string; icone: string; permission?: Permission;
  /** Écran à ouvrir (fragment d'URL, éventuellement avec ?action=…). */
  chemin?: string;
  /** Action sans changement d'écran. */
  action?: "imprimer" | "deconnexion" | "aide";
  /** Raccourci clavier affiché sous la commande, et reconnu partout dans le logiciel. */
  raccourci?: string;
}
export interface Groupe { nom: string; commandes: Commande[] }

const TRESO: Permission = ["treasury.read", "cash.read"];
const SAISIE_TRESO: Permission = ["treasury.create", "cash.create"];

export const MODULES: Module[] = [
  { id: "accueil", libelle: "Accueil", icone: "accueil", entrees: [
    { chemin: "/", libelle: "Tableau de bord" },
    { chemin: "/mon-compte", libelle: "Mon compte" },
  ] },
  { id: "ventes", libelle: "Ventes", icone: "ventes", entrees: [
    { chemin: "/ventes/nouvelle", libelle: "Nouvelle vente", permission: "sales.create" },
    { chemin: "/ventes", libelle: "Ventes et factures", permission: "sales.read" },
    { chemin: "/ventes/avoirs", libelle: "Avoirs", permission: "sales.read" },
    { chemin: "/ventes/direct", libelle: "Ventes en direct", permission: "sales.read" },
    { chemin: "/ventes/verifier", libelle: "Vérifier une facture", permission: "sales.read" },
    { chemin: "/ventes/clients", libelle: "Clients", permission: "sales.read" },
  ] },
  { id: "tresorerie", libelle: "Trésorerie", icone: "tresorerie", entrees: [
    { chemin: "/tresorerie", libelle: "Caisses et banques", permission: TRESO },
    { chemin: "/tresorerie/mouvements", libelle: "Mouvements", permission: TRESO },
  ] },
  { id: "comptabilite", libelle: "Comptabilité", icone: "comptabilite", entrees: [
    { chemin: "/comptabilite", libelle: "Tableau comptable", permission: "accounting.read" },
    { chemin: "/comptabilite/ecritures", libelle: "Écritures", permission: "accounting.read" },
    { chemin: "/comptabilite/plan", libelle: "Plan comptable", permission: "accounting.read" },
    { chemin: "/comptabilite/journaux", libelle: "Journaux", permission: "accounting.read" },
    { chemin: "/comptabilite/parametres", libelle: "Exercices et paramètres", permission: "accounting.read" },
  ] },
  { id: "etats", libelle: "États", icone: "etats", entrees: [
    { chemin: "/comptabilite/balance", libelle: "Balance générale", permission: "accounting.read" },
    { chemin: "/comptabilite/grand-livre", libelle: "Grand livre", permission: "accounting.read" },
  ] },
  { id: "administration", libelle: "Administration", icone: "administration", entrees: [
    { chemin: "/utilisateurs", libelle: "Utilisateurs", permission: "users.read" },
    { chemin: "/roles", libelle: "Rôles et permissions", permission: "roles.read" },
    { chemin: "/journal", libelle: "Journal d'audit", permission: "audit.read" },
    { chemin: "/entreprise", libelle: "Entreprise", permission: "company.read" },
  ] },
];

/** Module auquel appartient un écran (pour ouvrir le bon onglet du ruban et le bon groupe du menu). */
export function moduleDe(route: string): string {
  if (route.startsWith("/ventes")) return "ventes";
  if (route.startsWith("/tresorerie")) return "tresorerie";
  if (route.startsWith("/comptabilite/balance") || route.startsWith("/comptabilite/grand-livre")) return "etats";
  if (route.startsWith("/comptabilite")) return "comptabilite";
  if (/^\/(utilisateurs|roles|journal|entreprise)/.test(route)) return "administration";
  return "accueil";
}

const c = (id: string, libelle: string, icone: string, chemin: string, permission?: Permission, raccourci?: string): Commande =>
  ({ id, libelle, icone, chemin, permission, raccourci });

const NOUVELLE_FACTURE = c("nouvelle-facture", "Nouvelle facture", "facture", "/ventes/nouvelle", "sales.create", "Alt+N");
const NOUVEAU_CLIENT = c("nouveau-client", "Nouveau client", "client", "/ventes/clients?nouveau=1", "sales.create");
const REGLEMENT = c("reglement", "Règlement", "reglement", "/tresorerie?action=entree", SAISIE_TRESO, "Alt+R");
const DEPENSE = c("depense", "Dépense", "depense", "/tresorerie?action=sortie", SAISIE_TRESO, "Alt+D");
const TRANSFERT = c("transfert", "Transfert", "transfert", "/tresorerie?action=transfert", SAISIE_TRESO, "Alt+T");
const SAISIE = c("saisie", "Saisie d'écriture", "saisie", "/comptabilite/ecritures/nouvelle", "accounting.create", "Alt+E");
const BROUILLARDS = c("brouillards", "Brouillards à valider", "valider", "/comptabilite/ecritures?statut=brouillard", "accounting.approve");
const BALANCE = c("balance", "Balance", "balance", "/comptabilite/balance", "accounting.read", "Alt+B");
const GRAND_LIVRE = c("grand-livre", "Grand livre", "grandlivre", "/comptabilite/grand-livre", "accounting.read", "Alt+G");
const DIRECT = c("direct", "Ventes en direct", "direct", "/ventes/direct", "sales.read", "Alt+L");
const VERIFIER = c("verifier", "Vérifier une facture", "verifier", "/ventes/verifier", "sales.read", "Alt+V");
const IMPRIMER: Commande = { id: "imprimer", libelle: "Imprimer la page", icone: "imprimer", action: "imprimer", raccourci: "Ctrl+P" };

export const RUBAN: Record<string, Groupe[]> = {
  accueil: [
    { nom: "Ventes", commandes: [NOUVELLE_FACTURE, NOUVEAU_CLIENT, REGLEMENT] },
    { nom: "Comptabilité", commandes: [SAISIE, BROUILLARDS] },
    { nom: "États", commandes: [BALANCE, GRAND_LIVRE, DIRECT] },
    { nom: "Système", commandes: [
      c("utilisateurs", "Utilisateurs", "utilisateurs", "/utilisateurs", "users.read"),
      c("entreprise", "Profil de l'entreprise", "entreprise", "/entreprise", "company.read"),
      { id: "aide", libelle: "Aide", icone: "aide", action: "aide", raccourci: "F1" },
      { id: "quitter", libelle: "Déconnexion", icone: "quitter", action: "deconnexion" },
    ] },
  ],
  ventes: [
    { nom: "Nouveau", commandes: [NOUVELLE_FACTURE, NOUVEAU_CLIENT] },
    { nom: "Suivi", commandes: [
      c("factures", "Factures", "ecritures", "/ventes", "sales.read"), c("avoirs", "Avoirs", "avoir", "/ventes/avoirs", "sales.read"), DIRECT,
      c("clients", "Clients", "clients", "/ventes/clients", "sales.read"),
    ] },
    { nom: "Encaissement", commandes: [REGLEMENT] },
    { nom: "Contrôle", commandes: [VERIFIER, IMPRIMER] },
  ],
  tresorerie: [
    { nom: "Opérations", commandes: [REGLEMENT, DEPENSE, TRANSFERT] },
    { nom: "Consultation", commandes: [
      c("caisses", "Caisses et banques", "caisse", "/tresorerie", TRESO),
      c("mouvements", "Mouvements", "mouvements", "/tresorerie/mouvements", TRESO),
    ] },
    { nom: "Impression", commandes: [IMPRIMER] },
  ],
  comptabilite: [
    { nom: "Écritures", commandes: [SAISIE, c("ecritures", "Écritures", "ecritures", "/comptabilite/ecritures", "accounting.read"), BROUILLARDS] },
    { nom: "Référentiel", commandes: [
      c("plan", "Plan comptable", "plan", "/comptabilite/plan", "accounting.read"),
      c("journaux", "Journaux", "journaux", "/comptabilite/journaux", "accounting.read"),
      c("exercices", "Exercices et paramètres", "parametres", "/comptabilite/parametres", "accounting.read"),
    ] },
    { nom: "Consultation", commandes: [BALANCE, GRAND_LIVRE] },
  ],
  etats: [
    { nom: "Comptables", commandes: [BALANCE, GRAND_LIVRE, c("tableau-comptable", "Tableau comptable", "comptabilite", "/comptabilite", "accounting.read")] },
    { nom: "Ventes", commandes: [DIRECT, c("factures-etat", "Factures", "ecritures", "/ventes", "sales.read")] },
    { nom: "Contrôle", commandes: [c("audit-etat", "Journal d'audit", "audit", "/journal", "audit.read"), IMPRIMER] },
  ],
  administration: [
    { nom: "Utilisateurs", commandes: [
      c("utilisateurs-adm", "Utilisateurs", "utilisateurs", "/utilisateurs", "users.read"),
      c("nouvel-utilisateur", "Nouvel utilisateur", "nouvelutilisateur", "/utilisateurs?nouveau=1", "users.create"),
      c("roles", "Rôles et permissions", "roles", "/roles", "roles.read"),
    ] },
    { nom: "Entreprise", commandes: [
      c("profil", "Profil de l'entreprise", "entreprise", "/entreprise", "company.read"),
      c("journal-audit", "Journal d'audit", "audit", "/journal", "audit.read"),
    ] },
    { nom: "Compte", commandes: [c("mon-compte", "Mon compte", "compte", "/mon-compte")] },
  ],
};

export const autorise = (a: (p: string) => boolean, p?: Permission) => !p || [p].flat().some(a);

/** Toutes les commandes accessibles, sans doublon (recherche, raccourcis clavier). */
export function toutesCommandes(a: (p: string) => boolean): Commande[] {
  const vues = new Map<string, Commande>();
  for (const groupes of Object.values(RUBAN)) for (const g of groupes) for (const cmd of g.commandes)
    if (autorise(a, cmd.permission) && !vues.has(cmd.libelle)) vues.set(cmd.libelle, cmd);
  return [...vues.values()];
}
