/**
 * RBAC : rôles du cahier des charges (§8) × modules × actions.
 * Ces valeurs sont les permissions PAR DÉFAUT copiées dans role_permissions à la
 * création d'une société ; elles restent ensuite paramétrables par l'administrateur.
 * À faire valider par RAHA TRANSPORT (le CdC les qualifie d'« indicatives »).
 */
export const MODULES = [
  'transport', 'transit', 'importexport', 'commerce', 'clients', 'fleet', 'staff',
  'maintenance', 'invoices', 'finance', 'documents',
] as const;
export const SCREENS = ['dashboard', 'reports', 'settings', 'audit', 'users', 'license'] as const;
export const ACTIONS = ['read', 'create', 'update', 'validate', 'cancel', 'export', 'print', 'admin'] as const;

export type ModuleKey = (typeof MODULES)[number];
export type Resource = ModuleKey | (typeof SCREENS)[number];
export type Action = (typeof ACTIONS)[number];

export const ROLES = {
  admin: 'Administrateur',
  direction: 'Direction',
  transport: 'Responsable transport',
  transit: 'Responsable transit',
  importexport: 'Responsable import-export',
  commercial: 'Commercial',
  finance: 'Comptable / Finance',
  stock: 'Gestionnaire de stock',
  agent: 'Agent opérationnel',
} as const;
export type RoleKey = keyof typeof ROLES;

const ALL: Action[] = [...ACTIONS];
const WORK: Action[] = ['read', 'create', 'update', 'validate', 'cancel', 'export', 'print'];
const EDIT: Action[] = ['read', 'create', 'update', 'export', 'print'];
const READ: Action[] = ['read', 'export', 'print'];

type Matrix = Partial<Record<Resource, Action[]>>;

const everything = (a: Action[]): Matrix =>
  Object.fromEntries([...MODULES, ...SCREENS].map((m) => [m, a])) as Matrix;

export const DEFAULT_MATRIX: Record<RoleKey, Matrix> = {
  admin: everything(ALL),
  direction: { ...everything(READ), invoices: ['read', 'validate', 'cancel', 'export', 'print'], finance: ['read', 'validate', 'export', 'print'], audit: ['read'], settings: [], users: [], license: ['read'] },
  transport: { dashboard: ['read'], transport: WORK, fleet: EDIT, staff: EDIT, maintenance: EDIT, documents: EDIT, clients: ['read'] },
  transit: { dashboard: ['read'], transit: WORK, documents: EDIT, clients: ['read'] },
  importexport: { dashboard: ['read'], importexport: WORK, documents: EDIT, clients: ['read'] },
  commercial: { dashboard: ['read'], clients: EDIT, commerce: ['read'], invoices: ['read', 'create', 'update', 'print'] },
  finance: { dashboard: ['read'], reports: READ, invoices: WORK, finance: WORK, clients: ['read', 'export'], documents: EDIT },
  stock: { dashboard: ['read'], commerce: WORK, clients: ['read'] },
  agent: { dashboard: ['read'], transport: ['read', 'create', 'update'], transit: ['read', 'create', 'update'], documents: ['read', 'create'] },
};

export function defaultPermissionRows(companyId: string) {
  const rows: { companyId: string; roleKey: string; module: string; action: string }[] = [];
  for (const [roleKey, matrix] of Object.entries(DEFAULT_MATRIX)) {
    for (const [module, actions] of Object.entries(matrix)) {
      for (const action of actions ?? []) rows.push({ companyId, roleKey, module, action });
    }
  }
  return rows;
}

export const permKey = (module: string, action: string) => `${module}:${action}`;
