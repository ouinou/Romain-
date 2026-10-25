/**
 * Catégories proposées aux utilisateurs qui ne connaissent pas le plan comptable.
 * Chaque catégorie correspond à un compte de contrepartie (numéros À VÉRIFIER avec l'expert-comptable,
 * voir docs/COMPTABILITE.md). Un compte protégé (ex. 661 salaires) n'est proposé qu'aux personnes autorisées.
 */
export interface Categorie { code: string; libelle: string; compte: string; tva?: boolean }

export const CATEGORIES_ENTREE: Categorie[] = [
  { code: "encaissement_client", libelle: "Règlement d'un client (facture à crédit)", compte: "411" },
  { code: "autre_produit", libelle: "Autre recette (produits accessoires)", compte: "707" },
  { code: "apport", libelle: "Apport en capital", compte: "101" },
  { code: "emprunt", libelle: "Emprunt bancaire reçu", compte: "162" },
];

export const CATEGORIES_SORTIE: Categorie[] = [
  { code: "fournitures", libelle: "Fournitures et petits achats", compte: "605", tva: true },
  { code: "marchandises", libelle: "Achat de marchandises", compte: "601", tva: true },
  { code: "transport", libelle: "Transport et déplacements", compte: "618", tva: true },
  { code: "loyer", libelle: "Loyer et charges locatives", compte: "622", tva: true },
  { code: "entretien", libelle: "Entretien et réparations", compte: "624", tva: true },
  { code: "assurance", libelle: "Assurance", compte: "625" },
  { code: "publicite", libelle: "Publicité", compte: "627", tva: true },
  { code: "telephone", libelle: "Téléphone et Internet", compte: "628", tva: true },
  { code: "frais_bancaires", libelle: "Frais bancaires", compte: "631" },
  { code: "honoraires", libelle: "Honoraires et conseils", compte: "632", tva: true },
  { code: "impots", libelle: "Impôts et taxes", compte: "641" },
  { code: "fournisseur", libelle: "Règlement d'un fournisseur", compte: "401" },
  { code: "salaires", libelle: "Salaires versés", compte: "661" },
];

export const COMPTE_TVA_RECUPERABLE = "445";
export const COMPTE_TVA_FACTUREE = "443";
export const COMPTE_CLIENTS = "411";
export const COMPTE_VENTES_MARCHANDISES = "701";
export const COMPTE_SERVICES_VENDUS = "706";
