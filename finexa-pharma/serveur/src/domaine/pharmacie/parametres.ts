import { z } from "zod";
import type { Client } from "../../db.js";

/**
 * Paramètres propres à l'officine (companies.settings.pharmacie). Aucun taux de TVA n'est écrit dans le code :
 * la pharmacie saisit ceux qui s'appliquent à ses produits, d'après la réglementation en vigueur.
 */
export const DELAI_PEREMPTION_DEFAUT = 90;   // jours ; proposition, réglable par l'officine
export const SCHEMA_PARAMETRES = z.object({
  delaiAlertePeremption: z.number().int().min(1, "Au moins 1 jour.").max(730, "Au plus 730 jours.").optional(),
  tauxTva: z.array(z.object({
    libelle: z.string().trim().min(2, "Libellé du taux manquant.").max(40),
    tauxPdm: z.number().int().min(0).max(10000),   // pour dix mille : 1925 = 19,25 %
  })).max(10).optional(),
});
export type Parametres = { delaiAlertePeremption: number; tauxTva: { libelle: string; tauxPdm: number }[] };

export const parametresDe = (settings: any): Parametres => {
  const p = settings?.pharmacie ?? {};
  return {
    delaiAlertePeremption: Number.isInteger(p.delaiAlertePeremption) ? p.delaiAlertePeremption : DELAI_PEREMPTION_DEFAUT,
    // « Non soumis » est toujours proposé : un produit sans TVA ne demande aucun paramétrage.
    tauxTva: Array.isArray(p.tauxTva) ? p.tauxTva : [],
  };
};

export async function lireParametres(c: Client, entrepriseId: string) {
  const { rows: [e] } = await c.query("SELECT settings FROM companies WHERE id = $1", [entrepriseId]);
  return parametresDe(e?.settings);
}
