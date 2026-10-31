// Configuration métier de l'interface : vues de la barre d'outils, colonnes,
// sections de formulaire, listes de recherche et commandes contextuelles.
// Les règles (champs autorisés, obligatoires, listes) viennent du serveur (/api/modules).
import { dateFr, money } from './core/dom.js';

/** Statuts qui figent un enregistrement (même liste que le serveur). */
export const LOCKED_STATUSES = ['Validé', 'Validée', 'Clôturé', 'Payée'];
export const VALIDATED_STATUS = { invoices: 'Validée', transport: 'Validé', transit: 'Validé', importexport: 'Validé' };

const col = (label, key, opts = {}) => ({ label, key, sort: opts.sort ?? key, render: opts.render, num: !!opts.num, hidden: !!opts.hidden });

/** Colonnes par module : `key` = champ métier, `sort` = clé de tri serveur. */
export const COLUMNS = {
  transport: [col('Référence', 'Référence mission'), col('Client', 'Client'), col('Départ', 'Départ'), col('Destination', 'Destination'), col('Marchandise', 'Marchandise'), col('Véhicule', 'Véhicule'), col('Chauffeur', 'Chauffeur'), col('Date de départ', 'Date de départ', { render: (d) => dateFr(d['Date de départ']) }), col('Statut', 'Statut')],
  transit: [col('Référence', 'Référence dossier'), col('Client', 'Client'), col('Origine', 'Origine'), col('Destination', 'Destination'), col('Procédure', 'Type de procédure'), col('Ouverture', 'Date ouverture', { render: (d) => dateFr(d['Date ouverture']) }), col('Frais estimés', 'Frais estimés', { num: true, render: (d) => money(d['Frais estimés']) }), col('Statut', 'Statut')],
  importexport: [col('Référence', 'Référence'), col('Type', 'Type (Import/Export)'), col('Partenaire', 'Client / fournisseur'), col('Origine', 'Pays d’origine'), col('Destination', 'Pays de destination'), col('Marchandise', 'Marchandise'), col('Valeur déclarée', 'Valeur déclarée', { num: true, render: (d) => money(d['Valeur déclarée']) }), col('Date', 'Date', { render: (d) => dateFr(d.Date) }), col('Statut', 'Statut')],
  commerce: [col('Code', 'Code article'), col('Désignation', 'Désignation'), col('Catégorie', 'Catégorie'), col('Stock', 'Quantité en stock', { num: true, render: (d) => `${money(d['Quantité en stock'])} ${d['Unité'] ?? ''}`.trim() }), col('Seuil', 'Stock minimum', { num: true, render: (d) => money(d['Stock minimum']) }), col('Prix achat', 'Prix d’achat', { num: true, render: (d) => money(d['Prix d’achat']) }), col('Prix vente', 'Prix de vente', { num: true, render: (d) => money(d['Prix de vente']) }), col('Marge', '__marge', { sort: null, num: true, render: (d) => (d['Prix de vente'] != null && d['Prix d’achat'] != null ? money(d['Prix de vente'] - d['Prix d’achat']) : '—') })],
  clients: [col('Type', 'Type (Client/Fournisseur)', { hidden: true }), col('Nom / raison sociale', 'Nom / raison sociale'), col('Téléphone', 'Téléphone'), col('E-mail', 'E-mail'), col('Adresse', 'Adresse'), col('Contact', 'Personne à contacter'), col('N° contribuable', 'N° contribuable', { sort: null, hidden: true })],
  fleet: [col('Immatriculation', 'Immatriculation'), col('Véhicule', 'Marque / modèle'), col('Type', 'Type'), col('Année', 'Année', { num: true }), col('Kilométrage', 'Kilométrage', { num: true, render: (d) => money(d['Kilométrage']) }), col('Capacité', 'Capacité', { num: true }), col('Assurance', 'Assurance valide jusqu’au', { render: (d) => dateFr(d['Assurance valide jusqu’au']) }), col('Statut', 'Statut')],
  staff: [col('Matricule', 'Matricule'), col('Nom', 'Nom complet'), col('Fonction', 'Fonction'), col('Téléphone', 'Téléphone'), col('Qualification', 'Permis / qualification', { sort: null }), col('Embauche', 'Date d’embauche', { render: (d) => dateFr(d['Date d’embauche']) }), col('Statut', 'Statut')],
  maintenance: [col('Véhicule', 'Véhicule'), col('Intervention', 'Type d’intervention'), col('Description', 'Description'), col('Prestataire', 'Prestataire'), col('Date', 'Date', { render: (d) => dateFr(d.Date) }), col('Coût', 'Coût (FCFA)', { num: true, render: (d) => money(d['Coût (FCFA)']) }), col('Prochain entretien', 'Prochain entretien', { render: (d) => dateFr(d['Prochain entretien']) })],
  invoices: [col('N° facture', 'Numéro de facture'), col('Client', 'Client'), col('Date', 'Date', { render: (d) => dateFr(d.Date) }), col('Désignation', 'Désignation'), col('Qté', 'Quantité', { num: true }), col('P.U.', 'Prix unitaire (FCFA)', { num: true, render: (d) => money(d['Prix unitaire (FCFA)']) }), col('Total TTC', '__ttc', { sort: 'totalTTC', num: true, render: (d, r) => money(r.computed && r.computed.totalTTC) }), col('Échéance', 'Échéance', { render: (d) => dateFr(d['Échéance']) }), col('Statut', 'Statut')],
  finance: [col('Type', 'Type (Recette/Dépense)'), col('Libellé', 'Libellé'), col('Catégorie', 'Catégorie'), col('Montant', 'Montant (FCFA)', { num: true, render: (d) => money(d['Montant (FCFA)']) }), col('Paiement', 'Mode de paiement'), col('Date', 'Date', { render: (d) => dateFr(d.Date) }), col('Référence', 'Référence')],
  documents: [col('Référence', 'Référence'), col('Intitulé', 'Intitulé'), col('Catégorie', 'Catégorie'), col('Dossier lié', 'Dossier lié'), col('Date', 'Date du document', { render: (d) => dateFr(d['Date du document']) }), col('Expiration', 'Date d’expiration', { render: (d) => dateFr(d['Date d’expiration']) }), col('Emplacement', 'Emplacement / lien')],
};

