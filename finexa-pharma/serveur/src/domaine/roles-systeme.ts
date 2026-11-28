/**
 * Rôles créés pour chaque nouvelle officine. Leurs permissions ne sont pas modifiables par l'API :
 * pour adapter un profil, on crée un rôle personnalisé (éventuellement copié d'un rôle système).
 *
 * Principe : moindre privilège. Aucun rôle ne peut modifier ou supprimer le journal d'audit,
 * et l'administrateur ne reçoit aucun droit sur les données financières par défaut.
 */
type Action = "read" | "create" | "update" | "submit" | "approve" | "cancel" | "archive" | "print" | "export" | "admin";
const p = (module: string, ...actions: Action[]) => actions.map((a) => `${module}.${a}`);
const METIER = ["catalog", "stock", "purchases", "sales", "cash", "reports"];

export interface RoleSysteme { cle: string; libelle: string; description: string; mfa: boolean; permissions: string[] }

/** Rôles d'une officine (FINEXA PHARMA). Les achats, la caisse et les rapports arrivent aux lots suivants : leurs droits sont déjà prévus. */
export const ROLES_SYSTEME: RoleSysteme[] = [
  {
    cle: "company_admin", libelle: "Administrateur", mfa: true,
    description: "Comptes, rôles, paramètres et sauvegardes. Consulte le catalogue ; aucun mouvement de stock ni vente par défaut.",
    permissions: [
      ...p("users", "read", "create", "update", "archive", "admin"),
      ...p("roles", "read", "create", "update", "archive", "admin"),
      ...p("company", "read", "update", "admin"),
      ...p("audit", "read", "export"),
      ...p("backups", "read", "create"),
      ...p("catalog", "read"),
    ],
  },
  {
    cle: "pharmacist_owner", libelle: "Pharmacien titulaire", mfa: true,
    description: "Toute l'activité de l'officine : catalogue, lots, ajustements, inventaires, achats, ventes, rapports, paramètres.",
    permissions: [
      ...p("catalog", "read", "create", "update", "archive", "print", "export", "admin"),
      ...p("stock", "read", "create", "update", "approve", "cancel", "print", "export", "admin"),
      ...p("purchases", "read", "create", "update", "approve", "cancel", "print", "export"),
      ...p("sales", "read", "create", "cancel", "print", "export"),
      ...p("cash", "read", "create", "approve", "print"),
      ...p("reports", "read", "print", "export"),
      ...p("company", "read", "update"), ...p("users", "read"), ...p("audit", "read"),
    ],
  },
  {
    cle: "pharmacist_assistant", libelle: "Pharmacien adjoint", mfa: true,
    description: "Comme le titulaire, sans la gestion des comptes ni des paramètres de la pharmacie.",
    permissions: [
      ...p("catalog", "read", "create", "update", "archive", "print", "export"),
      ...p("stock", "read", "create", "update", "approve", "cancel", "print", "export"),
      ...p("purchases", "read", "create", "update", "approve", "print"),
      ...p("sales", "read", "create", "cancel", "print"),
      ...p("cash", "read", "create", "approve", "print"),
      ...p("reports", "read", "print", "export"), ...p("company", "read"),
    ],
  },
  {
    cle: "seller", libelle: "Préparateur / vendeur", mfa: false,
    description: "Vend et consulte le catalogue, les lots et le stock. Aucun ajustement.",
    permissions: [...p("catalog", "read", "print"), ...p("stock", "read"), ...p("sales", "read", "create", "print")],
  },
  {
    cle: "cashier", libelle: "Caissier", mfa: false,
    description: "Encaisse et clôture sa caisse. Consulte le catalogue.",
    permissions: [...p("catalog", "read"), ...p("cash", "read", "create", "print"), ...p("sales", "read", "create", "print")],
  },
  {
    cle: "stock_manager", libelle: "Gestionnaire de stock", mfa: false,
    description: "Fiches produits, entrées de stock, inventaires et ajustements motivés, réceptions.",
    permissions: [
      ...p("catalog", "read", "create", "update", "print", "export"),
      ...p("stock", "read", "create", "update", "approve", "print", "export"),
      ...p("purchases", "read", "create", "update"),
    ],
  },
  {
    cle: "auditor", libelle: "Auditeur", mfa: true,
    description: "Lecture seule, journal d'audit compris. Aucune modification.",
    permissions: [...METIER.flatMap((m) => p(m, "read", "print")), ...p("reports", "export"), ...p("audit", "read", "export")],
  },
  {
    cle: "employee", libelle: "Employé", mfa: false,
    description: "Aucun accès par défaut en dehors de son propre compte. Droits ajoutés au cas par cas.",
    permissions: [],
  },
];
