/**
 * Définition des 11 modules de saisie du prototype (mêmes libellés de champs,
 * pour que les données existantes du navigateur restent importables telles quelles).
 * La validation se fait ICI, côté serveur ; le formulaire web n'est qu'une aide.
 */
import { z } from 'zod';
import type { ModuleKey } from '../security/permissions.js';

type FieldType = 'text' | 'longtext' | 'date' | 'number' | 'enum';
export interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  /** Chiffré au repos (AES-256-GCM) — exclu de la recherche serveur. */
  sensitive?: boolean;
  min?: number;
  max?: number;
}
export interface ModuleDef {
  key: ModuleKey;
  fields: FieldDef[];
  /** Champ servant de référence unique (index unique PostgreSQL). */
  referenceField?: string;
  statusField?: string;
}

// Statuts proposés à partir du §7 du CdC — à valider par RAHA TRANSPORT.
const GENERIC_STATUS = ['Brouillon', 'En attente', 'En cours', 'Validé', 'Clôturé', 'Annulé'] as const;

const t = (name: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, type: 'text', ...extra });
const d = (name: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, type: 'date', ...extra });
const n = (name: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, type: 'number', min: 0, ...extra });
const e = (name: string, options: readonly string[], extra: Partial<FieldDef> = {}): FieldDef => ({ name, type: 'enum', options, ...extra });
const req = { required: true };

export const MODULE_DEFS: Record<ModuleKey, ModuleDef> = {
  transport: {
    key: 'transport', referenceField: 'Référence mission', statusField: 'Statut',
    fields: [t('Référence mission', req), t('Client', req), t('Départ', req), t('Destination', req), t('Marchandise'), t('Véhicule'), t('Chauffeur'), d('Date de départ'), e('Statut', GENERIC_STATUS, req)],
  },
  transit: {
    key: 'transit', referenceField: 'Référence dossier', statusField: 'Statut',
    fields: [t('Référence dossier', req), t('Client', req), t('Origine'), t('Destination'), t('Type de procédure'), d('Date ouverture'), n('Frais estimés'), e('Statut', GENERIC_STATUS, req)],
  },
  importexport: {
    key: 'importexport', referenceField: 'Référence', statusField: 'Statut',
    fields: [t('Référence', req), e('Type (Import/Export)', ['Import', 'Export'], req), t('Client / fournisseur', req), t('Pays d’origine'), t('Pays de destination'), t('Marchandise'), n('Valeur déclarée'), d('Date'), e('Statut', GENERIC_STATUS, req)],
  },
  commerce: {
    key: 'commerce', referenceField: 'Code article',
    fields: [t('Code article', req), t('Désignation', req), t('Catégorie'), t('Unité'), n('Quantité en stock', { min: undefined }), n('Prix d’achat'), n('Prix de vente'), n('Stock minimum')],
  },
  clients: {
    key: 'clients',
    fields: [e('Type (Client/Fournisseur)', ['Client', 'Fournisseur'], req), t('Nom / raison sociale', req), t('Téléphone'), t('E-mail'), t('Adresse'), t('N° contribuable', { sensitive: true }), t('Personne à contacter')],
  },
  fleet: {
    key: 'fleet', referenceField: 'Immatriculation', statusField: 'Statut',
    fields: [t('Immatriculation', req), t('Marque / modèle', req), t('Type'), n('Année', { min: 1950 }), n('Kilométrage'), n('Capacité'), d('Assurance valide jusqu’au'), e('Statut', ['Disponible', 'En mission', 'En maintenance', 'Hors service'], req)],
  },
  staff: {
    key: 'staff', referenceField: 'Matricule', statusField: 'Statut',
    fields: [t('Matricule', req), t('Nom complet', req), t('Fonction'), t('Téléphone'), t('Permis / qualification', { sensitive: true }), d('Date d’embauche'), e('Statut', ['Actif', 'En congé', 'Inactif'], req)],
  },
  maintenance: {
    key: 'maintenance',
    fields: [t('Véhicule', req), t('Type d’intervention', req), { name: 'Description', type: 'longtext' }, t('Prestataire'), d('Date', req), n('Coût (FCFA)'), d('Prochain entretien')],
  },
  invoices: {
    key: 'invoices', referenceField: 'Numéro de facture', statusField: 'Statut',
    fields: [t('Numéro de facture', req), t('Client', req), d('Date', req), t('Désignation', req), n('Quantité', req), n('Prix unitaire (FCFA)', req), n('Taxe (%)', { max: 100 }), d('Échéance'), e('Statut', ['Brouillon', 'Validée', 'Payée partiellement', 'Payée', 'Annulée'], req)],
  },
  finance: {
    key: 'finance', statusField: undefined,
    fields: [e('Type (Recette/Dépense)', ['Recette', 'Dépense'], req), t('Libellé', req), t('Catégorie'), n('Montant (FCFA)', req), e('Mode de paiement', ['Espèces', 'Virement', 'Chèque', 'Mobile money', 'Autre']), d('Date', req), t('Référence')],
  },
  documents: {
    key: 'documents', referenceField: 'Référence',
    fields: [t('Référence', req), t('Intitulé', req), t('Catégorie'), t('Dossier lié'), d('Date du document'), d('Date d’expiration'), t('Emplacement / lien')],
  },
};

