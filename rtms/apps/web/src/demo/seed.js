// Données FICTIVES de démonstration (noms, plaques, montants inventés).
const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

export function seedRecords() {
  const R = [];
  const add = (m, d) => R.push([m, d]);
  // Tiers
  [['Client', 'SOCAVER SARL', '+237 699 10 20 30', 'Bonabéri, Douala'], ['Client', 'BRASSERIES DU LITTORAL (fictif)', '+237 677 45 12 09', 'Bassa, Douala'], ['Client', 'CIMENTERIE DU WOURI (fictif)', '+237 655 30 44 18', 'Zone industrielle, Douala'],
    ['Client', 'AGRO-SAVANE SA', '+237 690 22 87 61', 'Garoua'], ['Fournisseur', 'PNEUS CENTRAL (fictif)', '+237 698 76 54 32', 'Akwa, Douala'], ['Fournisseur', 'GARAGE MBANGA (fictif)', '+237 651 11 22 33', 'Ndokoti, Douala']]
    .forEach(([type, nom, tel, adr]) => add('clients', { 'Type (Client/Fournisseur)': type, 'Nom / raison sociale': nom, 'Téléphone': tel, 'Adresse': adr }));
  // Parc
  [['LT 4589 BH', 'Mercedes Actros', 'Tracteur', 2019, 412000, 40, iso(120), 'En mission'], ['LT 6721 BH', 'Renault Kerax', 'Porteur', 2017, 528000, 25, iso(12), 'Disponible'],
    ['LT 3390 BH', 'Volvo FH', 'Tracteur', 2021, 198000, 40, iso(-8), 'En maintenance'], ['LT 8841 BH', 'MAN TGS', 'Benne', 2018, 344000, 30, iso(200), 'Disponible']]
    .forEach(([im, mm, ty, an, km, cap, ass, st]) => add('fleet', { Immatriculation: im, 'Marque / modèle': mm, Type: ty, 'Année': an, 'Kilométrage': km, 'Capacité': cap, 'Assurance valide jusqu’au': ass, Statut: st }));
  // Personnel
  [['CH-001', 'Ngono Paul', 'Chauffeur', '+237 699 00 11 22', 'Permis C, CE'], ['CH-002', 'Abba Moussa', 'Chauffeur', '+237 677 33 44 55', 'Permis C'], ['CH-003', 'Ekwalla Jean', 'Chauffeur', '+237 655 66 77 88', 'Permis CE'], ['AD-001', 'Mbarga Claire', 'Comptable', '+237 690 12 34 56', '—']]
    .forEach(([mat, nom, fn, tel, q]) => add('staff', { Matricule: mat, 'Nom complet': nom, Fonction: fn, 'Téléphone': tel, 'Permis / qualification': q, Statut: 'Actif' }));
  // Missions
  [['MS-2026-0042', iso(-2), 'SOCAVER SARL', 'Douala', 'Yaoundé', 'Bouteilles verre', 'LT 4589 BH', 'Ngono Paul', 'En cours', 1250000],
    ['MS-2026-0041', iso(-3), 'CIMENTERIE DU WOURI (fictif)', 'Douala', 'Garoua', 'Ciment', 'LT 6721 BH', 'Abba Moussa', 'En cours', 2100000],
    ['MS-2026-0040', iso(-5), 'BRASSERIES DU LITTORAL (fictif)', 'Douala', 'Bafoussam', 'Boissons', 'LT 8841 BH', 'Ekwalla Jean', 'Clôturé', 980000],
    ['MS-2026-0039', iso(-6), 'AGRO-SAVANE SA', 'Garoua', 'Douala', 'Coton', 'LT 3390 BH', 'Ngono Paul', 'Clôturé', 3400000],
    ['MS-2026-0038', iso(-8), 'SOCAVER SARL', 'Douala', 'Kribi', 'Matériaux', 'LT 6721 BH', 'Abba Moussa', 'En attente', 600000],
    ['MS-2026-0037', iso(-9), 'CIMENTERIE DU WOURI (fictif)', 'Douala', 'Ngaoundéré', 'Ciment', 'LT 8841 BH', 'Ekwalla Jean', 'Annulé', 1750000],
    ['MS-2026-0036', iso(-12), 'BRASSERIES DU LITTORAL (fictif)', 'Douala', 'Bamenda', 'Boissons', 'LT 4589 BH', 'Ngono Paul', 'Clôturé', 1980000]]
    .forEach(([ref, date, cli, dep, dest, mar, veh, ch, st, mt]) => add('transport', { 'Référence mission': ref, 'Date de départ': date, Client: cli, 'Départ': dep, Destination: dest, Marchandise: mar, 'Véhicule': veh, Chauffeur: ch, Statut: st, 'Montant (FCFA)': mt }));
  // Factures (au modèle RAHA : lignes, chauffeur, camion, avance)
  add('invoices', { 'Numéro de facture': 'F-2026-0101', Client: 'SOCAVER SARL', Date: iso(-2), Chauffeur: 'Ngono Paul', Contacts: '+237 699 00 11 22', 'N° de camion': 'LT 4589 BH', 'Montant du transport (FCFA)': 1250000,
    Lignes: [{ 'Désignation': 'Transport Douala - Yaoundé', 'Quantité': 1, 'Prix unitaire (FCFA)': 1100000 }, { 'Désignation': 'Manutention', 'Quantité': 2, 'Prix unitaire (FCFA)': 75000 }], 'Avance (FCFA)': 500000, 'Échéance': iso(28), Statut: 'Validée' });
  add('invoices', { 'Numéro de facture': 'F-2026-0100', Client: 'AGRO-SAVANE SA', Date: iso(-40), Chauffeur: 'Ngono Paul', 'N° de camion': 'LT 3390 BH',
    Lignes: [{ 'Désignation': 'Transport Garoua - Douala (coton)', 'Quantité': 1, 'Prix unitaire (FCFA)': 3400000 }], 'Échéance': iso(-10), Statut: 'Validée' });
  add('invoices', { 'Numéro de facture': 'F-2026-0099', Client: 'BRASSERIES DU LITTORAL (fictif)', Date: iso(-5), Lignes: [{ 'Désignation': 'Transport Douala - Bafoussam', 'Quantité': 1, 'Prix unitaire (FCFA)': 980000 }], 'Avance (FCFA)': 980000, Statut: 'Payée' });
  // Transit, import-export, commerce, finance, maintenance, documents
  add('transit', { 'Référence dossier': 'TR-2026-015', Client: 'AGRO-SAVANE SA', Origine: 'Port de Douala', Destination: 'Garoua', 'Type de procédure': 'Mise à la consommation', 'Date ouverture': iso(-4), 'Frais estimés': 850000, Statut: 'En cours' });
  add('transit', { 'Référence dossier': 'TR-2026-014', Client: 'SOCAVER SARL', Origine: 'Port de Douala', Destination: 'Douala', 'Type de procédure': 'Transit', 'Date ouverture': iso(-15), 'Frais estimés': 420000, Statut: 'Clôturé' });
  add('importexport', { 'Référence': 'IMP-2026-007', 'Type (Import/Export)': 'Import', 'Client / fournisseur': 'Fournisseur pièces (fictif)', 'Pays d’origine': 'Chine', 'Pays de destination': 'Cameroun', Marchandise: 'Pièces détachées', 'Valeur déclarée': 12500000, Date: iso(-20), Statut: 'En cours' });
  add('importexport', { 'Référence': 'EXP-2026-003', 'Type (Import/Export)': 'Export', 'Client / fournisseur': 'AGRO-SAVANE SA', 'Pays d’origine': 'Cameroun', 'Pays de destination': 'Tchad', Marchandise: 'Coton', 'Valeur déclarée': 18000000, Date: iso(-7), Statut: 'En attente' });
  add('commerce', { 'Code article': 'ART-001', 'Désignation': 'Pneu 315/80 R22.5', 'Catégorie': 'Pièces', 'Unité': 'pièce', 'Quantité en stock': 6, 'Prix d’achat': 210000, 'Prix de vente': 255000, 'Stock minimum': 8 });
  add('commerce', { 'Code article': 'ART-002', 'Désignation': 'Huile moteur 15W40 (20 L)', 'Catégorie': 'Lubrifiants', 'Unité': 'bidon', 'Quantité en stock': 40, 'Prix d’achat': 32000, 'Prix de vente': 39000, 'Stock minimum': 10 });
  add('finance', { 'Type (Recette/Dépense)': 'Recette', 'Libellé': 'Règlement F-2026-0099', 'Catégorie': 'Transport', 'Montant (FCFA)': 980000, 'Mode de paiement': 'Virement', Date: iso(-3) });
  add('finance', { 'Type (Recette/Dépense)': 'Recette', 'Libellé': 'Avance F-2026-0101', 'Catégorie': 'Transport', 'Montant (FCFA)': 500000, 'Mode de paiement': 'Mobile money', Date: iso(-2) });
  add('finance', { 'Type (Recette/Dépense)': 'Dépense', 'Libellé': 'Gasoil mission MS-2026-0042', 'Catégorie': 'Carburant', 'Montant (FCFA)': 310000, 'Mode de paiement': 'Espèces', Date: iso(-2) });
  add('maintenance', { 'Véhicule': 'LT 3390 BH', 'Type d’intervention': 'Vidange et freins', Description: 'Remplacement plaquettes, vidange complète.', Prestataire: 'GARAGE MBANGA (fictif)', Date: iso(-1), 'Coût (FCFA)': 285000, 'Prochain entretien': iso(10) });
  add('documents', { 'Référence': 'DOC-2026-031', 'Intitulé': 'Carte grise LT 4589 BH', 'Catégorie': 'Véhicule', 'Dossier lié': 'MS-2026-0042', 'Date du document': iso(-400), 'Date d’expiration': iso(20) });
  add('documents', { 'Référence': 'DOC-2026-032', 'Intitulé': 'Bon de livraison client', 'Catégorie': 'Transport', 'Dossier lié': 'MS-2026-0042', 'Date du document': iso(-2) });
  return R;
}
