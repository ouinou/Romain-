/**
 * Trésorerie et ventes SIMULÉES pour la démonstration hors serveur : caisses, mouvements, factures, clients.
 * Reprend les règles visibles du vrai serveur (caisse jamais négative, caisse attitrée, numérotation des factures,
 * écritures générées en brouillard, avoirs plafonnés à ce qui a été facturé), en mémoire et sans aucune garantie.
 * Les vraies règles sont dans PostgreSQL (migrations 005 et 007).
 */
import { brouillonsGeneres, comptesProtegesPour, etatEcriture, genererEcriture, lignesEcriture, validerEcritureDemo } from "./comptabilite-simulee";

type Q = URLSearchParams;
interface Outils {
  exiger: (perm: string | null, sensible?: boolean) => void;
  tracer: (e: { type: string; action: string; resultat?: "success" | "denied" | "failure"; objetType?: string; objetId?: string; motif?: string; details?: Record<string, unknown> }) => void;
  motif: (c: any) => string;
  permissions: () => Set<string>;
  moi: () => { id: string; nom: string };
  nomDe: (id: string | null) => string | null;
  page: <T>(l: T[], q: Q) => { elements: T[]; total: number; page: number; taille: number };
  erreur: (s: number, code: string, message: string) => unknown;
  utilisateurs: () => { id: string; nom: string; actif: boolean; permissions: Set<string> }[];
  entreprise: () => { raisonSociale: string; niu: string | null; rccm: string | null; adresse: string | null; telephone: string | null; devise: string;
    email: string | null; regimeFiscal: string | null; patente: string | null; couleurs: { principale: string; accent: string }; logoId: string | null; logoUrl: string | null; code: string };
}

interface CompteT { id: string; type: "cash" | "bank" | "mobile"; nom: string; banque: string | null; referenceBancaire: string | null; actif: boolean; numero: string; journal: string; caissiers: string[] }
interface Mvt {
  id: string; compteId: string; sens: "entree" | "sortie"; nature: string; montant: number; tva: number; date: string; reference: string; libelle: string;
  categorie: string | null; contrepartie: string; factureId: string | null; annulationDe: string | null; motif: string | null; auteur: string; creeLe: string;
  ecritureId: string | null; groupe: string | null; avoirId?: string | null;
}
interface Fac {
  id: string; numero: string; date: string; type: "goods" | "services" | "mixed"; client: { id: string | null; nom: string; niu: string | null; adresse: string | null; telephone: string | null };
  vendeur: ReturnType<Outils["entreprise"]>; devise: string; tauxTvaPdm: number; lignes: { ordre: number; designation: string; quantite: number; prixUnitaire: number; montant: number; nature: string }[];
  totalHt: number; totalTva: number; totalTtc: number; paiement: "comptant" | "credit"; tresorerie: string | null; note: string | null; auteur: string; creeLe: string; ecritureId: string | null;
}
interface Av {
  id: string; numero: string; date: string; motif: string; factureId: string; vendeur: Fac["vendeur"]; tauxTvaPdm: number;
  lignes: { ordre: number; ligneFacture: number; quantite: number; montant: number }[]; totalHt: number; totalTva: number; totalTtc: number;
  auteur: string; creeLe: string; ecritureId: string | null;
}
interface Client { id: string; nom: string; niu: string | null; telephone: string | null; email: string | null; adresse: string | null }

const TYPES_FACTURE = { goods: "Vente de marchandises", services: "Prestation de services", mixed: "Vente et prestation" };
const LIB: Record<string, string> = { "411": "Clients", "707": "Produits accessoires", "101": "Capital social", "162": "Emprunts et dettes auprès des établissements de crédit",
  "605": "Autres achats", "601": "Achats de marchandises", "618": "Autres frais de transport", "622": "Locations et charges locatives", "624": "Entretien, réparations et maintenance",
  "625": "Primes d'assurance", "627": "Publicité, publications, relations publiques", "628": "Frais de télécommunications", "631": "Frais bancaires",
  "632": "Rémunérations d'intermédiaires et de conseils", "641": "Impôts et taxes directs", "401": "Fournisseurs, dettes en compte", "661": "Rémunérations directes versées au personnel national",
  "5711": "Caisse principale", "5211": "Banque fictive", "5212": "Mobile money (fictif)" };
// Mêmes catégories que serveur/src/domaine/tresorerie/categories.ts (comptes À VÉRIFIER, voir docs/COMPTABILITE.md).
const ENTREES = [["encaissement_client", "Règlement d'un client (facture à crédit)", "411"], ["autre_produit", "Autre recette (produits accessoires)", "707"], ["apport", "Apport en capital", "101"], ["emprunt", "Emprunt bancaire reçu", "162"]];
const SORTIES = [["fournitures", "Fournitures et petits achats", "605", 1], ["marchandises", "Achat de marchandises", "601", 1], ["transport", "Transport et déplacements", "618", 1],
  ["loyer", "Loyer et charges locatives", "622", 1], ["entretien", "Entretien et réparations", "624", 1], ["assurance", "Assurance", "625", 0], ["publicite", "Publicité", "627", 1],
  ["telephone", "Téléphone et Internet", "628", 1], ["frais_bancaires", "Frais bancaires", "631", 0], ["honoraires", "Honoraires et conseils", "632", 1], ["impots", "Impôts et taxes", "641", 0],
  ["fournisseur", "Règlement d'un fournisseur", "401", 0], ["salaires", "Salaires versés", "661", 0]] as const;

let n = 0;
const uid = () => `demo-t${++n}-${Math.random().toString(16).slice(2, 8)}`;
const AN = new Date().getFullYear();
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const comptesT: CompteT[] = [];
const mouvements: Mvt[] = [];
const factures: Fac[] = [];
const avoirs: Av[] = [];
const clients: Client[] = [
  { id: uid(), nom: "Établissements Fictifs Mbarga", niu: "P000000000001X (fictif)", telephone: "+237 600 00 00 01", email: null, adresse: "Douala, Akwa (fictif)" },
  { id: uid(), nom: "Cabinet Démo Ndjamena", niu: null, telephone: null, email: "contact@demo.cm", adresse: "N'Djamena (fictif)" },
];
let fiscal = { tvaApplicable: true, tauxTvaPdm: 1925, mentionsFacture: "Document de démonstration : données fictives, taux de TVA à vérifier." };
let seqMvt = 0, seqFac = 0, seqAv = 0;