/** Sections des formulaires (les champs non listés tombent dans « Autres informations »). */
export const SECTIONS = {
  transport: [['Identification', ['Référence mission', 'Statut', 'Client']], ['Itinéraire', ['Départ', 'Destination', 'Date de départ']], ['Chargement et moyens', ['Marchandise', 'Véhicule', 'Chauffeur']]],
  transit: [['Dossier', ['Référence dossier', 'Statut', 'Client', 'Type de procédure']], ['Acheminement', ['Origine', 'Destination', 'Date ouverture']], ['Frais', ['Frais estimés']]],
  importexport: [['Opération', ['Référence', 'Type (Import/Export)', 'Statut', 'Date']], ['Partenaire et pays', ['Client / fournisseur', 'Pays d’origine', 'Pays de destination']], ['Marchandise', ['Marchandise', 'Valeur déclarée']]],
  commerce: [['Article', ['Code article', 'Désignation', 'Catégorie', 'Unité']], ['Stock', ['Quantité en stock', 'Stock minimum']], ['Prix', ['Prix d’achat', 'Prix de vente']]],
  clients: [['Identité', ['Type (Client/Fournisseur)', 'Nom / raison sociale', 'N° contribuable']], ['Coordonnées', ['Téléphone', 'E-mail', 'Adresse', 'Personne à contacter']]],
  fleet: [['Véhicule', ['Immatriculation', 'Marque / modèle', 'Type', 'Année', 'Statut']], ['Exploitation', ['Kilométrage', 'Capacité']], ['Documents', ['Assurance valide jusqu’au']]],
  staff: [['Identité', ['Matricule', 'Nom complet', 'Fonction', 'Statut']], ['Contact et qualification', ['Téléphone', 'Permis / qualification', 'Date d’embauche']]],
  maintenance: [['Intervention', ['Véhicule', 'Type d’intervention', 'Date', 'Prestataire']], ['Détails', ['Description']], ['Coût et suivi', ['Coût (FCFA)', 'Prochain entretien']]],
  invoices: [['Facture', ['Numéro de facture', 'Statut', 'Date', 'Échéance', 'Client']], ['Prestation', ['Désignation', 'Quantité', 'Prix unitaire (FCFA)', 'Taxe (%)']]],
  finance: [['Mouvement', ['Type (Recette/Dépense)', 'Libellé', 'Catégorie', 'Date']], ['Règlement', ['Montant (FCFA)', 'Mode de paiement', 'Référence']]],
  documents: [['Document', ['Référence', 'Intitulé', 'Catégorie', 'Dossier lié']], ['Validité et classement', ['Date du document', 'Date d’expiration', 'Emplacement / lien']]],
};

/**
 * Recherche dynamique dans les formulaires : propose les valeurs d'un autre module.
 * { champ: [module, champ source, filtre] }
 */
export const LOOKUPS = {
  Client: ['clients', 'Nom / raison sociale', { 'Type (Client/Fournisseur)': 'Client' }],
  'Client / fournisseur': ['clients', 'Nom / raison sociale', null],
  'Véhicule': ['fleet', 'Immatriculation', null],
  Chauffeur: ['staff', 'Nom complet', null],
  Prestataire: ['clients', 'Nom / raison sociale', { 'Type (Client/Fournisseur)': 'Fournisseur' }],
  'Dossier lié': ['transit', 'Référence dossier', null],
};

const LIST_TOOLBAR = [['record.new'], ['record.open', 'record.edit', 'record.duplicate'], ['record.status', 'record.validate'], ['file.print', 'file.pdf', 'file.csv'], ['record.cancel'], ['view.filters', 'view.columns', 'view.refresh']];

