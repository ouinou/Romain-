import { api } from "../../api";
import { useDonnees } from "../../composants/ui";

/** Types et petits composants communs aux écrans de la pharmacie (catalogue, lots, stock, inventaires). */
export interface Produit {
  id: string; code: string; codeBarres: string | null; nom: string; dci: string | null;
  categorieId: string | null; categorie: string | null; formeId: string | null; forme: string | null;
  dosage: string | null; presentation: string | null; fabricant: string | null; fournisseur: string | null;
  prixAchat: number; prixVente: number; tauxTvaPdm: number; seuil: number; conservation: string | null; categorieDelivrance: string | null;
  statut: "active" | "suspended" | "archived"; statutLibelle: string;
  stock: { vendable: number; total: number; prochainePeremption: string | null };
  alerte: "rupture" | "seuil" | null;
  historiquePrix?: { prixAchat: number; prixVente: number; tauxTvaPdm: number; le: string; par: string }[];
}
export interface Lot {
  id: string; produitId: string; produit: string; codeProduit: string; numero: string; peremption: string; joursRestants: number;
  fournisseur: string | null; recuLe: string; prixAchat: number; emplacementId: string | null; emplacement: string | null; quantite: number;
  statut: "available" | "blocked" | "recalled"; statutLibelle: string; motifStatut: string | null;
  etat: "ok" | "proche" | "perime" | "blocked" | "recalled"; vendable: boolean;
  mouvements?: (Mouvement & { solde: number })[];
}
export interface Mouvement {
  id: string; numero: string; date: string; nature: string; natureLibelle: string; quantite: number;
  lotId: string; lot: string; produitId: string; produit: string; motif: string | null; inventaire: string | null; auteur: string;
}
export interface Categorie { id: string; nom: string; archivee: boolean; produits: number; familles: Categorie[] }
export interface Element { id: string; nom: string; archive: boolean; nature?: string; natureLibelle?: string }
export interface Parametres { delaiAlertePeremption: number; tauxTva: { libelle: string; tauxPdm: number }[] }

export const formatMontant = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
export const Montant = ({ v }: { v: number }) => <span className="num">{formatMontant(v)}</span>;
export const dateFr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
export const tauxTexte = (pdm: number) => (pdm ? `${(pdm / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : "Non soumis");
export const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** État d'un lot, en texte et en couleur (jamais la couleur seule). */
export function BadgeLot({ l }: { l: Pick<Lot, "etat" | "joursRestants" | "statutLibelle"> }) {
  switch (l.etat) {
    case "perime": return <span className="badge badge-rouge">Périmé</span>;
    case "proche": return <span className="badge badge-orange">Périme dans {l.joursRestants} j</span>;
    case "blocked": case "recalled": return <span className="badge badge-rouge">{l.statutLibelle}</span>;
    default: return <span className="badge badge-vert">Disponible</span>;
  }
}
export function BadgeStock({ p }: { p: Pick<Produit, "alerte" | "statut" | "statutLibelle"> }) {
  if (p.statut !== "active") return <span className="badge badge-neutre">{p.statutLibelle}</span>;
  if (p.alerte === "rupture") return <span className="badge badge-rouge">Rupture</span>;
  if (p.alerte === "seuil") return <span className="badge badge-orange">Sous le seuil</span>;
  return <span className="badge badge-vert">En stock</span>;
}

/** Référentiels utilisés par plusieurs écrans (listes de choix). */
export function useReferentiels() {
  const r = useDonnees(async () => {
    const [categories, formes, emplacements, parametres] = await Promise.all([
      api.get<Categorie[]>("/api/referentiels/categories"), api.get<Element[]>("/api/referentiels/formes"),
      api.get<Element[]>("/api/referentiels/emplacements"), api.get<Parametres>("/api/parametres-pharmacie"),
    ]);
    return { categories, formes, emplacements, parametres };
  }, []);
  return r;
}

/** Options « Catégorie » et « Catégorie › Famille » pour un menu déroulant (éléments archivés exclus). */
export const optionsCategories = (cats: Categorie[]): [string, string][] =>
  cats.filter((c) => !c.archivee).flatMap((c) => [[c.id, c.nom] as [string, string], ...c.familles.filter((f) => !f.archivee).map((f) => [f.id, `${c.nom} › ${f.nom}`] as [string, string])]);