const solde = (id: string) => mouvements.filter((m) => m.compteId === id).reduce((s, m) => s + (m.sens === "entree" ? m.montant : -m.montant), 0);
const avoirsDe = (f: Fac) => avoirs.filter((x) => x.factureId === f.id);
const totalAvoirs = (f: Fac) => avoirsDe(f).reduce((s, x) => s + x.totalTtc, 0);
const qCreditee = (f: Fac, ordre: number) => Math.round(avoirsDe(f).flatMap((x) => x.lignes).filter((l) => l.ligneFacture === ordre).reduce((s, l) => s + l.quantite, 0) * 1000) / 1000;
const mCredite = (f: Fac, ordre: number) => avoirsDe(f).flatMap((x) => x.lignes).filter((l) => l.ligneFacture === ordre).reduce((s, l) => s + l.montant, 0);
const reste = (f: Fac) => f.totalTtc - totalAvoirs(f) - paye(f);
const paye = (f: Fac) => mouvements.filter((m) => m.factureId === f.id).reduce((s, m) => s + (m.sens === "entree" ? m.montant : -m.montant), 0);
/**
 * Code de vérification de DÉMONSTRATION : même format que le vrai, mais « signé » par une simple empreinte
 * (FNV-1a), sans aucune valeur cryptographique. Le vrai serveur signe en Ed25519 (domaine/ventes/signature.ts).
 */