const MAX_TEXT = 500;
const MAX_LONG = 4000;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function fieldSchema(f: FieldDef) {
  let s: z.ZodTypeAny;
  switch (f.type) {
    case 'number': {
      let num = z.coerce.number({ error: `${f.name} : nombre attendu` }).finite();
      if (f.min !== undefined) num = num.min(f.min, `${f.name} : valeur minimale ${f.min}`);
      if (f.max !== undefined) num = num.max(f.max, `${f.name} : valeur maximale ${f.max}`);
      s = num;
      break;
    }
    case 'date':
      s = z.string().regex(dateRe, `${f.name} : date AAAA-MM-JJ attendue`).refine((v) => !Number.isNaN(Date.parse(v)), `${f.name} : date invalide`);
      break;
    case 'enum':
      s = z.enum(f.options as [string, ...string[]], { error: `${f.name} : valeur non autorisée` });
      break;
    default:
      s = z.string().trim().max(f.type === 'longtext' ? MAX_LONG : MAX_TEXT, `${f.name} : texte trop long`);
  }
  if (f.required) {
    return f.type === 'text' || f.type === 'longtext'
      ? (s as z.ZodString).min(1, `${f.name} : champ obligatoire`)
      : s;
  }
  // Champ facultatif : chaîne vide acceptée et supprimée
  return z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional());
}

const schemaCache = new Map<string, z.ZodTypeAny>();
export function recordSchema(module: ModuleKey, partial = false) {
  const key = `${module}:${partial}`;
  let s = schemaCache.get(key);
  if (!s) {
    const shape = Object.fromEntries(MODULE_DEFS[module].fields.map((f) => [f.name, fieldSchema(f)]));
    const obj = z.object(shape).strict(); // champ inconnu = rejet (pas d'injection de clés)
    s = partial ? obj.partial() : obj;
    schemaCache.set(key, s);
  }
  return s;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Valeurs calculées côté serveur (le client ne peut pas les imposer). */
export function computeFields(module: ModuleKey, data: Record<string, unknown>): Record<string, number> {
  if (module === 'invoices') {
    const qty = Number(data['Quantité'] ?? 0);
    const pu = Number(data['Prix unitaire (FCFA)'] ?? 0);
    const rate = Number(data['Taxe (%)'] ?? 0);
    const totalHT = round2(qty * pu);
    const tax = round2((totalHT * rate) / 100);
    return { totalHT, tax, totalTTC: round2(totalHT + tax) };
  }
  return {};
}

export function isModule(v: string): v is ModuleKey {
  return Object.prototype.hasOwnProperty.call(MODULE_DEFS, v);
}

/** Échappement CSV + neutralisation de l'injection de formules (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
