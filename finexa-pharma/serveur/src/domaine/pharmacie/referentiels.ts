import type { Client } from "../../db.js";

/**
 * Référentiels proposés à la création d'une officine. Ce sont des points de départ courants, sans portée
 * réglementaire : la pharmacie les renomme, les archive ou en ajoute.
 */
export const FORMES_DEPART = ["Comprimé", "Gélule", "Sirop", "Solution buvable", "Solution injectable", "Pommade ou crème", "Suppositoire", "Collyre", "Sachet", "Autre"];
export const EMPLACEMENTS_DEPART: [string, string][] = [["Rayon principal", "shelf"], ["Réserve", "reserve"], ["Réfrigérateur", "cold"]];
export const CATEGORIES_DEPART = ["Médicaments", "Parapharmacie", "Matériel médical"];

export async function initialiserReferentiels(c: Client) {
  for (const f of FORMES_DEPART) await c.query("INSERT INTO dosage_forms (name) VALUES ($1)", [f]);
  for (const [n, k] of EMPLACEMENTS_DEPART) await c.query("INSERT INTO storage_locations (name, kind) VALUES ($1, $2)", [n, k]);
  for (const n of CATEGORIES_DEPART) await c.query("INSERT INTO categories (name) VALUES ($1)", [n]);
}
