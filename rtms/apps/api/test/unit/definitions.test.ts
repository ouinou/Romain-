import { describe, expect, it } from 'vitest';
import { amountInFrenchWords, computeFields, csvCell, recordSchema, MODULE_DEFS } from '../../src/modules/definitions.js';

describe('Validation serveur des modules', () => {
  it('reprend les 11 modules de saisie du prototype', () => {
    expect(Object.keys(MODULE_DEFS).sort()).toEqual(['clients', 'commerce', 'documents', 'finance', 'fleet', 'importexport', 'invoices', 'maintenance', 'staff', 'transit', 'transport']);
  });
  it('refuse un champ inconnu (pas d’injection de clés)', () => {
    const r = recordSchema('clients').safeParse({ 'Type (Client/Fournisseur)': 'Client', 'Nom / raison sociale': 'X', isAdmin: true });
    expect(r.success).toBe(false);
  });
  it('impose les listes fermées (ex. Recette/Dépense)', () => {
    const ok = recordSchema('finance').safeParse({ 'Type (Recette/Dépense)': 'Dépense', 'Libellé': 'Gasoil', 'Montant (FCFA)': '150000', 'Date': '2026-10-01' });
    expect(ok.success).toBe(true);
    const ko = recordSchema('finance').safeParse({ 'Type (Recette/Dépense)': 'depense', 'Libellé': 'Gasoil', 'Montant (FCFA)': '150000', 'Date': '2026-10-01' });
    expect(ko.success).toBe(false);
  });
  it('convertit et borne les nombres', () => {
    const r = recordSchema('finance').safeParse({ 'Type (Recette/Dépense)': 'Recette', 'Libellé': 'x', 'Montant (FCFA)': '-5', 'Date': '2026-10-01' });
    expect(r.success).toBe(false);
  });
  it('rejette une date invalide', () => {
    const r = recordSchema('maintenance').safeParse({ 'Véhicule': 'A', 'Type d’intervention': 'Vidange', 'Date': '31/10/2026' });
    expect(r.success).toBe(false);
  });
  it('calcule le total TTC côté serveur', () => {
    expect(computeFields('invoices', { 'Quantité': 3, 'Prix unitaire (FCFA)': 125000, 'Taxe (%)': 18 })).toMatchObject({ totalHT: 375000, tax: 67500, totalTTC: 442500 });
    expect(computeFields('invoices', { 'Quantité': 2, 'Prix unitaire (FCFA)': 1000 })).toMatchObject({ totalHT: 2000, tax: 0, totalTTC: 2000 });
  });
  it('neutralise l’injection de formules CSV', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+33 6')).toBe(`"'+33 6"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('Normal')).toBe('"Normal"');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe('Facture au modèle RAHA', () => {
  const base = { 'Numéro de facture': 'F-1', Client: 'X', Date: '2026-10-31', Statut: 'Brouillon' };
  it('plusieurs lignes : P. total par ligne, total, avance et reste', () => {
    const d = { ...base, Lignes: [{ 'Désignation': 'Transport Douala-Yaoundé', 'Quantité': 2, 'Prix unitaire (FCFA)': 250000 }, { 'Désignation': 'Manutention', 'Quantité': 1, 'Prix unitaire (FCFA)': 90000 }], 'Avance (FCFA)': 300000 };
    expect(recordSchema('invoices').safeParse(d).success).toBe(true);
    expect(computeFields('invoices', d)).toMatchObject({ totalHT: 590000, totalTTC: 590000, avance: 300000, reste: 290000, lines: 2, totalEnLettres: 'cinq cent quatre-vingt-dix mille francs CFA' });
  });
  it('exige au moins une ligne', () => {
    const r = recordSchema('invoices').safeParse(base);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toMatch(/au moins une ligne/);
  });
  it('refuse une avance supérieure au total', () => {
    const r = recordSchema('invoices').safeParse({ ...base, Lignes: [{ 'Désignation': 'A', 'Quantité': 1, 'Prix unitaire (FCFA)': 1000 }], 'Avance (FCFA)': 5000 });
    expect(r.success).toBe(false);
  });
  it('refuse une ligne vide, une quantité nulle ou un champ inconnu dans une ligne', () => {
    for (const l of [{ 'Désignation': '', 'Quantité': 1, 'Prix unitaire (FCFA)': 1 }, { 'Désignation': 'A', 'Quantité': 0, 'Prix unitaire (FCFA)': 1 }, { 'Désignation': 'A', 'Quantité': 1, 'Prix unitaire (FCFA)': 1, pirate: 1 }]) {
      expect(recordSchema('invoices').safeParse({ ...base, Lignes: [l] }).success).toBe(false);
    }
  });
  it('les anciennes factures à une ligne restent valides', () => {
    expect(recordSchema('invoices').safeParse({ ...base, 'Désignation': 'A', 'Quantité': '2', 'Prix unitaire (FCFA)': '10' }).success).toBe(true);
  });
});

describe('Montant en lettres', () => {
  it.each([
    [0, 'zéro'], [1, 'un'], [17, 'dix-sept'], [21, 'vingt et un'], [71, 'soixante et onze'], [80, 'quatre-vingts'], [81, 'quatre-vingt-un'],
    [91, 'quatre-vingt-onze'], [100, 'cent'], [200, 'deux cents'], [201, 'deux cent un'], [1000, 'mille'], [2000, 'deux mille'],
    [200000, 'deux cent mille'], [1250000, 'un million deux cent cinquante mille'], [2000000000, 'deux milliards'],
    [3400980, 'trois millions quatre cent mille neuf cent quatre-vingts'],
  ])('%i', (n, words) => {
    expect(amountInFrenchWords(n as number)).toBe(`${words} francs CFA`);
  });
});
