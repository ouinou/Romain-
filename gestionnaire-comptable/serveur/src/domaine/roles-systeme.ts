/**
 * Rôles créés pour chaque nouvelle entreprise. Leurs permissions ne sont pas modifiables par l'API :
 * pour adapter un profil, on crée un rôle personnalisé (éventuellement copié d'un rôle système).
 *
 * Principe : moindre privilège. Aucun rôle ne peut modifier ou supprimer le journal d'audit,
 * et l'administrateur ne reçoit aucun droit sur les données financières par défaut.
 */
type Action = "read" | "create" | "update" | "submit" | "approve" | "cancel" | "archive" | "print" | "export" | "admin";
const p = (module: string, ...actions: Action[]) => actions.map((a) => `${module}.${a}`);
const METIER = ["accounting", "treasury", "cash", "sales", "purchases", "stock", "reports"];

export interface RoleSysteme { cle: string; libelle: string; description: string; mfa: boolean; permissions: string[] }

export const ROLES_SYSTEME: RoleSysteme[] = [
  {
    cle: "company_admin", libelle: "Administrateur de l'entreprise", mfa: true,
    description: "Gère les comptes, les rôles et les paramètres. Aucun accès financier par défaut.",
    permissions: [
      ...p("users", "read", "create", "update", "archive", "admin"),
      ...p("roles", "read", "create", "update", "archive", "admin"),
      ...p("company", "read", "update", "admin"),
      ...p("audit", "read", "export"),
      ...p("backups", "read", "create"),
    ],
  },
  {
    cle: "general_manager", libelle: "Directeur général", mfa: true,
    description: "Vue d'ensemble, rapports de direction et validation des opérations selon le circuit défini.",
    permissions: [
      ...METIER.flatMap((m) => p(m, "read")),
      ...p("reports", "print", "export"),
      ...p("accounting", "approve"), ...p("treasury", "approve"), ...p("purchases", "approve"),
      ...p("hr", "read"), ...p("payroll", "read", "approve"),
      ...p("audit", "read"), ...p("users", "read"), ...p("company", "read"),
    ],
  },
  {
    cle: "finance_director", libelle: "Directeur financier", mfa: true,
    description: "Finances, trésorerie et rapports détaillés ; validation des dépenses selon délégation.",
    permissions: [
      ...p("accounting", "read", "approve", "cancel", "print", "export"),
      ...p("treasury", "read", "create", "update", "submit", "approve", "cancel", "print", "export"),
      ...p("cash", "read", "approve", "print"),
      ...p("sales", "read", "print"), ...p("purchases", "read", "approve", "print"),
      ...p("payroll", "read", "approve"),
      ...p("reports", "read", "print", "export"),
    ],
  },
  {
    cle: "accountant", libelle: "Comptable", mfa: false,
    description: "Saisie et correction tracée des écritures, pièces justificatives, états comptables.",
    permissions: [
      ...p("accounting", "read", "create", "update", "submit", "cancel", "print", "export"),
      ...p("treasury", "read", "create", "submit", "print"),
      ...p("cash", "read"), ...p("sales", "read"), ...p("purchases", "read"),
      ...p("reports", "read", "print"),
    ],
  },
  {
    cle: "cashier", libelle: "Caissier", mfa: false,
    description: "Mouvements de caisse et solde de sa caisse uniquement.",
    permissions: p("cash", "read", "create", "submit", "print"),
  },
  {
    cle: "stock_manager", libelle: "Gestionnaire de stocks", mfa: false,
    description: "Articles, inventaires et mouvements de stock. Pas d'accès à la paie ni aux résultats.",
    permissions: [...p("stock", "read", "create", "update", "submit", "print", "export"), ...p("purchases", "read")],
  },
  {
    cle: "purchasing_manager", libelle: "Responsable des achats", mfa: false,
    description: "Demandes d'achat, commandes et fournisseurs. Pas de paiement fournisseur.",
    permissions: [...p("purchases", "read", "create", "update", "submit", "cancel", "print"), ...p("stock", "read")],
  },
  {
    cle: "auditor", libelle: "Auditeur", mfa: true,
    description: "Lecture seule dans le périmètre de mission, journal d'audit compris. Aucune modification.",
    permissions: [...METIER.flatMap((m) => p(m, "read", "print")), ...p("reports", "export"), ...p("audit", "read", "export")],
  },
  {
    cle: "hr_manager", libelle: "Responsable des ressources humaines", mfa: true,
    description: "Dossiers du personnel et préparation de la paie.",
    permissions: [...p("hr", "read", "create", "update", "submit", "archive", "print", "export"), ...p("payroll", "read", "create", "update", "submit", "print")],
  },
  {
    cle: "employee", libelle: "Employé", mfa: false,
    description: "Aucun accès par défaut en dehors de son propre compte. Droits ajoutés au cas par cas.",
    permissions: [],
  },
];
