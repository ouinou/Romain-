import type { Identite } from "../../composants/IdentiteEntreprise";
import { api } from "../../api";

export interface CompteTresorerie {
  id: string; type: "cash" | "bank" | "mobile"; nom: string; banque: string | null; referenceBancaire: string | null; actif: boolean;
  compte: { numero: string; libelle: string }; journal: string; solde: number; entreesJour: number; sortiesJour: number; caissiers: { id: string; nom: string }[];
}
export interface Mouvement {
  id: string; compte: { id: string; nom: string; type: string }; sens: "entree" | "sortie"; nature: string; montant: number; tva: number; date: string;
  reference: string; libelle: string; categorie: string | null; contrepartie: { numero: string; libelle: string }; factureId: string | null; facture: string | null;
  annulationDe: string | null; annuleePar: string | null; motif: string | null; auteur: string; creeLe: string;
  ecriture: { id: string; statut: "brouillard" | "validee"; numero: number | null } | null;
  /** Identité de l'entreprise figée le jour de l'opération (null : mouvement antérieur à la version 0.3). */
  emetteur: Identite | null;
}
export interface Categorie { code: string; libelle: string; compte: string; tva: boolean }

export const TYPES_TRESORERIE: Record<string, string> = { cash: "Caisse", bank: "Banque", mobile: "Mobile money" };
export const ICONES_TRESORERIE: Record<string, string> = { cash: "◫", bank: "⌂", mobile: "◱" };
export const NATURES: Record<string, string> = {
  receipt: "Encaissement", expense: "Dépense", transfer: "Transfert", invoice_payment: "Règlement de facture", reversal: "Annulation", credit_refund: "Remboursement d'avoir",
};
export const comptesTresorerie = () => api.get<CompteTresorerie[]>("/api/tresorerie/comptes");
