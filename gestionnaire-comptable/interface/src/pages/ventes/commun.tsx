export interface Facture {
  id: string; numero: string; date: string; type: string; typeLibelle: string;
  client: { id: string | null; nom: string; niu: string | null; adresse: string | null; telephone: string | null };
  vendeur: { raisonSociale: string; niu: string | null; rccm: string | null; adresse: string | null; telephone: string | null };
  devise: string; tauxTvaPdm: number;
  lignes: { ordre: number; designation: string; quantite: number; prixUnitaire: number; montant: number; nature: string }[];
  totalHt: number; totalTva: number; totalTtc: number; paye: number; reste: number; statutPaiement: "payee" | "partielle" | "impayee";
  paiement: "comptant" | "credit"; tresorerie: string | null; note: string | null;
  reglements: { id: string; date: string; montant: number; reference: string; compte: string; nature: string }[];
  ecriture: { id: string; statut: string; numero: number | null } | null; auteur: string; creeLe: string;
}
export interface FactureResume { id: string; numero: string; date: string; type: string; client: string; totalHt: number; totalTva: number; totalTtc: number; paye: number; reste: number; statutPaiement: string; paiement: string; auteur: string }

export function BadgePaiement({ s }: { s: string }) {
  return s === "payee" ? <span className="badge badge-vert">Payée</span> : s === "partielle" ? <span className="badge badge-orange">Partiellement payée</span> : <span className="badge badge-rouge">À encaisser</span>;
}
export const tauxTexte = (pdm: number) => (pdm / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";
