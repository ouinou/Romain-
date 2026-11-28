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

export const MODULES: Module[] = [
  { id: "accueil", libelle: "Accueil", icone: "accueil", entrees: [
    { chemin: "/", libelle: "Tableau de bord" },
    { chemin: "/mon-compte", libelle: "Mon compte" },
  ] },
  { id: "catalogue", libelle: "Catalogue", icone: "produit", entrees: [
    { chemin: "/catalogue", libelle: "Produits", permission: "catalog.read" },
    { chemin: "/catalogue/nouveau", libelle: "Nouveau produit", permission: "catalog.create" },
    { chemin: "/catalogue/import", libelle: "Importer un catalogue", permission: "catalog.create" },
    { chemin: "/catalogue/referentiels", libelle: "Catégories et référentiels", permission: "catalog.read" },
  ] },
  { id: "stock", libelle: "Stock", icone: "stock", entrees: [
    { chemin: "/stock", libelle: "Lots en stock", permission: "stock.read" },
    { chemin: "/stock/entree", libelle: "Entrée de stock", permission: "stock.create" },
    { chemin: "/stock/mouvements", libelle: "Mouvements", permission: "stock.read" },
    { chemin: "/stock/inventaires", libelle: "Inventaires", permission: "stock.read" },
    { chemin: "/stock/alertes", libelle: "Alertes", permission: "stock.read" },
  ] },
  { id: "administration", libelle: "Administration", icone: "administration", entrees: [
    { chemin: "/utilisateurs", libelle: "Utilisateurs", permission: "users.read" },
    { chemin: "/roles", libelle: "Rôles et permissions", permission: "roles.read" },
    { chemin: "/journal", libelle: "Journal d'audit", permission: "audit.read" },
    { chemin: "/entreprise", libelle: "Pharmacie", permission: "company.read" },
  ] },
];

/** Module auquel appartient un écran (pour ouvrir le bon onglet du ruban et le bon groupe du menu). */
export function moduleDe(route: string): string {
  if (route.startsWith("/catalogue")) return "catalogue";
  if (route.startsWith("/stock")) return "stock";
  if (/^\/(utilisateurs|roles|journal|entreprise)/.test(route)) return "administration";
  return "accueil";
}

const c = (id: string, libelle: string, icone: string, chemin: string, permission?: Permission, raccourci?: string): Commande =>
  ({ id, libelle, icone, chemin, permission, raccourci });

const NOUVEAU_PRODUIT = c("nouveau-produit", "Nouveau produit", "nouveau", "/catalogue/nouveau", "catalog.create", "Alt+N");
const PRODUITS = c("produits", "Produits", "produit", "/catalogue", "catalog.read", "Alt+P");
const IMPORT = c("import", "Importer", "importer", "/catalogue/import", "catalog.create");
const REFERENTIELS = c("referentiels", "Catégories", "categories", "/catalogue/referentiels", "catalog.read");
const ENTREE = c("entree", "Entrée de stock", "lot", "/stock/entree", "stock.create", "Alt+E");
const LOTS = c("lots", "Lots en stock", "stock", "/stock", "stock.read", "Alt+L");
const MOUVEMENTS = c("mouvements", "Mouvements", "mouvements", "/stock/mouvements", "stock.read", "Alt+M");
const INVENTAIRES = c("inventaires", "Inventaires", "inventaire", "/stock/inventaires", "stock.read", "Alt+I");
const ALERTES = c("alertes", "Alertes", "alerte", "/stock/alertes", "stock.read", "Alt+A");
const IMPRIMER: Commande = { id: "imprimer", libelle: "Imprimer la page", icone: "imprimer", action: "imprimer", raccourci: "Ctrl+P" };

export const RUBAN: Record<string, Groupe[]> = {
  accueil: [
    { nom: "Catalogue", commandes: [PRODUITS, NOUVEAU_PRODUIT] },
    { nom: "Stock", commandes: [ENTREE, LOTS, ALERTES] },
    { nom: "Système", commandes: [
      c("utilisateurs", "Utilisateurs", "utilisateurs", "/utilisateurs", "users.read"),
      c("pharmacie", "Pharmacie", "entreprise", "/entreprise", "company.read"),
      { id: "aide", libelle: "Aide", icone: "aide", action: "aide", raccourci: "F1" },
      { id: "quitter", libelle: "Déconnexion", icone: "quitter", action: "deconnexion" },
    ] },
  ],
  catalogue: [
    { nom: "Produits", commandes: [PRODUITS, NOUVEAU_PRODUIT, IMPORT] },
    { nom: "Classement", commandes: [REFERENTIELS] },
    { nom: "Impression", commandes: [IMPRIMER] },
  ],
  stock: [
    { nom: "Entrées", commandes: [ENTREE] },
    { nom: "Suivi", commandes: [LOTS, MOUVEMENTS, ALERTES] },
    { nom: "Contrôle", commandes: [INVENTAIRES, IMPRIMER] },
  ],
  administration: [
    { nom: "Utilisateurs", commandes: [
      c("utilisateurs-adm", "Utilisateurs", "utilisateurs", "/utilisateurs", "users.read"),
      c("nouvel-utilisateur", "Nouvel utilisateur", "nouvelutilisateur", "/utilisateurs?nouveau=1", "users.create"),
      c("roles", "Rôles et permissions", "roles", "/roles", "roles.read"),
    ] },
    { nom: "Pharmacie", commandes: [
      c("profil", "Profil et paramètres", "entreprise", "/entreprise", "company.read"),
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