/** Vues de la barre d'outils verticale (17 entrées). */
export const VIEWS = [
  { key: 'dashboard', label: 'Tableau de bord', icon: 'dashboard', kind: 'dashboard', res: 'dashboard', group: 'Pilotage' },
  { key: 'transport', label: 'Transport', title: 'Missions de transport', icon: 'truck', kind: 'list', module: 'transport', newLabel: 'Nouvelle mission', group: 'Opérations', toolbar: [['record.new'], ['record.open', 'record.edit'], ['transport.vehicle', 'transport.driver', 'record.status', 'record.validate'], ['transport.order', 'file.print', 'file.pdf', 'file.csv'], ['record.cancel'], ['view.filters', 'view.columns', 'view.refresh']] },
  { key: 'transit', label: 'Transit', title: 'Dossiers de transit', icon: 'transit', kind: 'list', module: 'transit', newLabel: 'Nouveau dossier', group: 'Opérations' },
  { key: 'import', label: 'Importation', title: 'Importations', icon: 'import', kind: 'list', module: 'importexport', preset: { 'Type (Import/Export)': 'Import' }, newLabel: 'Nouvelle importation', group: 'Opérations' },
  { key: 'export', label: 'Exportation', title: 'Exportations', icon: 'export', kind: 'list', module: 'importexport', preset: { 'Type (Import/Export)': 'Export' }, newLabel: 'Nouvelle exportation', group: 'Opérations' },
  { key: 'commerce', label: 'Commerce général', title: 'Articles et stocks', icon: 'store', kind: 'list', module: 'commerce', newLabel: 'Nouvel article', group: 'Opérations' },
  { key: 'clients', label: 'Clients', title: 'Clients', icon: 'users', kind: 'list', module: 'clients', preset: { 'Type (Client/Fournisseur)': 'Client' }, newLabel: 'Nouveau client', group: 'Tiers' },
  { key: 'suppliers', label: 'Fournisseurs', title: 'Fournisseurs', icon: 'factory', kind: 'list', module: 'clients', preset: { 'Type (Client/Fournisseur)': 'Fournisseur' }, newLabel: 'Nouveau fournisseur', group: 'Tiers' },
  { key: 'invoices', label: 'Facturation', title: 'Factures', icon: 'receipt', kind: 'list', module: 'invoices', newLabel: 'Nouvelle facture', group: 'Gestion', toolbar: [['record.new'], ['record.open', 'record.edit', 'record.duplicate'], ['record.validate', 'record.status'], ['invoice.print', 'file.pdf', 'file.csv', 'file.print'], ['record.cancel'], ['view.filters', 'view.columns', 'view.refresh']] },
  { key: 'finance', label: 'Trésorerie', title: 'Finance et trésorerie', icon: 'wallet', kind: 'list', module: 'finance', newLabel: 'Nouveau mouvement', group: 'Gestion' },
  { key: 'fleet', label: 'Parc automobile', title: 'Parc automobile', icon: 'car', kind: 'list', module: 'fleet', newLabel: 'Nouveau véhicule', group: 'Ressources' },
  { key: 'staff', label: 'Chauffeurs et personnel', title: 'Personnel et chauffeurs', icon: 'idcard', kind: 'list', module: 'staff', newLabel: 'Nouvel employé', group: 'Ressources' },
  { key: 'maintenance', label: 'Maintenance', title: 'Maintenance', icon: 'wrench', kind: 'list', module: 'maintenance', newLabel: 'Nouvelle intervention', group: 'Ressources' },
  { key: 'documents', label: 'Gestion documentaire', title: 'Documents', icon: 'folder', kind: 'list', module: 'documents', newLabel: 'Nouveau document', group: 'Ressources' },
  { key: 'reports', label: 'Rapports', icon: 'chart', kind: 'reports', res: 'reports', group: 'Analyse' },
  { key: 'admin', label: 'Administration', icon: 'shield', kind: 'admin', res: ['users', 'audit', 'license'], group: 'Système' },
  { key: 'settings', label: 'Paramètres', icon: 'settings', kind: 'settings', res: null, group: 'Système' },
];
for (const v of VIEWS) if (v.kind === 'list' && !v.toolbar) v.toolbar = LIST_TOOLBAR;

export const viewByKey = (k) => VIEWS.find((v) => v.key === k);
/** Vue « naturelle » d'un enregistrement (ex. un fournisseur ouvre la vue Fournisseurs). */
export function viewForRecord(module, data = {}) {
  if (module === 'clients') return data['Type (Client/Fournisseur)'] === 'Fournisseur' ? 'suppliers' : 'clients';
  if (module === 'importexport') return data['Type (Import/Export)'] === 'Export' ? 'export' : 'import';
  return VIEWS.find((v) => v.module === module)?.key ?? 'dashboard';
}
export const MODULE_LABEL = { transport: 'Mission', transit: 'Dossier de transit', importexport: 'Opération', commerce: 'Article', clients: 'Tiers', fleet: 'Véhicule', staff: 'Employé', maintenance: 'Intervention', invoices: 'Facture', finance: 'Mouvement', documents: 'Document' };

export function recordTitle(module, r) {
  const d = r.data || {};
  return r.reference || d['Nom / raison sociale'] || d['Libellé'] || d['Nom complet'] || [d['Véhicule'], d['Type d’intervention']].filter(Boolean).join(' — ') || MODULE_LABEL[module];
}
