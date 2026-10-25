/**
 * SIMULATION — catalogue, lots, stock et inventaires pour la version de démonstration (vite build --mode demo).
 * Reprend les règles de serveur/src/http/routes/{produits,stock,inventaires,referentiels,tableau-de-bord}.ts
 * sur des données FICTIVES en mémoire (perdues au rechargement). Les garanties réelles (mouvements en ajout seul,
 * stock jamais négatif, numérotation continue) sont assurées par PostgreSQL dans le logiciel installé.
 */
type Champs = { champ: string; message: string }[];
interface Ctx {
  exiger: (perm: string | null, sensible?: boolean) => void;
  tracer: (e: { type: string; action: string; objetType?: string | null; objetId?: string | null; motif?: string | null; avant?: unknown; apres?: unknown; details?: Record<string, unknown> }) => void;
  motif: (c: any) => string;
  permissions: () => Set<string>;
  moi: () => { id: string; nom: string };
  page: <T>(l: T[], q: URLSearchParams) => { elements: T[]; total: number; page: number; taille: number };
  erreur: (s: number, code: string, message: string, champs?: Champs) => unknown;
}

let seq = 0;
const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${++seq}-${Math.random().toString(16).slice(2)}`);
const jour = (decalage = 0) => { const d = new Date(); d.setDate(d.getDate() + decalage); return d.toISOString().slice(0, 10); };
const joursEntre = (date: string) => Math.round((Date.parse(date) - Date.parse(jour())) / 86_400_000);
const an = () => new Date().getFullYear();
const minus = (s: string | null | undefined) => (s ?? "").toLowerCase();

const NATURES: Record<string, string> = {
  initial: "Stock initial", receipt: "Réception", sale: "Vente", customer_return: "Retour client", supplier_return: "Retour fournisseur",
  adjustment: "Ajustement", breakage: "Casse", expiry: "Sortie pour péremption", inventory: "Écart d'inventaire",
};
const STATUTS_LOT: Record<string, string> = { available: "Disponible", blocked: "Bloqué", recalled: "Rappelé" };
const STATUTS_PRODUIT: Record<string, string> = { active: "Actif", suspended: "Suspendu", archived: "Archivé" };
const STATUTS_INV: Record<string, string> = { open: "En cours", validated: "Validé", cancelled: "Annulé" };
const NATURES_EMPLACEMENT: Record<string, string> = { shelf: "Rayon", reserve: "Réserve", cold: "Réfrigérateur", other: "Autre" };
const MOTIFS: Record<string, { libelle: string; nature: string; sens: "entree" | "sortie" | "les_deux" }> = {
  casse: { libelle: "Casse ou produit abîmé", nature: "breakage", sens: "sortie" },
  peremption: { libelle: "Produit périmé retiré du stock", nature: "expiry", sens: "sortie" },
  erreur_saisie: { libelle: "Correction d'une erreur de saisie", nature: "adjustment", sens: "les_deux" },
  vol: { libelle: "Vol ou disparition constatée", nature: "adjustment", sens: "sortie" },
  autre: { libelle: "Autre motif (à préciser)", nature: "adjustment", sens: "les_deux" },
};

interface Cat { id: string; nom: string; parentId: string | null; archivee: boolean }
interface Elt { id: string; nom: string; archive: boolean; nature?: string }
interface Prod {
  id: string; code: string; codeBarres: string | null; nom: string; dci: string | null; categorieId: string | null; formeId: string | null;
  dosage: string | null; presentation: string | null; fabricant: string | null; fournisseur: string | null; prixAchat: number; prixVente: number;
  tauxTvaPdm: number; seuil: number; conservation: string | null; categorieDelivrance: string | null; statut: string; creeLe: string; modifieLe: string;
  historique: { prixAchat: number; prixVente: number; tauxTvaPdm: number; le: string; par: string }[];
}
interface Lot { id: string; produitId: string; numero: string; peremption: string; fournisseur: string | null; recuLe: string; prixAchat: number; emplacementId: string | null; statut: string; motifStatut: string | null; creeLe: string }
interface Mvt { id: string; numero: string; date: string; nature: string; quantite: number; lotId: string; produitId: string; motif: string | null; inventaireId: string | null; auteur: string }
interface Inv { id: string; numero: string; libelle: string; statut: string; auteur: string; creeLe: string; cloturePar: string | null; clotureLe: string | null; lignes: { lotId: string; theorique: number; compte: number | null }[] }

const categories: Cat[] = [];
const formes: Elt[] = [];
const emplacements: Elt[] = [];
const produits: Prod[] = [];
const lots: Lot[] = [];
const mouvements: Mvt[] = [];
const inventaires: Inv[] = [];
const parametres = { delaiAlertePeremption: 90, tauxTva: [{ libelle: "TVA parapharmacie (taux à vérifier)", tauxPdm: 1925 }] };
const compteurs = { produit: 0, mvt: 0, inv: 0 };

/* ------------------------------------------------------------------ calculs */
const stockLot = (lotId: string) => mouvements.reduce((s, m) => (m.lotId === lotId ? s + m.quantite : s), 0);
const vendableLot = (l: Lot) => l.statut === "available" && l.peremption >= jour();
function stockProduit(p: Prod) {
  const ls = lots.filter((l) => l.produitId === p.id);
  const enStock = ls.filter((l) => stockLot(l.id) > 0);
  return {
    vendable: ls.filter(vendableLot).reduce((s, l) => s + stockLot(l.id), 0),
    total: ls.reduce((s, l) => s + stockLot(l.id), 0),
    prochainePeremption: enStock.map((l) => l.peremption).sort()[0] ?? null,
  };
}
function nomCategorie(idC: string | null) {
  const c = categories.find((x) => x.id === idC);
  if (!c) return null;
  const parent = categories.find((x) => x.id === c.parentId);
  return parent ? `${parent.nom} › ${c.nom}` : c.nom;
}
function vueProduit(p: Prod) {
  const stock = stockProduit(p);
  return {
    id: p.id, code: p.code, codeBarres: p.codeBarres, nom: p.nom, dci: p.dci, categorieId: p.categorieId, categorie: nomCategorie(p.categorieId),
    formeId: p.formeId, forme: formes.find((f) => f.id === p.formeId)?.nom ?? null, dosage: p.dosage, presentation: p.presentation, fabricant: p.fabricant,
    fournisseur: p.fournisseur, prixAchat: p.prixAchat, prixVente: p.prixVente, tauxTvaPdm: p.tauxTvaPdm, seuil: p.seuil, conservation: p.conservation,
    categorieDelivrance: p.categorieDelivrance, statut: p.statut, statutLibelle: STATUTS_PRODUIT[p.statut], stock,
    alerte: p.statut === "active" ? (stock.vendable === 0 ? "rupture" : stock.vendable <= p.seuil ? "seuil" : null) : null,
    creeLe: p.creeLe, modifieLe: p.modifieLe,
  };
}
function vueLot(l: Lot) {
  const p = produits.find((x) => x.id === l.produitId)!;
  const jours = joursEntre(l.peremption), quantite = stockLot(l.id);
  return {
    id: l.id, produitId: l.produitId, produit: p.nom, codeProduit: p.code, numero: l.numero, peremption: l.peremption, joursRestants: jours,
    fournisseur: l.fournisseur, recuLe: l.recuLe, prixAchat: l.prixAchat, emplacementId: l.emplacementId, emplacement: emplacements.find((e) => e.id === l.emplacementId)?.nom ?? null,
    quantite, statut: l.statut, statutLibelle: STATUTS_LOT[l.statut], motifStatut: l.motifStatut,
    etat: l.statut !== "available" ? l.statut : jours < 0 ? "perime" : jours <= parametres.delaiAlertePeremption ? "proche" : "ok",
    vendable: l.statut === "available" && jours >= 0 && quantite > 0, creeLe: l.creeLe,
  };
}
const vueMouvement = (m: Mvt) => {
  const l = lots.find((x) => x.id === m.lotId)!;
  return { id: m.id, numero: m.numero, date: m.date, nature: m.nature, natureLibelle: NATURES[m.nature], quantite: m.quantite, lotId: m.lotId, lot: l.numero,
    produitId: m.produitId, produit: produits.find((p) => p.id === m.produitId)!.nom, motif: m.motif, inventaireId: m.inventaireId,
    inventaire: inventaires.find((i) => i.id === m.inventaireId)?.numero ?? null, auteur: m.auteur };
};
function vueInventaire(i: Inv) {
  const lignes = i.lignes.map((x) => {
    const l = lots.find((y) => y.id === x.lotId)!, p = produits.find((y) => y.id === l.produitId)!;
    return { lotId: l.id, lot: l.numero, peremption: l.peremption, produitId: p.id, produit: p.nom, codeProduit: p.code, emplacement: emplacements.find((e) => e.id === l.emplacementId)?.nom ?? null,
      theorique: x.theorique, compte: x.compte, ecart: x.compte === null ? null : x.compte - x.theorique, stockActuel: stockLot(l.id) };
  }).sort((a, b) => a.produit.localeCompare(b.produit) || a.peremption.localeCompare(b.peremption));
  return { id: i.id, numero: i.numero, libelle: i.libelle, statut: i.statut, statutLibelle: STATUTS_INV[i.statut], auteur: i.auteur, creeLe: i.creeLe,
    cloturePar: i.cloturePar, clotureLe: i.clotureLe, lignes,
    resume: { lignes: lignes.length, comptees: lignes.filter((l) => l.compte !== null).length, ecarts: lignes.filter((l) => l.ecart).length, ecartTotal: lignes.reduce((s, l) => s + (l.ecart ?? 0), 0) } };
}

/** Comme le déclencheur de la base : refuse un stock négatif, numérote en continu. */
function ajouterMouvement(ctx: Ctx | null, m: Omit<Mvt, "id" | "numero" | "date" | "auteur">, auteur: string, date = new Date().toISOString()) {
  const dispo = stockLot(m.lotId);
  if (dispo + m.quantite < 0) {
    const l = lots.find((x) => x.id === m.lotId)!;
    throw ctx!.erreur(409, "regle_metier", `Stock insuffisant pour le lot ${l.numero} : ${dispo} disponible(s), ${-m.quantite} demandé(s).`);
  }
  const mv: Mvt = { ...m, id: id(), numero: `MVT-${an()}-${String(++compteurs.mvt).padStart(5, "0")}`, date, auteur };
  mouvements.push(mv);
  return mv;
}

/* ------------------------------------------------------------------ données de départ (fictives) */
const PRODUITS: [string, string, string, string, string, string, string, number, number, number][] = [
  ["Paracétamol 500 mg (démo)", "Paracétamol", "Médicaments", "Antalgiques", "Comprimé", "500 mg", "Boîte de 16", 350, 500, 20],
  ["Paracétamol sirop enfant (démo)", "Paracétamol", "Médicaments", "Antalgiques", "Sirop", "2,4 %", "Flacon de 100 ml", 900, 1300, 10],
  ["Ibuprofène 400 mg (démo)", "Ibuprofène", "Médicaments", "Anti-inflammatoires", "Comprimé", "400 mg", "Boîte de 20", 700, 1000, 10],
  ["Amoxicilline 500 mg (démo)", "Amoxicilline", "Médicaments", "Anti-infectieux", "Gélule", "500 mg", "Boîte de 12", 1100, 1600, 10],
  ["Artéméther-luméfantrine (démo)", "Artéméther + luméfantrine", "Médicaments", "Antipaludiques", "Comprimé", "20/120 mg", "Boîte de 24", 1800, 2500, 15],
  ["Métronidazole 250 mg (démo)", "Métronidazole", "Médicaments", "Anti-infectieux", "Comprimé", "250 mg", "Boîte de 20", 500, 750, 10],
  ["Sels de réhydratation orale (démo)", "Sels de réhydratation", "Médicaments", "Gastro-entérologie", "Sachet", "20,5 g", "Boîte de 10 sachets", 600, 900, 10],
  ["Oméprazole 20 mg (démo)", "Oméprazole", "Médicaments", "Gastro-entérologie", "Gélule", "20 mg", "Boîte de 14", 900, 1300, 5],
  ["Vitamine C 500 mg (démo)", "Acide ascorbique", "Parapharmacie", "Vitamines", "Comprimé", "500 mg", "Tube de 20", 800, 1200, 5],
  ["Crème hydratante (démo)", "", "Parapharmacie", "Soins de la peau", "Pommade ou crème", "", "Tube de 50 ml", 1500, 2200, 3],
  ["Collyre lavage oculaire (démo)", "", "Parapharmacie", "Soins des yeux", "Collyre", "", "Flacon de 10 ml", 1000, 1500, 3],
  ["Compresses stériles (démo)", "", "Matériel médical", "Pansements", "Autre", "", "Boîte de 50", 1200, 1800, 5],
  ["Thermomètre électronique (démo)", "", "Matériel médical", "Diagnostic", "Autre", "", "À l'unité", 2500, 3800, 2],
];

function categorie(nom: string, parentId: string | null = null) {
  const c = categories.find((x) => x.nom === nom && x.parentId === parentId);
  if (c) return c.id;
  const n: Cat = { id: id(), nom, parentId, archivee: false };
  categories.push(n);
  return n.id;
}
function forme(nom: string) {
  const f = formes.find((x) => minus(x.nom) === minus(nom));
  if (f) return f.id;
  const n: Elt = { id: id(), nom, archive: false };
  formes.push(n);
  return n.id;
}
function nouveauProduit(d: Partial<Prod> & { nom: string; prixVente: number }, par: string, quand = new Date().toISOString()): Prod {
  const p: Prod = {
    id: id(), code: `P-${String(++compteurs.produit).padStart(5, "0")}`, codeBarres: null, dci: null, categorieId: null, formeId: null, dosage: null, presentation: null,
    fabricant: null, fournisseur: null, prixAchat: 0, tauxTvaPdm: 0, seuil: 0, conservation: null, categorieDelivrance: null, statut: "active", creeLe: quand, modifieLe: quand, historique: [], ...d,
  };
  p.historique.unshift({ prixAchat: p.prixAchat, prixVente: p.prixVente, tauxTvaPdm: p.tauxTvaPdm, le: quand, par });
  produits.push(p);
  return p;
}

export function initialiserPharmacie(comptes: Record<string, { id: string; nom: string }>) {
  if (produits.length) return;
  const esther = comptes["esther.ngobassa@demo.cm"]?.nom ?? "Esther Ngo Bassa";
  for (const f of ["Comprimé", "Gélule", "Sirop", "Solution buvable", "Solution injectable", "Pommade ou crème", "Suppositoire", "Collyre", "Sachet", "Autre"]) forme(f);
  for (const [nom, nature] of [["Rayon principal", "shelf"], ["Réserve", "reserve"], ["Réfrigérateur", "cold"]]) emplacements.push({ id: id(), nom, archive: false, nature });
  for (const c of ["Médicaments", "Parapharmacie", "Matériel médical"]) categorie(c);
  const rayon = emplacements[0].id, il30j = new Date(Date.now() - 30 * 86_400_000).toISOString();
  PRODUITS.forEach(([nom, dci, cat, famille, f, dosage, presentation, achat, vente, seuil], i) => {
    const p = nouveauProduit({ nom, dci: dci || null, categorieId: categorie(famille, categorie(cat)), formeId: forme(f), dosage: dosage || null, presentation,
      fabricant: "Laboratoire fictif", prixAchat: achat, prixVente: vente, tauxTvaPdm: cat === "Médicaments" ? 0 : 1925, seuil, codeBarres: `200000000${String(i + 1).padStart(4, "0")}` }, esther, il30j);
    const ls: [string, number, number, string?][] = [[`DEMO${101 + i}A`, 400 + i * 20, 40 + (i % 4) * 15]];
    if (i === 0) ls.push(["DEMO100P", 45, 12]);
    if (i === 3) ls.push(["DEMO103X", -10, 6]);
    if (i === 5) ls.push(["DEMO105B", 300, 20, "Doute sur l'emballage : en attente de contrôle (démo)"]);
    for (const [numero, j, quantite, blocage] of ls) {
      const l: Lot = { id: id(), produitId: p.id, numero, peremption: jour(j), fournisseur: "Grossiste fictif", recuLe: jour(-30), prixAchat: achat, emplacementId: rayon,
        statut: blocage ? "blocked" : "available", motifStatut: blocage ?? null, creeLe: il30j };
      lots.push(l);
      ajouterMouvement(null, { lotId: l.id, produitId: p.id, nature: "initial", quantite, motif: "Stock initial (démo)", inventaireId: null }, esther, il30j);
    }
  });
  nouveauProduit({ nom: "Salbutamol inhalateur (démo)", dci: "Salbutamol", categorieId: categorie("Médicaments"), formeId: forme("Autre"), presentation: "Flacon pressurisé", prixVente: 3500, seuil: 3 }, esther, il30j);
  const ibu = lots.find((l) => l.numero === "DEMO103A")!;
  ajouterMouvement(null, { lotId: ibu.id, produitId: ibu.produitId, nature: "breakage", quantite: -2, motif: "Casse ou produit abîmé : boîtes écrasées (démo)", inventaireId: null }, esther,
    new Date(Date.now() - 2 * 3_600_000).toISOString());
}

/* ------------------------------------------------------------------ contrôles de saisie */
const texte = (v: unknown, max: number) => { const t = typeof v === "string" ? v.trim() : ""; return t ? t.slice(0, max) : null; };
function lireProduit(ctx: Ctx, c: any, partiel: boolean) {
  const champs: Champs = [];
  const d: Partial<Prod> = {};
  if (!partiel || "nom" in c) { const n = String(c.nom ?? "").trim(); if (n.length < 2) champs.push({ champ: "nom", message: "Nom du produit obligatoire (2 caractères au moins)." }); else d.nom = n.slice(0, 160); }
  for (const [k, cle, max] of [["dci", "dci", 160], ["dosage", "dosage", 60], ["presentation", "presentation", 120], ["fabricant", "fabricant", 120], ["fournisseur", "fournisseur", 120], ["conservation", "conservation", 120], ["categorieDelivrance", "categorieDelivrance", 80]] as const)
    if (k in c) (d as any)[cle] = texte(c[k], max);
  if ("codeBarres" in c) {
    const cb = texte(c.codeBarres, 32);
    if (cb && !/^[0-9A-Za-z-]{4,32}$/.test(cb)) champs.push({ champ: "codeBarres", message: "Code-barres : 4 à 32 chiffres ou lettres, sans espace." });
    d.codeBarres = cb;
  }
  for (const k of ["categorieId", "formeId"] as const) if (k in c) d[k] = c[k] || null;
  const entier = (k: "prixAchat" | "prixVente" | "seuil", requis: boolean, message: string) => {
    if (!(k in c) || c[k] === undefined) { if (requis) champs.push({ champ: k, message }); return; }
    if (!Number.isInteger(c[k]) || c[k] < 0) champs.push({ champ: k, message }); else d[k] = c[k];
  };
  entier("prixVente", !partiel, "Prix en francs, sans décimales.");
  entier("prixAchat", false, "Prix en francs, sans décimales.");
  entier("seuil", false, "Seuil en nombre entier.");
  if ("tauxTvaPdm" in c) d.tauxTvaPdm = Number(c.tauxTvaPdm) || 0;
  if (champs.length) throw ctx.erreur(400, "donnees_invalides", "Certaines données sont invalides.", champs);
  if (d.tauxTvaPdm && !parametres.tauxTva.some((t) => t.tauxPdm === d.tauxTvaPdm))
    throw ctx.erreur(400, "tva_inconnue", "Ce taux de TVA n'est pas dans les paramètres de la pharmacie. Ajoutez-le d'abord (Administration › Paramètres de la pharmacie).");
  if (d.codeBarres && produits.some((p) => p.codeBarres === d.codeBarres && p.id !== c._id))
    throw ctx.erreur(409, "regle_metier", "Ce code-barres est déjà attribué à un autre produit.");
  return d;
}

function filtrerProduits(q: URLSearchParams) {
  const rech = minus(q.get("recherche")?.trim()), cat = q.get("categorie"), st = q.get("statut"), al = q.get("alerte");
  return produits.filter((p) => {
    if (rech && !(minus(p.nom).includes(rech) || minus(p.dci).includes(rech) || minus(p.code).includes(rech) || p.codeBarres === q.get("recherche")?.trim())) return false;
    if (cat && p.categorieId !== cat && categories.find((c) => c.id === p.categorieId)?.parentId !== cat) return false;
    if (st && st in STATUTS_PRODUIT) { if (p.statut !== st) return false; } else if (st !== "tous" && p.statut === "archived") return false;
    return true;
  }).map(vueProduit).filter((p) => !al || (al === "rupture" ? p.alerte === "rupture" : al === "seuil" ? p.alerte === "seuil" : true))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}
function filtrerLots(q: URLSearchParams) {
  const rech = minus(q.get("recherche")?.trim()), delai = parametres.delaiAlertePeremption;
  return lots.map(vueLot).filter((l) => {
    if (q.get("produit") && l.produitId !== q.get("produit")) return false;
    if (rech && !(minus(l.numero).includes(rech) || minus(l.produit).includes(rech) || minus(l.codeProduit).includes(rech))) return false;
    if (q.get("statut") && l.statut !== q.get("statut")) return false;
    if (q.get("etat") === "proche" && !(l.joursRestants >= 0 && l.joursRestants <= delai && l.quantite > 0)) return false;
    if (q.get("etat") === "perime" && !(l.joursRestants < 0 && l.quantite > 0)) return false;
    if (q.get("enStock") !== "non" && l.quantite <= 0) return false;
    return true;
  }).sort((a, b) => a.peremption.localeCompare(b.peremption) || a.produit.localeCompare(b.produit));
}
function filtrerMouvements(q: URLSearchParams) {
  const rech = minus(q.get("recherche")?.trim());
  return mouvements.map(vueMouvement).filter((m) => (!q.get("produit") || m.produitId === q.get("produit")) && (!q.get("lot") || m.lotId === q.get("lot"))
    && (!q.get("nature") || m.nature === q.get("nature")) && (!q.get("du") || m.date.slice(0, 10) >= q.get("du")!) && (!q.get("au") || m.date.slice(0, 10) <= q.get("au")!)
    && (!rech || minus(m.produit).includes(rech) || minus(m.lot).includes(rech) || minus(m.numero).includes(rech)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.numero.localeCompare(a.numero));
}
const csv = (entetes: string[], lignes: unknown[][]) =>
  "﻿" + [entetes, ...lignes].map((l) => l.map((v) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\r\n");

/* ------------------------------------------------------------------ routes */
export function traiterPharmacie(m: string, chemin: string, q: URLSearchParams, c: any, ctx: Ctx): unknown {
  const [, , mod, a1, a2] = chemin.split("/");
  const auteur = () => ctx.moi().nom;

  if (mod === "parametres-pharmacie") {
    if (m === "GET") { ctx.exiger(null); return { ...parametres, tauxTva: parametres.tauxTva.map((t) => ({ ...t })) }; }
    ctx.exiger("company.update");
    if (c.delaiAlertePeremption !== undefined && !(Number.isInteger(c.delaiAlertePeremption) && c.delaiAlertePeremption >= 1 && c.delaiAlertePeremption <= 730))
      throw ctx.erreur(400, "donnees_invalides", "Délai d'alerte : entre 1 et 730 jours.");
    if (c.tauxTva && new Set(c.tauxTva.map((t: any) => t.tauxPdm)).size !== c.tauxTva.length) throw ctx.erreur(400, "taux_double", "Deux taux de TVA ont la même valeur.");
    const avant = JSON.parse(JSON.stringify(parametres));
    if (c.delaiAlertePeremption !== undefined) parametres.delaiAlertePeremption = c.delaiAlertePeremption;
    if (c.tauxTva) parametres.tauxTva = c.tauxTva.map((t: any) => ({ libelle: String(t.libelle).trim(), tauxPdm: t.tauxPdm }));
    ctx.tracer({ type: "company", action: "pharmacy_settings_change", objetType: "company", avant, apres: parametres });
    return parametres;
  }

  if (mod === "referentiels") {
    if (a1 === "categories") {
      if (m === "GET") {
        ctx.exiger("catalog.read");
        const vue = (x: Cat) => ({ id: x.id, nom: x.nom, archivee: x.archivee, produits: produits.filter((p) => p.categorieId === x.id && p.statut !== "archived").length });
        return categories.filter((x) => !x.parentId).sort((a, b) => a.nom.localeCompare(b.nom))
          .map((x) => ({ ...vue(x), familles: categories.filter((f) => f.parentId === x.id).sort((a, b) => a.nom.localeCompare(b.nom)).map(vue) }));
      }
      ctx.exiger("catalog.admin");
      if (m === "POST") {
        const nom = String(c.nom ?? "").trim();
        if (nom.length < 2) throw ctx.erreur(400, "donnees_invalides", "Nom trop court.");
        if (categories.some((x) => minus(x.nom) === minus(nom) && x.parentId === (c.parentId ?? null))) throw ctx.erreur(409, "regle_metier", "Ce nom existe déjà à ce niveau.");
        const n: Cat = { id: id(), nom, parentId: c.parentId ?? null, archivee: false };
        categories.push(n); ctx.tracer({ type: "catalog", action: "category_create", objetType: "category", objetId: n.id, apres: c });
        return { id: n.id };
      }
      const x = categories.find((y) => y.id === a2);
      if (!x) throw ctx.erreur(404, "introuvable", "Catégorie introuvable.");
      if (c.nom) x.nom = String(c.nom).trim();
      if (typeof c.archivee === "boolean") x.archivee = c.archivee;
      ctx.tracer({ type: "catalog", action: "category_update", objetType: "category", objetId: x.id, apres: c });
      return { ok: true };
    }
    const liste = a1 === "formes" ? formes : a1 === "emplacements" ? emplacements : null;
    if (liste) {
      if (m === "GET") {
        ctx.exiger("catalog.read");
        return [...liste].sort((a, b) => Number(a.archive) - Number(b.archive) || a.nom.localeCompare(b.nom))
          .map((x) => ({ id: x.id, nom: x.nom, archive: x.archive, ...(a1 === "emplacements" ? { nature: x.nature, natureLibelle: NATURES_EMPLACEMENT[x.nature ?? "other"] } : {}) }));
      }
      ctx.exiger("catalog.admin");
      if (m === "POST") {
        const nom = String(c.nom ?? "").trim();
        if (nom.length < 2) throw ctx.erreur(400, "donnees_invalides", "Nom trop court.");
        if (liste.some((x) => minus(x.nom) === minus(nom))) throw ctx.erreur(409, "regle_metier", "Ce nom existe déjà.");
        const n: Elt = { id: id(), nom, archive: false, ...(a1 === "emplacements" ? { nature: c.nature ?? "shelf" } : {}) };
        liste.push(n); ctx.tracer({ type: "catalog", action: `${a1 === "formes" ? "dosage_form" : "storage_location"}_create`, objetId: n.id, apres: c });
        return { id: n.id };
      }
      const x = liste.find((y) => y.id === a2);
      if (!x) throw ctx.erreur(404, "introuvable", "Élément introuvable.");
      if (c.nom) x.nom = String(c.nom).trim();
      if (typeof c.archive === "boolean") x.archive = c.archive;
      if (c.nature) x.nature = c.nature;
      return { ok: true };
    }
  }

  if (mod === "produits") {
    if (!a1 && m === "GET") { ctx.exiger("catalog.read"); return ctx.page(filtrerProduits(q), q); }
    if (a1 === "export") {
      ctx.exiger("catalog.export");
      const l = filtrerProduits(q);
      ctx.tracer({ type: "catalog", action: "export", objetType: "product", details: { lignes: l.length } });
      return csv(["Code", "Nom", "DCI", "Catégorie", "Forme", "Prix d'achat", "Prix de vente", "Stock vendable", "Statut"],
        l.map((p) => [p.code, p.nom, p.dci, p.categorie, p.forme, p.prixAchat, p.prixVente, p.stock.vendable, p.statutLibelle]));
    }
    if (a1 === "import") {
      ctx.exiger("catalog.create");
      const lignes = String(c.contenu ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
      if (lignes.length < 2) throw ctx.erreur(400, "csv_vide", "Le fichier doit contenir une ligne d'en-tête et au moins un produit.");
      const sep = lignes[0].includes(";") ? ";" : ",";
      const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[\s-]+/g, "_");
      const entete = lignes[0].split(sep).map(norm), col = (k: string) => entete.indexOf(k);
      if (col("nom") < 0 || col("prix_vente") < 0) throw ctx.erreur(400, "csv_colonnes", "Colonnes « nom » et « prix_vente » obligatoires dans la première ligne.");
      const erreurs: { ligne: number; message: string }[] = [], valides: any[] = [];
      lignes.slice(1).forEach((brut, i) => {
        const v = brut.split(sep).map((x) => x.replace(/^"|"$/g, "").trim()), val = (k: string) => (col(k) >= 0 ? v[col(k)] ?? "" : "");
        const prix = Number(val("prix_vente").replace(/\s/g, ""));
        if (val("nom").length < 2) return erreurs.push({ ligne: i + 2, message: "nom : 2 caractères au moins." });
        if (!Number.isInteger(prix) || prix < 0) return erreurs.push({ ligne: i + 2, message: "prixVente : prix en francs, sans décimales." });
        const tva = val("tva") ? Math.round(Number(val("tva").replace(",", ".").replace("%", "")) * 100) : 0;
        if (tva && !parametres.tauxTva.some((t) => t.tauxPdm === tva)) return erreurs.push({ ligne: i + 2, message: `TVA « ${val("tva")} » absente des paramètres de la pharmacie.` });
        valides.push({ nom: val("nom"), dci: val("dci") || null, categorie: val("categorie"), famille: val("famille"), forme: val("forme"), dosage: val("dosage") || null,
          presentation: val("presentation") || null, prixAchat: Number(val("prix_achat")) || 0, prixVente: prix, tauxTvaPdm: tva, seuil: Number(val("seuil")) || 0 });
      });
      if (c.verifier !== false || erreurs.length) return { lignes: lignes.length - 1, valides: valides.length, erreurs, crees: 0 };
      for (const p of valides) {
        const cat = p.categorie ? categorie(p.categorie) : null;
        nouveauProduit({ nom: p.nom, dci: p.dci, categorieId: p.famille && cat ? categorie(p.famille, cat) : cat, formeId: p.forme ? forme(p.forme) : null, dosage: p.dosage,
          presentation: p.presentation, prixAchat: p.prixAchat, prixVente: p.prixVente, tauxTvaPdm: p.tauxTvaPdm, seuil: p.seuil }, auteur());
      }
      ctx.tracer({ type: "catalog", action: "import", objetType: "product", details: { produits: valides.length } });
      return { lignes: lignes.length - 1, valides: valides.length, erreurs: [], crees: valides.length };
    }
    if (!a1 && m === "POST") {
      ctx.exiger("catalog.create");
      const d = lireProduit(ctx, c, false);
      const p = nouveauProduit(d as Prod, auteur());
      ctx.tracer({ type: "catalog", action: "product_create", objetType: "product", objetId: p.id, apres: { code: p.code, ...d } });
      return vueProduit(p);
    }
    const p = produits.find((x) => x.id === a1);
    if (!p) throw ctx.erreur(404, "introuvable", "Produit introuvable.");
    if (!a2 && m === "GET") { ctx.exiger("catalog.read"); return { ...vueProduit(p), historiquePrix: p.historique.map((h) => ({ ...h })) }; }
    if (!a2 && m === "PATCH") {
      ctx.exiger("catalog.update");
      if (p.statut === "archived") throw ctx.erreur(409, "produit_archive", "Ce produit est archivé : réactivez-le avant de le modifier.");
      const d = lireProduit(ctx, { ...c, _id: p.id }, true);
      const avant = { prixAchat: p.prixAchat, prixVente: p.prixVente, tauxTvaPdm: p.tauxTvaPdm };
      Object.assign(p, d, { modifieLe: new Date().toISOString() });
      if (avant.prixAchat !== p.prixAchat || avant.prixVente !== p.prixVente || avant.tauxTvaPdm !== p.tauxTvaPdm)
        p.historique.unshift({ prixAchat: p.prixAchat, prixVente: p.prixVente, tauxTvaPdm: p.tauxTvaPdm, le: new Date().toISOString(), par: auteur() });
      ctx.tracer({ type: "catalog", action: "product_update", objetType: "product", objetId: p.id, avant, apres: d });
      return vueProduit(p);
    }
    if (a2 === "statut") {
      ctx.exiger("catalog.archive");
      const mo = ctx.motif(c), avant = p.statut;
      if (!(c.statut in STATUTS_PRODUIT)) throw ctx.erreur(400, "donnees_invalides", "Statut inconnu.");
      p.statut = c.statut;
      ctx.tracer({ type: "catalog", action: "product_status", objetType: "product", objetId: p.id, motif: mo, avant: { statut: avant }, apres: { statut: p.statut } });
      return vueProduit(p);
    }
  }

  if (mod === "stock" && a1 === "references") {
    ctx.exiger("stock.read");
    return { natures: NATURES, statutsLot: STATUTS_LOT, motifsAjustement: Object.entries(MOTIFS).map(([cle, x]) => ({ cle, ...x })) };
  }

  if (mod === "lots") {
    if (!a1 && m === "GET") { ctx.exiger("stock.read"); return { ...ctx.page(filtrerLots(q), q), delaiAlertePeremption: parametres.delaiAlertePeremption }; }
    if (a1 === "export") {
      ctx.exiger("stock.export");
      const l = filtrerLots(q);
      ctx.tracer({ type: "stock", action: "export", objetType: "lot", details: { lignes: l.length } });
      return csv(["Code produit", "Produit", "N° de lot", "Péremption", "Quantité", "Prix d'achat", "Valeur", "Emplacement", "Statut"],
        l.map((x) => [x.codeProduit, x.produit, x.numero, x.peremption, x.quantite, x.prixAchat, x.quantite * x.prixAchat, x.emplacement, x.statutLibelle]));
    }
    if (!a1 && m === "POST") {
      ctx.exiger("stock.create");
      const p = produits.find((x) => x.id === c.produitId);
      if (!p) throw ctx.erreur(400, "produit_inconnu", "Choisissez un produit.");
      const numero = String(c.numero ?? "").trim();
      const champs: Champs = [];
      if (!numero) champs.push({ champ: "numero", message: "Numéro de lot obligatoire." });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.peremption ?? "")) champs.push({ champ: "peremption", message: "Date de péremption obligatoire (AAAA-MM-JJ)." });
      if (!Number.isInteger(c.quantite) || c.quantite < 1) champs.push({ champ: "quantite", message: "Quantité d'au moins 1." });
      if (champs.length) throw ctx.erreur(400, "donnees_invalides", "Certaines données sont invalides.", champs);
      if (p.statut === "archived") throw ctx.erreur(409, "produit_archive", "Ce produit est archivé : réactivez-le avant d'y ajouter du stock.");
      if ((c.recuLe ?? jour()) > jour()) throw ctx.erreur(400, "date_future", "La date de réception ne peut pas être dans le futur.");
      if (c.peremption < jour()) throw ctx.erreur(400, "lot_perime", "Ce lot est déjà périmé : il ne peut pas entrer dans le stock vendable.");
      let l = lots.find((x) => x.produitId === p.id && x.numero.trim().toUpperCase() === numero.toUpperCase());
      if (l && l.peremption !== c.peremption)
        throw ctx.erreur(409, "peremption_differente", `Le lot ${numero} existe déjà avec une autre date de péremption (${l.peremption.split("-").reverse().join("/")}). Vérifiez la boîte.`);
      const existant = !!l;
      if (!l) {
        l = { id: id(), produitId: p.id, numero, peremption: c.peremption, fournisseur: texte(c.fournisseur, 120) ?? p.fournisseur, recuLe: c.recuLe ?? jour(),
          prixAchat: Number.isInteger(c.prixAchat) ? c.prixAchat : p.prixAchat, emplacementId: c.emplacementId ?? null, statut: "available", motifStatut: null, creeLe: new Date().toISOString() };
        lots.push(l);
      }
      const mv = ajouterMouvement(ctx, { lotId: l.id, produitId: p.id, nature: "initial", quantite: c.quantite, motif: texte(c.motif, 300) ?? "Stock initial", inventaireId: null }, auteur());
      ctx.tracer({ type: "stock", action: "initial_stock", objetType: "lot", objetId: l.id, apres: { numero, quantite: c.quantite, mouvement: mv.numero, lotExistant: existant } });
      return vueLot(l);
    }
    const l = lots.find((x) => x.id === a1);
    if (!l) throw ctx.erreur(404, "introuvable", "Lot introuvable.");
    if (!a2 && m === "GET") {
      ctx.exiger("stock.read");
      let cumul = 0;
      return { ...vueLot(l), mouvements: mouvements.filter((x) => x.lotId === l.id).map((x) => ({ ...vueMouvement(x), solde: (cumul += x.quantite) })) };
    }
    if (a2 === "statut") {
      const sensible = l.statut === "recalled" && c.statut !== "recalled";   // lever un rappel : confirmation par mot de passe
      ctx.exiger("stock.update", sensible);
      const mo = ctx.motif(c), avant = l.statut;
      l.statut = c.statut; l.motifStatut = c.statut === "available" ? null : mo;
      ctx.tracer({ type: "stock", action: "lot_status", objetType: "lot", objetId: l.id, motif: mo, avant: { statut: avant }, apres: { statut: l.statut } });
      return vueLot(l);
    }
    if (!a2 && m === "PATCH") {
      ctx.exiger("stock.update");
      l.emplacementId = c.emplacementId ?? null;
      ctx.tracer({ type: "stock", action: "lot_location", objetType: "lot", objetId: l.id, apres: c });
      return vueLot(l);
    }
  }

  if (mod === "stock" && a1 === "ajustements") {
    ctx.exiger("stock.approve", true);
    const mo = MOTIFS[c.motif];
    if (!mo) throw ctx.erreur(400, "donnees_invalides", "Choisissez un motif.");
    if (!Number.isInteger(c.quantite) || c.quantite < 1) throw ctx.erreur(400, "donnees_invalides", "Quantité d'au moins 1.");
    if (mo.sens !== "les_deux" && mo.sens !== c.sens) throw ctx.erreur(400, "sens_motif", `« ${mo.libelle} » est forcément une sortie de stock.`);
    if (c.motif === "autre" && String(c.precision ?? "").trim().length < 3) throw ctx.erreur(400, "precision", "Précisez le motif (3 caractères au moins).");
    const l = lots.find((x) => x.id === c.lotId);
    if (!l) throw ctx.erreur(400, "lot_inconnu", "Lot introuvable.");
    const motif = [mo.libelle, String(c.precision ?? "").trim()].filter(Boolean).join(" : ");
    const mv = ajouterMouvement(ctx, { lotId: l.id, produitId: l.produitId, nature: mo.nature, quantite: c.sens === "entree" ? c.quantite : -c.quantite, motif, inventaireId: null }, auteur());
    ctx.tracer({ type: "stock", action: "adjustment", objetType: "lot", objetId: l.id, motif, apres: { mouvement: mv.numero, lot: l.numero, sens: c.sens, quantite: c.quantite } });
    return { numero: mv.numero, id: mv.id };
  }

  if (mod === "stock" && a1 === "mouvements") {
    if (a2 === "export") {
      ctx.exiger("stock.export");
      const l = filtrerMouvements(q);
      ctx.tracer({ type: "stock", action: "export", objetType: "stock_movement", details: { lignes: l.length } });
      return csv(["N°", "Date", "Nature", "Produit", "N° de lot", "Quantité", "Motif", "Auteur"],
        l.map((x) => [x.numero, new Date(x.date).toLocaleString("fr-FR"), x.natureLibelle, x.produit, x.lot, x.quantite, x.motif, x.auteur]));
    }
    ctx.exiger("stock.read");
    return ctx.page(filtrerMouvements(q), q);
  }

  if (mod === "stock" && a1 === "alertes") {
    ctx.exiger("stock.read");
    const actifs = produits.filter((p) => p.statut === "active").map((p) => ({ p, vendable: stockProduit(p).vendable }))
      .filter((x) => x.vendable === 0 || x.vendable <= x.p.seuil).sort((a, b) => a.vendable - b.vendable || a.p.nom.localeCompare(b.p.nom));
    const vues = lots.map(vueLot).filter((l) => l.quantite > 0 && (l.joursRestants <= parametres.delaiAlertePeremption || l.statut !== "available")).sort((a, b) => a.peremption.localeCompare(b.peremption));
    const court = (x: { p: Prod; vendable: number }) => ({ id: x.p.id, nom: x.p.nom, code: x.p.code, vendable: x.vendable, seuil: x.p.seuil });
    return {
      delaiAlertePeremption: parametres.delaiAlertePeremption,
      ruptures: actifs.filter((x) => x.vendable === 0).map(court), sousSeuil: actifs.filter((x) => x.vendable > 0).map(court),
      perimes: vues.filter((l) => l.etat === "perime"), proches: vues.filter((l) => l.etat === "proche"), bloques: vues.filter((l) => l.statut !== "available"),
    };
  }

  if (mod === "inventaires") {
    if (!a1 && m === "GET") {
      ctx.exiger("stock.read");
      return ctx.page([...inventaires].reverse().map((i) => ({ id: i.id, numero: i.numero, libelle: i.libelle, statut: i.statut, statutLibelle: STATUTS_INV[i.statut],
        creeLe: i.creeLe, clotureLe: i.clotureLe, auteur: i.auteur, lignes: i.lignes.length, comptees: i.lignes.filter((l) => l.compte !== null).length })), q);
    }
    if (!a1 && m === "POST") {
      ctx.exiger("stock.create");
      const libelle = String(c.libelle ?? "").trim();
      if (libelle.length < 2) throw ctx.erreur(400, "donnees_invalides", "Donnez un nom à l'inventaire (ex. « Inventaire annuel »).");
      const ouvert = inventaires.find((i) => i.statut === "open");
      if (ouvert) throw ctx.erreur(409, "inventaire_ouvert", `L'inventaire ${ouvert.numero} est déjà en cours : validez-le ou annulez-le avant d'en ouvrir un autre.`);
      const perim = lots.filter((l) => {
        const p = produits.find((x) => x.id === l.produitId)!;
        return stockLot(l.id) > 0 && (!c.categorieId || p.categorieId === c.categorieId || categories.find((x) => x.id === p.categorieId)?.parentId === c.categorieId)
          && (!c.emplacementId || l.emplacementId === c.emplacementId);
      });
      if (!perim.length) throw ctx.erreur(409, "inventaire_vide", "Aucun lot en stock dans ce périmètre : rien à inventorier.");
      const i: Inv = { id: id(), numero: `INV-${an()}-${String(++compteurs.inv).padStart(3, "0")}`, libelle, statut: "open", auteur: auteur(), creeLe: new Date().toISOString(),
        cloturePar: null, clotureLe: null, lignes: perim.map((l) => ({ lotId: l.id, theorique: stockLot(l.id), compte: null })) };
      inventaires.push(i);
      ctx.tracer({ type: "stock", action: "inventory_open", objetType: "inventory", objetId: i.id, apres: { numero: i.numero, libelle, lignes: i.lignes.length } });
      return vueInventaire(i);
    }
    const i = inventaires.find((x) => x.id === a1);
    if (!i) throw ctx.erreur(404, "introuvable", "Inventaire introuvable.");
    if (!a2 && m === "GET") { ctx.exiger("stock.read"); return vueInventaire(i); }
    if (a2 === "lignes") {
      ctx.exiger("stock.create");
      if (!i.lignes.some((l) => l.lotId === c.lotId) && lots.some((l) => l.id === c.lotId)) i.lignes.push({ lotId: c.lotId, theorique: stockLot(c.lotId), compte: null });
      return vueInventaire(i);
    }
    if (a2 === "comptages") {
      ctx.exiger("stock.create");
      if (i.statut !== "open") throw ctx.erreur(409, "inventaire_clos", "Cet inventaire est clos : ses comptages ne se modifient plus.");
      for (const x of c.lignes ?? []) {
        const l = i.lignes.find((y) => y.lotId === x.lotId);
        if (!l || l.compte === x.compte) continue;
        if (x.compte !== null && (!Number.isInteger(x.compte) || x.compte < 0)) throw ctx.erreur(400, "donnees_invalides", "Quantité en nombre entier, positive.");
        l.compte = x.compte;
        if (x.compte !== null) l.theorique = stockLot(l.lotId);   // relu au moment du comptage
      }
      return vueInventaire(i);
    }
    if (a2 === "validation") {
      ctx.exiger("stock.approve", true);
      if (i.statut !== "open") throw ctx.erreur(409, "inventaire_clos", "Cet inventaire est déjà clos.");
      const v = vueInventaire(i);
      if (!v.resume.comptees) throw ctx.erreur(409, "rien_compte", "Aucune ligne n'a été comptée.");
      for (const l of v.lignes.filter((x) => x.ecart))
        ajouterMouvement(ctx, { lotId: l.lotId, produitId: l.produitId, nature: "inventory", quantite: l.ecart!, motif: `Inventaire ${i.numero}`, inventaireId: i.id }, auteur());
      Object.assign(i, { statut: "validated", cloturePar: auteur(), clotureLe: new Date().toISOString() });
      ctx.tracer({ type: "stock", action: "inventory_validate", objetType: "inventory", objetId: i.id, apres: { numero: i.numero, ecarts: v.resume.ecarts, ecartTotal: v.resume.ecartTotal } });
      return vueInventaire(i);
    }
    if (a2 === "annulation") {
      ctx.exiger("stock.approve");
      const mo = ctx.motif(c);
      if (i.statut !== "open") throw ctx.erreur(409, "inventaire_clos", "Seul un inventaire en cours peut être annulé.");
      Object.assign(i, { statut: "cancelled", cloturePar: auteur(), clotureLe: new Date().toISOString() });
      ctx.tracer({ type: "stock", action: "inventory_cancel", objetType: "inventory", objetId: i.id, motif: mo });
      return vueInventaire(i);
    }
  }

  if (mod === "tableau-de-bord") {
    ctx.exiger(null);
    const ps = ctx.permissions();
    if (!ps.has("stock.read") && !ps.has("catalog.read")) return { autorise: false };
    const actifs = produits.filter((p) => p.statut === "active").map((p) => ({ p, q: stockProduit(p).vendable }));
    const enStock = lots.map(vueLot).filter((l) => l.quantite > 0);
    const duJour = mouvements.filter((x) => x.date.slice(0, 10) === jour());
    return {
      autorise: true, delaiAlertePeremption: parametres.delaiAlertePeremption,
      indicateurs: {
        produits: actifs.length, ruptures: actifs.filter((x) => x.q === 0).length, sousSeuil: actifs.filter((x) => x.q > 0 && x.q <= x.p.seuil).length,
        peremptionsProches: enStock.filter((l) => l.joursRestants >= 0 && l.joursRestants <= parametres.delaiAlertePeremption).length,
        lotsPerimes: enStock.filter((l) => l.joursRestants < 0).length, lotsBloques: enStock.filter((l) => l.statut !== "available").length,
        valeurStock: ps.has("reports.read") || ps.has("stock.approve") ? enStock.reduce((s, l) => s + l.quantite * l.prixAchat, 0) : null,
        entreesJour: duJour.filter((x) => x.quantite > 0).reduce((s, x) => s + x.quantite, 0), sortiesJour: -duJour.filter((x) => x.quantite < 0).reduce((s, x) => s + x.quantite, 0),
      },
      derniersMouvements: ps.has("stock.read") ? [...mouvements].sort((a, b) => b.date.localeCompare(a.date) || b.numero.localeCompare(a.numero)).slice(0, 8)
        .map((x) => { const v = vueMouvement(x); return { id: v.id, numero: v.numero, date: v.date, nature: v.natureLibelle, quantite: v.quantite, lot: v.lot, produit: v.produit, auteur: v.auteur }; }) : [],
    };
  }

  throw ctx.erreur(404, "introuvable", "Adresse inconnue.");
}