function empreinteDemo(m: string) {
  let out = "";
  for (let tour = 0; out.length < 86; tour++) {
    let h = 0x811c9dc5 ^ tour;
    for (let i = 0; i < m.length; i++) { h ^= m.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    out += h.toString(36).padStart(7, "0");
  }
  return out.slice(0, 86).replace(/[^A-Za-z0-9]/g, "A");
}
const codeDemo = (code: string, f: { numero: string; date: string; totalTtc: number; devise: string }) => {
  const m = ["GC1", code, f.numero, f.date, String(f.totalTtc), f.devise].join(";");
  return `${m};${empreinteDemo(m)}`;
};
const tva = (ht: number, pdm: number) => Number((BigInt(ht) * BigInt(pdm) + 5000n) / 10000n);

export function initialiserTresorerie(ids: Record<string, string>, vendeur: Fac["vendeur"]) {
  if (comptesT.length) return;
  const caisse: CompteT = { id: uid(), type: "cash", nom: "Caisse principale", banque: null, referenceBancaire: null, actif: true, numero: "5711", journal: "CA", caissiers: [ids["amina.mahamat@demo.cm"]] };
  comptesT.push(caisse,
    { id: uid(), type: "bank", nom: "Banque fictive", banque: "Banque de démonstration", referenceBancaire: null, actif: true, numero: "5211", journal: "BQ", caissiers: [] },
    { id: uid(), type: "mobile", nom: "Mobile money (fictif)", banque: "Opérateur fictif", referenceBancaire: null, actif: true, numero: "5212", journal: "BQ", caissiers: [] });
  const ousmane = ids["ousmane.djibrine@demo.cm"];
  const m: Mvt = { id: uid(), compteId: caisse.id, sens: "entree", nature: "receipt", montant: 100000, tva: 0, date: `${AN}-01-03`, reference: `MVT-${AN}-${String(++seqMvt).padStart(5, "0")}`,
    libelle: "Fonds de caisse initial", categorie: "apport", contrepartie: "101", factureId: null, annulationDe: null, motif: null, auteur: ousmane, creeLe: `${AN}-01-03T08:00:00Z`, ecritureId: null, groupe: null };
  m.ecritureId = genererEcriture("CA", m.date, m.reference, m.libelle, ousmane, { type: "mouvement", id: m.id, reference: m.reference }, [["5711", 100000, 0], ["101", 0, 100000]]);
  mouvements.push(m);
  historiqueVentes(ousmane, ids["joseph.atangana@demo.cm"], comptesT[1], vendeur);
}

/**
 * Historique FICTIF des cinq mois précédents (mêmes ventes que l'option de démonstration du setup), pour que le
 * graphique du tableau de bord ait des courbes. Encaissements sur la banque : la caisse de démonstration reste intacte.
 */
function historiqueVentes(auteur: string, validateur: string, banque: CompteT, vendeur: Fac["vendeur"]) {
  const MODELES: [number, number, string, "marchandise" | "service", number, number, boolean][][] = [
    [[4, 0, "Ramettes de papier A4", "marchandise", 40, 3500, true], [12, 1, "Maintenance informatique", "service", 1, 120000, true], [21, 0, "Cartouches d'encre", "marchandise", 12, 15000, true]],
    [[3, 1, "Audit de caisse", "service", 1, 250000, false], [10, 0, "Classeurs et chemises", "marchandise", 60, 1200, true], [18, 1, "Installation de poste", "service", 2, 35000, true], [26, 0, "Cartouches d'encre", "marchandise", 8, 15000, true]],
    [[5, 1, "Formation logiciel", "service", 1, 180000, true], [11, 0, "Ramettes de papier A4", "marchandise", 50, 3500, true], [19, 1, "Maintenance informatique", "service", 1, 120000, false], [27, 0, "Cartouches d'encre", "marchandise", 15, 15000, true]],
    [[2, 0, "Imprimante laser", "marchandise", 2, 145000, true], [9, 1, "Assistance comptable", "service", 1, 200000, true], [16, 0, "Ramettes de papier A4", "marchandise", 70, 3500, true], [23, 0, "Cartouches d'encre", "marchandise", 10, 15000, false], [28, 1, "Installation de poste", "service", 3, 35000, true]],
    [[3, 1, "Maintenance informatique", "service", 1, 120000, true], [8, 0, "Classeurs et chemises", "marchandise", 90, 1200, true], [15, 1, "Formation logiciel", "service", 1, 180000, false], [22, 0, "Cartouches d'encre", "marchandise", 20, 15000, true], [27, 0, "Imprimante laser", "marchandise", 1, 145000, true]],
  ];
  const maintenant = new Date();
  for (let k = 5; k >= 1; k--) {
    const d0 = new Date(maintenant.getFullYear(), maintenant.getMonth() - k, 1);
    if (d0.getFullYear() !== AN) continue;
    for (const [jour, cl, designation, nature, qte, pu, paye] of MODELES[5 - k]) {
      const date = `${AN}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
      const ht = qte * pu, totalTva = tva(ht, 1925), ttc = ht + totalTva;
      const client = clients[cl];
      const f: Fac = { id: uid(), numero: `FAC-${AN}-${String(++seqFac).padStart(5, "0")}`, date, type: nature === "service" ? "services" : "goods",
        client: { id: client.id, nom: client.nom, niu: client.niu, adresse: client.adresse, telephone: client.telephone }, vendeur: { ...vendeur }, devise: "XAF", tauxTvaPdm: 1925,
        lignes: [{ ordre: 1, designation, quantite: qte, prixUnitaire: pu, montant: ht, nature }], totalHt: ht, totalTva, totalTtc: ttc,
        paiement: paye ? "comptant" : "credit", tresorerie: paye ? banque.nom : null, note: null, auteur, creeLe: `${date}T10:00:00Z`, ecritureId: null };
      const libelle = `Facture ${f.numero} : ${client.nom}`;
      f.ecritureId = genererEcriture("VT", date, f.numero, libelle, auteur, { type: "facture", id: f.id, reference: f.numero },
        [["411", ttc, 0], [nature === "service" ? "706" : "701", 0, ht], ["443", 0, totalTva]]);
      validerEcritureDemo(f.ecritureId, validateur);
      factures.push(f);
      const montant = paye ? ttc : Math.floor(ttc / 2);
      const dateReg = paye ? date : `${date.slice(0, 8)}${String(Math.min(jour + 10, 28)).padStart(2, "0")}`;
      const mv: Mvt = { id: uid(), compteId: banque.id, sens: "entree", nature: "invoice_payment", montant, tva: 0, date: dateReg, reference: f.numero, libelle: `Règlement ${libelle}`,
        categorie: "encaissement_client", contrepartie: "411", factureId: f.id, annulationDe: null, motif: null, auteur, creeLe: `${dateReg}T11:00:00Z`, ecritureId: null, groupe: null };
      mv.ecritureId = genererEcriture("BQ", dateReg, f.numero, `Règlement ${libelle}`, auteur, { type: "mouvement", id: mv.id, reference: mv.reference }, [["5211", montant, 0], ["411", 0, montant]]);
      validerEcritureDemo(mv.ecritureId, validateur);
      mouvements.push(mv);
    }
  }
}

export function traiterTresorerie(m: string, chemin: string, q: Q, c: any, o: Outils): unknown {
  const [, , mod, r1, r2, r3] = chemin.split("/");
  const perms = o.permissions(), a = (p: string) => perms.has(p), moi = o.moi();
  const masque = comptesProtegesPour(perms);
  const toutVoir = a("treasury.read");
  const visible = (t: CompteT) => toutVoir || (t.type === "cash" && t.caissiers.includes(moi.id));
  const lecture = () => { o.exiger(null); if (!a("treasury.read") && !a("cash.read")) { o.exiger("treasury.read"); } };
  const utilisable = (idC: string) => {
    const t = comptesT.find((x) => x.id === idC);
    if (!t) throw o.erreur(404, "introuvable", "Compte de trésorerie introuvable.");
    if (!(a("treasury.create") || (t.type === "cash" && t.caissiers.includes(moi.id) && a("cash.create")))) {
      o.tracer({ type: "security", action: "access_denied", resultat: "denied", objetType: "treasury_account", objetId: idC });
      throw o.erreur(403, "acces_refuse", `Vous n'êtes pas autorisé à enregistrer des opérations sur « ${t.nom} ».`);
    }
    if (!t.actif) throw o.erreur(409, "compte_inactif", `Le compte de trésorerie « ${t.nom} » est désactivé.`);
    return t;
  };
  const vueMvt = (x: Mvt) => {
    const t = comptesT.find((y) => y.id === x.compteId)!;
    return { id: x.id, compte: { id: t.id, nom: t.nom, type: t.type }, sens: x.sens, nature: x.nature, montant: x.montant, tva: x.tva, date: x.date, reference: x.reference, libelle: x.libelle,
      categorie: x.categorie, contrepartie: { numero: x.contrepartie, libelle: LIB[x.contrepartie] ?? comptesT.find((y) => y.numero === x.contrepartie)?.nom ?? "" },
      factureId: x.factureId, facture: factures.find((f) => f.id === x.factureId)?.numero ?? null, annulationDe: x.annulationDe,
      annuleePar: mouvements.find((y) => y.annulationDe === x.id)?.id ?? null, motif: x.motif, auteur: o.nomDe(x.auteur), creeLe: x.creeLe, ecriture: etatEcriture(x.ecritureId) };
  };
  const inserer = (x: Omit<Mvt, "id" | "creeLe" | "auteur" | "ecritureId">) => {
    const t = comptesT.find((y) => y.id === x.compteId)!;
    if (t.type === "cash" && x.sens === "sortie" && x.montant > solde(t.id))
      throw o.erreur(409, "regle_comptable", `Solde de caisse insuffisant : ${solde(t.id)} FCFA disponibles, ${x.montant} demandés.`);
    const mv: Mvt = { ...x, id: uid(), reference: x.reference || `MVT-${x.date.slice(0, 4)}-${String(++seqMvt).padStart(5, "0")}`, auteur: moi.id, creeLe: new Date().toISOString(), ecritureId: null };
    mouvements.push(mv);
    return mv;
  };
  const vueFacture = (f: Fac) => {
    const p = paye(f), av = totalAvoirs(f);
    return { id: f.id, numero: f.numero, date: f.date, type: f.type, typeLibelle: TYPES_FACTURE[f.type], client: f.client, vendeur: f.vendeur, devise: f.devise, tauxTvaPdm: f.tauxTvaPdm,
      lignes: f.lignes.map((l) => ({ ...l, quantiteCreditee: qCreditee(f, l.ordre), montantCredite: mCredite(f, l.ordre) })),
      totalHt: f.totalHt, totalTva: f.totalTva, totalTtc: f.totalTtc, paye: p, totalAvoirs: av, tvaAvoirs: avoirsDe(f).reduce((s, x) => s + x.totalTva, 0), reste: f.totalTtc - av - p,
      statutPaiement: av >= f.totalTtc ? "annulee" : p + av >= f.totalTtc ? "payee" : p > 0 ? "partielle" : "impayee",
      avoirs: avoirsDe(f).map((x) => ({ id: x.id, numero: x.numero, date: x.date, totalTtc: x.totalTtc, motif: x.motif })), paiement: f.paiement, tresorerie: f.tresorerie, note: f.note,
      reglements: mouvements.filter((x) => x.factureId === f.id).map((x) => ({ id: x.id, date: x.date, montant: (x.sens === "entree" ? 1 : -1) * x.montant, reference: x.reference, compte: comptesT.find((t) => t.id === x.compteId)!.nom, nature: x.nature })),
      ecriture: etatEcriture(f.ecritureId), auteur: o.nomDe(f.auteur), creeLe: f.creeLe, codeVerification: codeDemo(o.entreprise().code, f) };
  };
  const vueAvoir = (x: Av) => {
    const f = factures.find((y) => y.id === x.factureId)!, mv = mouvements.find((y) => y.avoirId === x.id);
    return { id: x.id, numero: x.numero, date: x.date, motif: x.motif, facture: { id: f.id, numero: f.numero, date: f.date }, client: f.client, vendeur: x.vendeur, devise: "XAF", tauxTvaPdm: x.tauxTvaPdm,
      lignes: x.lignes.map((l) => { const il = f.lignes.find((y) => y.ordre === l.ligneFacture)!; return { ...l, designation: il.designation, prixUnitaire: il.prixUnitaire }; }),
      totalHt: x.totalHt, totalTva: x.totalTva, totalTtc: x.totalTtc,
      remboursement: mv ? { mouvementId: mv.id, montant: mv.montant, reference: mv.reference, compte: comptesT.find((t) => t.id === mv.compteId)!.nom } : null,
      ecriture: etatEcriture(x.ecritureId), auteur: o.nomDe(x.auteur), creeLe: x.creeLe, codeVerification: codeDemo(o.entreprise().code, { ...x, devise: "XAF" }) };
  };
  const montantOk = (v: unknown) => { if (!Number.isInteger(v) || (v as number) <= 0) throw o.erreur(400, "donnees_invalides", "Montant entier positif attendu (FCFA)."); return v as number; };

  if (mod === "tableau-de-bord" && r1 === "evolution") {
    const voitVentes = a("sales.read"), voitTreso = a("treasury.read") || a("cash.read");
    if (!voitVentes && !voitTreso) { o.exiger("sales.read"); }
    const n = Math.min(24, Math.max(2, Number(q.get("mois") ?? 6) || 6)), maintenant = new Date();
    const mois = Array.from({ length: n }, (_, i) => { const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - (n - 1 - i), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
    const serie = (lignes: [string, number][]) => mois.map((m) => lignes.filter(([d]) => d.startsWith(m)).reduce((t, [, v]) => t + v, 0));
    const ventes = voitVentes ? serie([...factures.map((f) => [f.date, f.totalTtc] as [string, number]), ...avoirs.map((x) => [x.date, -x.totalTtc] as [string, number])]) : null;
    const encaissements = voitTreso ? serie(mouvements.filter((x) => visible(comptesT.find((t) => t.id === x.compteId)!)).map((x) => {
      if (x.sens === "entree" && (x.nature === "receipt" || x.nature === "invoice_payment")) return [x.date, x.montant] as [string, number];
      if (x.nature === "credit_refund") return [x.date, -x.montant] as [string, number];
      const o2 = x.nature === "reversal" ? mouvements.find((y) => y.id === x.annulationDe) : null;
      return [x.date, x.sens === "sortie" && o2 && (o2.nature === "receipt" || o2.nature === "invoice_payment") ? -x.montant
        : x.sens === "entree" && o2?.nature === "credit_refund" ? x.montant : 0] as [string, number];
    })) : null;
    return { mois, ventes, encaissements };
  }

  if (mod === "ventes") {
    if (r1 === "parametres") {
      if (m === "PATCH") {
        o.exiger("accounting.admin", true);
        if (c.tvaApplicable && !c.tauxTvaPdm) throw o.erreur(400, "taux_tva", "Indiquez le taux de TVA applicable.");
        fiscal = { tvaApplicable: !!c.tvaApplicable, tauxTvaPdm: c.tvaApplicable ? Number(c.tauxTvaPdm) : 0, mentionsFacture: String(c.mentionsFacture ?? "") };
        o.tracer({ type: "security", action: "fiscal_settings_change" }); return { ok: true };
      }
      o.exiger("sales.read");
      return { ...fiscal, tauxTvaPdm: fiscal.tvaApplicable ? fiscal.tauxTvaPdm : 0, devise: "XAF" };
    }
    if (r1 === "clients") {
      if (m === "POST") {
        o.exiger("sales.create");
        if (!c.nom || String(c.nom).trim().length < 2) throw o.erreur(400, "donnees_invalides", "Nom du client obligatoire.");
        const cl = { id: uid(), nom: String(c.nom).trim(), niu: c.niu || null, telephone: c.telephone || null, email: c.email || null, adresse: c.adresse || null };
        clients.push(cl); o.tracer({ type: "sales", action: "customer_create", objetType: "customer", objetId: cl.id }); return { id: cl.id, nom: cl.nom };
      }
      o.exiger("sales.read");
      const r = (q.get("recherche") ?? "").toLowerCase();
      return clients.filter((x) => !r || [x.nom, x.telephone, x.niu].some((v) => v?.toLowerCase().includes(r))).sort((x, y) => x.nom.localeCompare(y.nom))
        .map((x) => ({ ...x, factures: factures.filter((f) => f.client.id === x.id).length }));
    }
    if (r1 === "verification") {
      o.exiger("sales.read");
      const p = String(c.contenu ?? "").trim().split(";");
      if (!c.contenu || !String(c.contenu).trim()) throw o.erreur(400, "donnees_invalides", "Scannez ou collez le code de la facture.");
      const code = o.entreprise().code;
      let rep: Record<string, unknown>;
      if (p.length !== 7 || p[0] !== "GC1") rep = { authentique: false, raison: "Ce code n'est pas un code de facture Gestionnaire Comptable." };
      else if (p[1] !== code) rep = { authentique: false, raison: `Cette facture a été émise par une autre entreprise (code ${p[1]}). Elle ne peut être vérifiée que par celle-ci.` };
      else if (empreinteDemo(p.slice(0, 6).join(";")) !== p[6]) rep = { authentique: false, raison: "Signature invalide : le numéro, la date ou le montant ont été modifiés, ou le code est un faux." };
      else if (p[2].startsWith("AV-")) {
        const x = avoirs.find((y) => y.numero === p[2]), f = x && factures.find((y) => y.id === x.factureId)!;
        rep = !x || !f ? { authentique: false, raison: `Signature valide, mais l'avoir ${p[2]} est absent de la base.` }
          : x.date !== p[3] || String(x.totalTtc) !== p[4] ? { authentique: false, raison: `L'avoir ${p[2]} existe, mais sa date ou son montant ne correspondent pas au code.` }
          : { authentique: true, avoir: { id: x.id, numero: x.numero, date: x.date, facture: f.numero, client: f.client.nom, totalTtc: x.totalTtc, devise: "XAF", auteur: o.nomDe(x.auteur), creeLe: x.creeLe } };
      } else {
        const f = factures.find((x) => x.numero === p[2]);
        rep = !f ? { authentique: false, raison: `Signature valide, mais la facture ${p[2]} est absente de la base.` }
          : f.date !== p[3] || String(f.totalTtc) !== p[4] ? { authentique: false, raison: `La facture ${p[2]} existe, mais sa date ou son montant ne correspondent pas au code.` }
          : { authentique: true, facture: { id: f.id, numero: f.numero, date: f.date, client: f.client.nom, totalTtc: f.totalTtc, devise: f.devise, statutPaiement: vueFacture(f).statutPaiement, auteur: o.nomDe(f.auteur), creeLe: f.creeLe } };
      }
      o.tracer({ type: "sales", action: "invoice_verify", resultat: rep.authentique ? "success" : "failure" });
      return rep;
    }
    if (r1 === "factures" && !r2 && m === "POST") {
      o.exiger("sales.create");
      const lignes = ((c.lignes ?? []) as { designation: string; quantite: number; prixUnitaire: number; nature: string }[]).map((l, i) => {
        if (!l.designation?.trim()) throw o.erreur(400, "donnees_invalides", "Désignation obligatoire.");
        if (!(l.quantite > 0) || Math.abs(Math.round(l.quantite * 1000) - l.quantite * 1000) > 1e-6) throw o.erreur(400, "quantite", `Quantité invalide pour « ${l.designation} » (3 décimales au plus).`);
        if (!Number.isInteger(l.prixUnitaire) || l.prixUnitaire < 0) throw o.erreur(400, "donnees_invalides", "Prix unitaire entier (FCFA).");
        return { ordre: i + 1, designation: l.designation.trim(), quantite: l.quantite, prixUnitaire: l.prixUnitaire, nature: l.nature,
          montant: Number((BigInt(Math.round(l.quantite * 1000)) * BigInt(l.prixUnitaire) + 500n) / 1000n) };
      });
      if (!lignes.length) throw o.erreur(400, "donnees_invalides", "Ajoutez au moins une ligne.");
      const totalHt = lignes.reduce((s, l) => s + l.montant, 0), pdm = fiscal.tvaApplicable ? fiscal.tauxTvaPdm : 0, totalTva = tva(totalHt, pdm), totalTtc = totalHt + totalTva;
      if (totalTtc <= 0) throw o.erreur(400, "montant_nul", "Le montant de la facture doit être positif.");
      const tresorerie = c.paiement?.mode === "comptant" ? utilisable(c.paiement.compteTresorerieId) : null;
      const cc = c.client ?? {};
      let client = { id: null as string | null, nom: cc.nom || "Client comptant", niu: cc.niu || null, adresse: cc.adresse || null, telephone: cc.telephone || null };
      if (cc.id) { const x = clients.find((y) => y.id === cc.id); if (!x) throw o.erreur(400, "client_inconnu", "Client introuvable."); client = { id: x.id, nom: x.nom, niu: x.niu, adresse: x.adresse, telephone: x.telephone }; }
      else if (cc.enregistrer && cc.nom) { const x = { id: uid(), nom: client.nom, niu: client.niu, telephone: client.telephone, email: null, adresse: client.adresse }; clients.push(x); client.id = x.id; }
      const natures = new Set(lignes.map((l) => l.nature));
      const date = String(c.date || aujourdhui());
      const f: Fac = { id: uid(), numero: `FAC-${date.slice(0, 4)}-${String(++seqFac).padStart(5, "0")}`, date, type: natures.size > 1 ? "mixed" : natures.has("service") ? "services" : "goods",
        client, vendeur: o.entreprise(), devise: "XAF", tauxTvaPdm: pdm, lignes, totalHt, totalTva, totalTtc, paiement: tresorerie ? "comptant" : "credit",
        tresorerie: tresorerie?.nom ?? null, note: c.note || null, auteur: moi.id, creeLe: new Date().toISOString(), ecritureId: null };
      const libelle = `Facture ${f.numero} : ${client.nom}`;
      const ventes = (nat: string) => lignes.filter((l) => l.nature === nat).reduce((s, l) => s + l.montant, 0);
      f.ecritureId = genererEcriture("VT", date, f.numero, libelle, moi.id, { type: "facture", id: f.id, reference: f.numero },
        [["411", totalTtc, 0], ["701", 0, ventes("marchandise")], ["706", 0, ventes("service")], ["443", 0, totalTva]]);
      factures.push(f);
      if (tresorerie) {
        const mv = inserer({ compteId: tresorerie.id, sens: "entree", nature: "invoice_payment", montant: totalTtc, tva: 0, date, reference: f.numero, libelle: `Règlement ${libelle}`.slice(0, 200),
          categorie: "encaissement_client", contrepartie: "411", factureId: f.id, annulationDe: null, motif: null, groupe: null });
        mv.ecritureId = genererEcriture(tresorerie.journal, date, f.numero, `Règlement ${libelle}`, moi.id, { type: "mouvement", id: mv.id, reference: mv.reference }, [[tresorerie.numero, totalTtc, 0], ["411", 0, totalTtc]]);
      }
      o.tracer({ type: "sales", action: "invoice_issue", objetType: "invoice", objetId: f.id, details: { numero: f.numero, totalTtc } });
      return vueFacture(f);
    }
    // Avoirs : mêmes règles visibles que le serveur (plafond par ligne, TVA restante sur l'avoir qui solde, remboursement limité au trop-perçu).
    if (r1 === "factures" && r2 && r3 === "avoirs" && m === "POST") {
      o.exiger("sales.cancel", true);
      const f = factures.find((x) => x.id === r2);
      if (!f) throw o.erreur(404, "introuvable", "Facture introuvable.");
      const motif = String(c.motif ?? "").trim(), date = String(c.date || aujourdhui());
      if (motif.length < 3) throw o.erreur(400, "donnees_invalides", "Indiquez le motif de l'avoir (retour de marchandise, erreur de prix…).");
      if (date < f.date) throw o.erreur(400, "date", "L'avoir ne peut pas être daté avant la facture.");
      const demandees = (c.lignes ?? []) as { ordre: number; quantite: number }[];
      if (!demandees.length) throw o.erreur(400, "donnees_invalides", "Choisissez au moins une ligne à créditer.");
      const lignes = demandees.map((d, i) => {
        const il = f.lignes.find((x) => x.ordre === d.ordre);
        if (!il) throw o.erreur(400, "ligne_inconnue", `La facture ${f.numero} n'a pas de ligne ${d.ordre}.`);
        const restant = Math.round((il.quantite - qCreditee(f, il.ordre)) * 1000) / 1000;
        if (!(d.quantite > 0) || d.quantite > restant + 1e-9) throw o.erreur(409, "trop_credite", `« ${il.designation} » : ${restant.toLocaleString("fr-FR")} au plus peut encore être crédité.`);
        const solde = Math.abs(d.quantite - restant) < 1e-9;
        return { ordre: i + 1, ligneFacture: il.ordre, quantite: d.quantite, montant: solde ? il.montant - mCredite(f, il.ordre) : Number((BigInt(Math.round(d.quantite * 1000)) * BigInt(il.prixUnitaire) + 500n) / 1000n), solde };
      });
      const totalHt = lignes.reduce((t, l) => t + l.montant, 0);
      const toutSolde = f.lignes.every((il) => lignes.some((l) => l.ligneFacture === il.ordre && l.solde) || qCreditee(f, il.ordre) >= il.quantite);
      const totalTva = toutSolde ? f.totalTva - avoirsDe(f).reduce((t, x) => t + x.totalTva, 0) : tva(totalHt, f.tauxTvaPdm), totalTtc = totalHt + totalTva;
      const trop = Math.min(totalTtc, paye(f) - (f.totalTtc - totalAvoirs(f) - totalTtc));
      const tresorerie = c.rembourser ? utilisable(c.rembourser.compteTresorerieId) : null;
      if (tresorerie && trop <= 0) throw o.erreur(409, "rien_a_rembourser", `Le client n'a rien payé au-delà de ce qu'il doit encore sur la facture ${f.numero} : l'avoir réduit simplement sa dette.`);
      if (tresorerie && tresorerie.type === "cash" && trop > solde(tresorerie.id)) throw o.erreur(409, "regle_comptable", `Solde de caisse insuffisant : ${solde(tresorerie.id)} FCFA disponibles, ${trop} demandés.`);
      const x: Av = { id: uid(), numero: `AV-${date.slice(0, 4)}-${String(++seqAv).padStart(5, "0")}`, date, motif, factureId: f.id, vendeur: o.entreprise(), tauxTvaPdm: f.tauxTvaPdm,
        lignes: lignes.map(({ solde: _, ...l }) => l), totalHt, totalTva, totalTtc, auteur: moi.id, creeLe: new Date().toISOString(), ecritureId: null };
      const libelle = `Avoir ${x.numero} sur ${f.numero} : ${f.client.nom}`;
      const ht = (nat: string) => lignes.filter((l) => f.lignes.find((il) => il.ordre === l.ligneFacture)!.nature === nat).reduce((t, l) => t + l.montant, 0);
      x.ecritureId = genererEcriture("VT", date, x.numero, libelle, moi.id, { type: "avoir", id: x.id, reference: x.numero },
        [["701", ht("marchandise"), 0], ["706", ht("service"), 0], ["443", totalTva, 0], ["411", 0, totalTtc]]);
      avoirs.push(x);
      if (tresorerie) {
        const mv = inserer({ compteId: tresorerie.id, sens: "sortie", nature: "credit_refund", montant: trop, tva: 0, date, reference: x.numero, libelle: `Remboursement ${libelle}`.slice(0, 200),
          categorie: "remboursement_client", contrepartie: "411", factureId: f.id, annulationDe: null, motif: null, groupe: null, avoirId: x.id });
        mv.ecritureId = genererEcriture(tresorerie.journal, date, x.numero, `Remboursement ${libelle}`, moi.id, { type: "mouvement", id: mv.id, reference: mv.reference }, [["411", trop, 0], [tresorerie.numero, 0, trop]]);
      }
      o.tracer({ type: "sales", action: "credit_note_issue", objetType: "credit_note", objetId: x.id, motif, details: { numero: x.numero, facture: f.numero, totalTtc } });
      return vueAvoir(x);
    }
    if (r1 === "avoirs") {
      o.exiger("sales.read");
      if (r2) {
        const x = avoirs.find((y) => y.id === r2);
        if (!x) throw o.erreur(404, "introuvable", "Avoir introuvable.");
        if (r3 === "pdf") throw o.erreur(404, "introuvable", "Démonstration : le PDF n'est produit que par le serveur installé.");
        return vueAvoir(x);
      }
      const r = (q.get("recherche") ?? "").toLowerCase(), du = q.get("du"), au = q.get("au");
      const l = avoirs.map(vueAvoir).filter((x) => (!r || `${x.numero} ${x.facture.numero} ${x.client.nom}`.toLowerCase().includes(r)) && (!du || x.date >= du) && (!au || x.date <= au))
        .sort((x, y) => y.numero.localeCompare(x.numero));
      const pg = o.page(l, q);
      return { ...pg, totalTtc: l.reduce((t, x) => t + x.totalTtc, 0), elements: pg.elements.map((x) => ({ id: x.id, numero: x.numero, date: x.date, motif: x.motif,
        facture: { id: x.facture.id, numero: x.facture.numero }, client: x.client.nom, totalHt: x.totalHt, totalTva: x.totalTva, totalTtc: x.totalTtc, rembourse: x.remboursement?.montant ?? 0, auteur: x.auteur, creeLe: x.creeLe })) };
    }
    if (r1 === "factures" && r2) {
      o.exiger("sales.read");
      const f = factures.find((x) => x.id === r2);
      if (!f) throw o.erreur(404, "introuvable", "Facture introuvable.");
      if (r3 === "pdf") throw o.erreur(404, "introuvable", "Démonstration : le PDF n'est produit que par le serveur installé.");
      return vueFacture(f);
    }
    if (r1 === "factures") {
      o.exiger("sales.read");
      const r = (q.get("recherche") ?? "").toLowerCase(), du = q.get("du"), au = q.get("au"), st = q.get("statut");
      const l = factures.filter((f) => (!r || (f.numero + " " + f.client.nom).toLowerCase().includes(r)) && (!du || f.date >= du) && (!au || f.date <= au)
        && (st !== "payee" || reste(f) <= 0) && (st !== "impayee" || reste(f) > 0)).sort((x, y) => y.numero.localeCompare(x.numero));
      const pg = o.page(l, q);
      return { ...pg, elements: pg.elements.map((f) => { const v = vueFacture(f); return { id: v.id, numero: v.numero, date: v.date, type: v.type, client: v.client.nom, totalHt: v.totalHt, totalTva: v.totalTva,
        totalTtc: v.totalTtc, paye: v.paye, totalAvoirs: v.totalAvoirs, reste: v.reste, statutPaiement: v.statutPaiement, paiement: v.paiement, auteur: v.auteur, creeLe: v.creeLe }; }),
        totalTtc: l.reduce((s, f) => s + f.totalTtc, 0), totalReste: l.reduce((s, f) => s + reste(f), 0) };
    }
  }

  // /api/tresorerie/...
  switch (r1) {
    case "comptes": {
      if (m === "POST") {
        o.exiger("treasury.admin");
        if (!c.nom || String(c.nom).trim().length < 2) throw o.erreur(400, "donnees_invalides", "Nom obligatoire.");
        const type = c.type === "caisse" ? "cash" : c.type === "banque" ? "bank" : "mobile";
        const base = type === "cash" ? "571" : "521";
        let i = 1; while (comptesT.some((t) => t.numero === base + i) && i < 9) i++;
        const t: CompteT = { id: uid(), type, nom: String(c.nom).trim(), banque: c.banque || null, referenceBancaire: c.referenceBancaire || null, actif: true, numero: base + i, journal: type === "cash" ? "CA" : "BQ", caissiers: [] };
        LIB[t.numero] = t.nom;
        comptesT.push(t); o.tracer({ type: "treasury", action: "account_create", objetType: "treasury_account", objetId: t.id }); return { id: t.id };
      }
      if (r2 && m === "PATCH") {
        o.exiger("treasury.admin");
        const t = comptesT.find((x) => x.id === r2);
        if (!t) throw o.erreur(404, "introuvable", "Compte de trésorerie introuvable.");
        if (c.caissiers) {
          o.exiger("treasury.admin", true);
          if (t.type !== "cash" && c.caissiers.length) throw o.erreur(400, "pas_une_caisse", "Seule une caisse s'attribue à des caissiers.");
          t.caissiers = [...new Set(c.caissiers as string[])];
        }
        if (c.nom) t.nom = String(c.nom).trim();
        if ("actif" in c) t.actif = !!c.actif;
        o.tracer({ type: "treasury", action: "account_update", objetType: "treasury_account", objetId: t.id }); return { ok: true };
      }
      lecture();
      const auj = aujourdhui();
      return comptesT.filter(visible).sort((x, y) => x.type.localeCompare(y.type) || x.nom.localeCompare(y.nom)).map((t) => ({
        id: t.id, type: t.type, nom: t.nom, banque: t.banque, referenceBancaire: t.referenceBancaire, actif: t.actif, compte: { numero: t.numero, libelle: t.nom }, journal: t.journal,
        solde: solde(t.id), entreesJour: mouvements.filter((x) => x.compteId === t.id && x.sens === "entree" && x.date === auj).reduce((s, x) => s + x.montant, 0),
        sortiesJour: mouvements.filter((x) => x.compteId === t.id && x.sens === "sortie" && x.date === auj).reduce((s, x) => s + x.montant, 0),
        caissiers: t.caissiers.map((idU) => ({ id: idU, nom: o.nomDe(idU) })) }));
    }
    case "caissiers-possibles":
      o.exiger("treasury.admin");
      return o.utilisateurs().filter((u) => u.actif && u.permissions.has("cash.create")).map((u) => ({ id: u.id, nom: u.nom }));
    case "categories": {
      lecture();
      return { entrees: ENTREES.filter(([, , cpt]) => !masque(cpt)).map(([code, libelle, compte]) => ({ code, libelle, compte, tva: false })),
        sorties: SORTIES.filter(([, , cpt]) => !masque(cpt)).map(([code, libelle, compte, t]) => ({ code, libelle, compte, tva: !!t })) };
    }
    case "tableau": {
      lecture();
      const vis = comptesT.filter(visible), auj = aujourdhui();
      const mv = mouvements.filter((x) => vis.some((t) => t.id === x.compteId));
      const sum = (f: (x: Mvt) => boolean) => mv.filter(f).reduce((s, x) => s + (x.sens === "entree" ? x.montant : -x.montant), 0);
      const estCaisse = (x: Mvt) => comptesT.find((t) => t.id === x.compteId)!.type === "cash";
      return { total: sum(() => true), caisses: sum(estCaisse), banques: sum((x) => !estCaisse(x)),
        entreesJour: mv.filter((x) => x.sens === "entree" && x.date === auj).reduce((s, x) => s + x.montant, 0),
        sortiesJour: mv.filter((x) => x.sens === "sortie" && x.date === auj).reduce((s, x) => s + x.montant, 0),
        ecrituresAValider: a("accounting.read") ? brouillonsGeneres() : null };
    }
    case "transferts": {
      o.exiger(null);
      if (c.de === c.vers) throw o.erreur(400, "meme_compte", "Choisissez deux comptes différents.");
      const de = utilisable(c.de), vers = utilisable(c.vers), montant = montantOk(c.montant), groupe = uid();
      if (!c.libelle || String(c.libelle).trim().length < 2) throw o.erreur(400, "donnees_invalides", "Libellé obligatoire.");
      const base = { nature: "transfer", montant, tva: 0, date: String(c.date), libelle: String(c.libelle).trim(), categorie: "transfert", factureId: null, annulationDe: null, motif: null, groupe };
      const m1 = inserer({ ...base, compteId: de.id, sens: "sortie", reference: c.reference || "", contrepartie: vers.numero });
      inserer({ ...base, compteId: vers.id, sens: "entree", reference: m1.reference, contrepartie: de.numero });
      m1.ecritureId = genererEcriture(de.journal, m1.date, m1.reference, m1.libelle, moi.id, { type: "mouvement", id: m1.id, reference: m1.reference }, [[vers.numero, montant, 0], [de.numero, 0, montant]]);
      o.tracer({ type: "treasury", action: "transfer", objetType: "treasury_movement", objetId: m1.id });
      return { reference: m1.reference };
    }
    case "mouvements": {
      if (r2 && r3 === "annulation") {
        o.exiger("treasury.cancel", true);
        const motif = o.motif(c);
        const orig = mouvements.find((x) => x.id === r2);
        if (!orig) throw o.erreur(404, "introuvable", "Mouvement introuvable.");
        if (orig.nature === "reversal") throw o.erreur(409, "annulation_d_annulation", "Une annulation ne s'annule pas.");
        const jambes = orig.groupe ? mouvements.filter((x) => x.groupe === orig.groupe).sort((x, y) => (x.sens === "entree" ? 0 : 1) - (y.sens === "entree" ? 0 : 1)) : [orig];
        const date = c.date || aujourdhui();
        for (const j of jambes) {
          if (mouvements.some((x) => x.annulationDe === j.id)) throw o.erreur(409, "deja_annule", "Ce mouvement a déjà été annulé.");
          const t = utilisable(j.compteId);
          const inv = inserer({ compteId: t.id, sens: j.sens === "entree" ? "sortie" : "entree", nature: "reversal", montant: j.montant, tva: j.tva, date, reference: `ANN-${j.reference}`,
            libelle: `Annulation ${j.reference} : ${j.libelle}`.slice(0, 200), categorie: j.categorie, contrepartie: j.contrepartie, factureId: j.factureId, annulationDe: j.id, motif, groupe: null });
          if (!orig.groupe) inv.ecritureId = genererEcriture(t.journal, date, inv.reference, inv.libelle, moi.id, { type: "mouvement", id: inv.id, reference: inv.reference },
            lignesEcriture(j.ecritureId ?? "").map(([cpt, d, cr]) => [cpt, cr, d]));
          else if (j.sens === "sortie") {
            const dest = comptesT.find((x) => x.id === jambes.find((y) => y.sens === "entree")!.compteId)!;
            inv.ecritureId = genererEcriture(t.journal, date, inv.reference, inv.libelle, moi.id, { type: "mouvement", id: inv.id, reference: inv.reference }, [[t.numero, j.montant, 0], [dest.numero, 0, j.montant]]);
          }
        }
        o.tracer({ type: "treasury", action: "movement_cancel", objetType: "treasury_movement", objetId: orig.id, motif });
        return { ok: true };
      }
      if (r2) {
        lecture();
        const x = mouvements.find((y) => y.id === r2);
        if (!x || !visible(comptesT.find((t) => t.id === x.compteId)!)) throw o.erreur(404, "introuvable", "Mouvement introuvable.");
        return vueMvt(x);
      }
      if (m === "POST") {
        o.exiger(null);
        const t = utilisable(c.compteTresorerieId), montant = montantOk(c.montant), tvaM = Number(c.tva ?? 0);
        if (!c.libelle || String(c.libelle).trim().length < 2) throw o.erreur(400, "donnees_invalides", "Libellé obligatoire.");
        let nature = c.sens === "entree" ? "receipt" : "expense", cp: string, cat: string, tvaOk = false;
        if (c.factureId) {
          const f = factures.find((x) => x.id === c.factureId);
          if (!f) throw o.erreur(404, "introuvable", "Facture introuvable.");
          const r = reste(f);
          if (montant > r) throw o.erreur(409, "trop_percu", `Il reste ${r} FCFA à régler sur la facture ${f.numero} : montant trop élevé.`);
          cp = "411"; cat = "encaissement_client"; nature = "invoice_payment";
        } else {
          const def = (c.sens === "entree" ? ENTREES : SORTIES).find((x) => x[0] === c.categorie);
          if (!def) throw o.erreur(400, "categorie", "Catégorie inconnue.");
          cp = def[2]; cat = def[0]; tvaOk = !!def[3];
          if (masque(cp)) { o.tracer({ type: "security", action: "access_denied", resultat: "denied", details: { compteProtege: cp } }); throw o.erreur(403, "compte_protege", `Le compte ${cp} est protégé.`); }
        }
        if (tvaM && (c.sens === "entree" || !tvaOk)) throw o.erreur(400, "tva", "La TVA récupérable ne s'applique qu'à une dépense soumise à TVA.");
        if (tvaM >= montant) throw o.erreur(400, "tva", "La TVA doit être inférieure au montant TTC.");
        const mv = inserer({ compteId: t.id, sens: c.sens, nature, montant, tva: tvaM, date: String(c.date), reference: c.reference || "", libelle: String(c.libelle).trim(),
          categorie: cat, contrepartie: cp, factureId: c.factureId ?? null, annulationDe: null, motif: null, groupe: null });
        mv.ecritureId = genererEcriture(t.journal, mv.date, mv.reference, mv.libelle, moi.id, { type: "mouvement", id: mv.id, reference: mv.reference },
          c.sens === "entree" ? [[t.numero, montant, 0], [cp, 0, montant]] : [[cp, montant - tvaM, 0], ["445", tvaM, 0], [t.numero, 0, montant]]);
        o.tracer({ type: "treasury", action: c.sens === "entree" ? "receipt" : "expense", objetType: "treasury_movement", objetId: mv.id });
        return vueMvt(mv);
      }
      lecture();
      const r = (q.get("recherche") ?? "").toLowerCase(), du = q.get("du"), au = q.get("au");
      const l = mouvements.filter((x) => visible(comptesT.find((t) => t.id === x.compteId)!) && (!q.get("compte") || x.compteId === q.get("compte")) && (!q.get("sens") || x.sens === q.get("sens"))
        && (!du || x.date >= du) && (!au || x.date <= au) && (!r || (x.libelle + " " + x.reference).toLowerCase().includes(r)))
        .sort((x, y) => y.date.localeCompare(x.date) || y.creeLe.localeCompare(x.creeLe)).map(vueMvt);
      return o.page(l, q);
    }
  }
  throw o.erreur(404, "introuvable", "Adresse inconnue.");
}
