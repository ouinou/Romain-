import { describe, expect, it } from 'vitest';
import { computeFields, csvCell, recordSchema, MODULE_DEFS } from '../../src/modules/definitions.js';

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
    expect(computeFields('invoices', { 'Quantité': 3, 'Prix unitaire (FCFA)': 125000, 'Taxe (%)': 18 })).toEqual({ totalHT: 375000, tax: 67500, totalTTC: 442500 });
    expect(computeFields('invoices', { 'Quantité': 2, 'Prix unitaire (FCFA)': 1000 })).toEqual({ totalHT: 2000, tax: 0, totalTTC: 2000 });
  });
  it('neutralise l’injection de formules CSV', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+33 6')).toBe(`"'+33 6"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('Normal')).toBe('"Normal"');
    expect(csvCell(undefined)).toBe('""');
  });
});
