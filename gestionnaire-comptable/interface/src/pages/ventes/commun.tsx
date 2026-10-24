export interface Facture {
  id: string; numero: string; date: string; type: string; typeLibelle: string;
  client: { id: string | null; nom: string; niu: string | null; adresse: string | null; telephone: string | null };
  vendeur: { raisonSociale: string; niu: string | null; rccm: string | null; adresse: string | null; telephone: string | null;
    email?: string | null; regimeFiscal?: string | null; patente?: string | null; logoUrl?: string | null; couleurs?: { principale: string; accent: string } };
  /** Contenu du code QR : code de vérification signé par le serveur. */
  codeVerification?: string;
  devise: string; tauxTvaPdm: number;
  lignes: { ordre: number; designation: string; quantite: number; prixUnitaire: number; montant: number; nature: string; quantiteCreditee: number; montantCredite: number }[];
  totalHt: number; totalTva: number; totalTtc: number; paye: number; totalAvoirs: number; tvaAvoirs: number; reste: number; statutPaiement: "payee" | "partielle" | "impayee" | "annulee";
  avoirs: { id: string; numero: string; date: string; totalTtc: number; motif: string }[];
  paiement: "comptant" | "credit"; tresorerie: string | null; note: string | null;
  reglements: { id: string; date: string; montant: number; reference: string; compte: string; nature: string }[];
  ecriture: { id: string; statut: string; numero: number | null } | null; auteur: string; creeLe: string;
}
export interface FactureResume { id: string; numero: string; date: string; type: string; client: string; totalHt: number; totalTva: number; totalTtc: number; paye: number; totalAvoirs: number; reste: number; statutPaiement: string; paiement: string; auteur: string; creeLe: string }

/** Avoir : annulation totale ou partielle d'une facture émise. */
export interface Avoir {
  id: string; numero: string; date: string; motif: string;
  facture: { id: string; numero: string; date: string };
  client: Facture["client"]; vendeur: Facture["vendeur"]; devise: string; tauxTvaPdm: number; codeVerification?: string;
  lignes: { ordre: number; ligneFacture: number; designation: string; quantite: number; prixUnitaire: number; montant: number }[];
  totalHt: number; totalTva: number; totalTtc: number;
  remboursement: { mouvementId: string; montant: number; reference: string; compte: string } | null;
  ecriture: { id: string; statut: string; numero: number | null } | null; auteur: string; creeLe: string;
}
export interface AvoirResume { id: string; numero: string; date: string; motif: string; facture: { id: string; numero: string }; client: string; totalHt: number; totalTva: number; totalTtc: number; rembourse: number; auteur: string; creeLe: string }

export function BadgePaiement({ s }: { s: string }) {
  if (s === "annulee") return <span className="badge">Annulée par avoir</span>;
  return s === "payee" ? <span className="badge badge-vert">Payée</span> : s === "partielle" ? <span className="badge badge-orange">Partiellement payée</span> : <span className="badge badge-rouge">À encaisser</span>;
}
export const tauxTexte = (pdm: number) => (pdm / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";
