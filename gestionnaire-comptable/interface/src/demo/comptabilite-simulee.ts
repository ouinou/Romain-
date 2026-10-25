/**
 * Comptabilité SIMULÉE pour la démonstration hors serveur. Elle reproduit les règles visibles du vrai serveur
 * (brouillard, équilibre à la validation, numérotation, séparation des tâches, extourne, comptes protégés),
 * en mémoire et sans aucune garantie. Les vraies règles sont appliquées par PostgreSQL (migration 004).
 */
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
}

interface Compte { id: string; numero: string; libelle: string; imputable: boolean; actif: boolean; source: string }
interface Ligne { compteId: string; libelle: string | null; debit: number; credit: number }
interface Origine { type: "facture" | "avoir" | "mouvement"; id: string; reference: string }
interface Ecr { origine?: Origine | null; id: string; statut: "brouillard" | "validee"; numero: number | null; journalId: string; exerciceId: string; date: string; piece: string; libelle: string; auteur: string; creeLe: string; modifieLe: string; validateur: string | null; valideeLe: string | null; extourneDe: string | null; motif: string | null; lignes: Ligne[] }

let n = 0;
const uid = () => `demo-${++n}-${Math.random().toString(16).slice(2, 8)}`;
const AN = new Date().getFullYear();
const REF: [string, string][] = [
  ["1", "Comptes de ressources durables"], ["10", "Capital"], ["101", "Capital social"], ["11", "Réserves"], ["111", "Réserve légale"], ["13", "Résultat net de l'exercice"], ["16", "Emprunts et dettes assimilées"], ["162", "Emprunts et dettes auprès des établissements de crédit"],
  ["2", "Comptes d'actif immobilisé"], ["24", "Matériel, mobilier et actifs biologiques"], ["244", "Matériel et mobilier"], ["245", "Matériel de transport"],
  ["3", "Comptes de stocks"], ["31", "Marchandises"], ["311", "Marchandises A"],
  ["4", "Comptes de tiers"], ["40", "Fournisseurs et comptes rattachés"], ["401", "Fournisseurs, dettes en compte"], ["41", "Clients et comptes rattachés"], ["411", "Clients"], ["42", "Personnel"], ["422", "Personnel, rémunérations dues"], ["44", "État et collectivités publiques"], ["443", "État, TVA facturée"], ["445", "État, TVA récupérable"],
  ["5", "Comptes de trésorerie"], ["52", "Banques"], ["521", "Banques locales"], ["5211", "Banque fictive"], ["5212", "Mobile money (fictif)"], ["57", "Caisse"], ["571", "Caisse siège social"], ["5711", "Caisse principale"],
  ["6", "Comptes de charges des activités ordinaires"], ["60", "Achats et variations de stocks"], ["601", "Achats de marchandises"], ["605", "Autres achats"], ["61", "Transports"], ["618", "Autres frais de transport"], ["62", "Services extérieurs"], ["622", "Locations et charges locatives"], ["624", "Entretien, réparations et maintenance"], ["625", "Primes d'assurance"], ["627", "Publicité, publications, relations publiques"], ["628", "Frais de télécommunications"], ["63", "Autres services extérieurs"], ["631", "Frais bancaires"], ["632", "Rémunérations d'intermédiaires et de conseils"], ["64", "Impôts et taxes"], ["641", "Impôts et taxes directs"], ["66", "Charges de personnel"], ["661", "Rémunérations directes versées au personnel national"],
  ["7", "Comptes de produits des activités ordinaires"], ["70", "Ventes"], ["701", "Ventes de marchandises"], ["706", "Services vendus"], ["707", "Produits accessoires"],
  ["8", "Comptes des autres charges et des autres produits"], ["9", "Comptes des engagements hors bilan et de comptabilité analytique de gestion"],
];
const comptes: Compte[] = REF.map(([numero, libelle]) => ({ id: uid(), numero, libelle, imputable: numero.length >= 3 && numero[0] !== "9", actif: true, source: "reference" }));
const journaux = [["AC", "Achats", "purchases"], ["VT", "Ventes", "sales"], ["BQ", "Banque", "bank"], ["CA", "Caisse", "cash"], ["OD", "Opérations diverses", "general"]]
  .map(([code, libelle, type]) => ({ id: uid(), code, libelle, type, actif: true }));
const exercices = [{ id: uid(), code: String(AN), debut: `${AN}-01-01`, fin: `${AN}-12-31`, statut: "ouvert" as "ouvert" | "cloture", clotureLe: null as string | null }];
let groupes = [["52", "Banques", "treasury.read"], ["56", "Banques, crédits de trésorerie et d'escompte", "treasury.read"], ["42", "Personnel", "payroll.read"], ["66", "Charges de personnel", "payroll.read"], ["13", "Résultat net de l'exercice", "reports.read"]]
  .map(([prefixe, libelle, permission]) => ({ id: uid(), prefixe, libelle, permission }));
let separation = true;
const ecritures: Ecr[] = [];

const C = (num: string) => comptes.find((c) => c.numero === num)!;
const J = (code: string) => journaux.find((j) => j.code === code)!;

export function initialiserComptabilite(ids: Record<string, string>) {
  if (ecritures.length) return;
  const paul = ids["paul.ngaro@demo.cm"], ousmane = ids["ousmane.djibrine@demo.cm"], joseph = ids["joseph.atangana@demo.cm"];
  const ajouter = (j: string, jour: string, piece: string, libelle: string, auteur: string, l: [string, number, number][], validateur: string | null) => {
    const e: Ecr = { id: uid(), statut: "brouillard", numero: null, journalId: J(j).id, exerciceId: exercices[0].id, date: `${AN}-${jour}`, piece, libelle, auteur,
      creeLe: `${AN}-${jour}T09:00:00Z`, modifieLe: `${AN}-${jour}T09:00:00Z`, validateur: null, valideeLe: null, extourneDe: null, motif: null,
      lignes: l.map(([c, d, cr]) => ({ compteId: C(c).id, libelle: null, debit: d, credit: cr })) };
    ecritures.push(e);
    if (validateur) valider(e, validateur);
  };
  ajouter("BQ", "01-05", "BQ-DEMO-001", "Apport initial en capital", ousmane, [["521", 500000, 0], ["101", 0, 500000]], joseph);
  ajouter("VT", "01-12", "VT-DEMO-001", "Vente au comptant", paul, [["571", 500000, 0], ["701", 0, 500000]], ousmane);
  ajouter("AC", "01-15", "FAC-DEMO-001", "Achat de fournitures de bureau", paul, [["605", 150000, 0], ["401", 0, 150000]], ousmane);
  ajouter("CA", "01-20", "CA-DEMO-001", "Petite dépense de caisse", paul, [["605", 100000, 0], ["571", 0, 100000]], ousmane);
  ajouter("AC", "02-03", "FAC-DEMO-002", "Facture d'électricité (à valider)", paul, [["605", 45000, 0], ["401", 0, 45000]], null);
}

function valider(e: Ecr, par: string) {
  e.statut = "validee"; e.validateur = par; e.valideeLe = new Date().toISOString();
  e.numero = Math.max(0, ...ecritures.filter((x) => x.journalId === e.journalId && x.exerciceId === e.exerciceId && x.numero).map((x) => x.numero!)) + 1;
}

/** Écriture générée par une opération (facture, mouvement) : brouillard, à valider par le comptable. */
export function genererEcriture(journal: string, date: string, piece: string, libelle: string, auteur: string, origine: Origine, lignes: [string, number, number][]) {
  const f = exercices.find((x) => x.statut === "ouvert" && date >= x.debut && date <= x.fin);
  if (!f) throw Object.assign(new Error("exercice"), { code: "exercice_absent", message: "Aucun exercice ouvert ne contient cette date." });
  const e: Ecr = { id: uid(), statut: "brouillard", numero: null, journalId: J(journal).id, exerciceId: f.id, date, piece, libelle, auteur,
    creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), validateur: null, valideeLe: null, extourneDe: null, motif: null, origine,
    lignes: lignes.filter(([, d, c]) => d || c).map(([c, d, cr]) => ({ compteId: C(c).id, libelle: null, debit: d, credit: cr })) };
  ecritures.push(e);
  return e.id;
}
/** Historique de démonstration : écriture générée puis validée par une autre personne que son auteur. */
export function validerEcritureDemo(id: string, par: string) { const e = ecritures.find((x) => x.id === id); if (e) valider(e, par); }
export const lignesEcriture = (id: string) => ecritures.find((e) => e.id === id)?.lignes.map((l) => [comptes.find((c) => c.id === l.compteId)!.numero, l.debit, l.credit] as [string, number, number]) ?? [];
export function etatEcriture(id: string | null) {
  const e = id ? ecritures.find((x) => x.id === id) : null;
  return e ? { id: e.id, statut: e.statut, numero: e.numero } : null;
}
export const brouillonsGeneres = () => ecritures.filter((e) => e.origine && e.statut === "brouillard").length;
export const compteNumero = (num: string) => C(num);
export const comptesProtegesPour = (perms: Set<string>) => (num: string) => groupes.some((g) => num.startsWith(g.prefixe) && !perms.has(g.permission));

export function traiterComptabilite(m: string, chemin: string, q: Q, c: any, o: Outils): unknown {
  const [, , , r1, r2, r3] = chemin.split("/");   // /api/comptabilite/<r1>/<r2>/<r3>
  const perms = o.permissions();
  const masque = (cp: Compte) => groupes.some((g) => cp.numero.startsWith(g.prefixe) && !perms.has(g.permission));
  const compte = (id: string) => comptes.find((x) => x.id === id);
  const ecrVisible = (e: Ecr) => !e.lignes.some((l) => masque(compte(l.compteId)!));
  const tot = (e: Ecr) => ({ d: e.lignes.reduce((s, l) => s + l.debit, 0), c: e.lignes.reduce((s, l) => s + l.credit, 0) });
  const equilibree = (e: Ecr) => { const t = tot(e); return t.d === t.c && t.d > 0 && e.lignes.length >= 2; };
  const ex = (id?: string | null) => exercices.find((x) => x.id === id) ?? exercices.find((x) => x.statut === "ouvert") ?? exercices[0];
  const vue = (e: Ecr) => {
    const j = journaux.find((x) => x.id === e.journalId)!, f = ex(e.exerciceId), t = tot(e);
    const orig = e.extourneDe ? ecritures.find((x) => x.id === e.extourneDe) : null, par = ecritures.find((x) => x.extourneDe === e.id);
    return {
      id: e.id, statut: e.statut, numero: e.numero, journal: { id: j.id, code: j.code, libelle: j.libelle }, exercice: { id: f.id, code: f.code, ouvert: f.statut === "ouvert" },
      date: e.date, piece: e.piece, datePiece: null, libelle: e.libelle, auteur: { id: e.auteur, nom: o.nomDe(e.auteur) }, creeLe: e.creeLe, modifieLe: e.modifieLe,
      validateur: e.validateur ? { id: e.validateur, nom: o.nomDe(e.validateur) } : null, valideeLe: e.valideeLe,
      extourneDe: orig ? { id: orig.id, numero: orig.numero, journal: journaux.find((x) => x.id === orig.journalId)!.code, motif: e.motif } : null,
      extourneePar: par ? { id: par.id, numero: par.numero } : null,
      lignes: e.lignes.map((l, i) => ({ ordre: i + 1, compteId: l.compteId, compte: compte(l.compteId)!.numero, compteLibelle: compte(l.compteId)!.libelle, libelle: l.libelle, debit: l.debit, credit: l.credit })),
      totalDebit: t.d, totalCredit: t.c, equilibree: equilibree(e), origine: e.origine ?? null,
    };
  };
  const resume = (e: Ecr) => { const v = vue(e); return { id: v.id, statut: v.statut, numero: v.numero, date: v.date, journal: v.journal.code, piece: v.piece, libelle: v.libelle, auteur: v.auteur.nom, totalDebit: v.totalDebit, totalCredit: v.totalCredit, equilibree: v.equilibree, extourne: !!v.extourneDe, extournee: !!v.extourneePar, origine: e.origine ? (e.origine.type === "mouvement" ? "tresorerie" : e.origine.type) : null }; };
  const lireEcriture = () => {
    if (!c.piece || !String(c.piece).trim()) throw o.erreur(400, "donnees_invalides", "Référence de pièce obligatoire.");
    if (!c.libelle || String(c.libelle).trim().length < 2) throw o.erreur(400, "donnees_invalides", "Libellé obligatoire.");
    const f = exercices.find((x) => x.statut === "ouvert" && c.date >= x.debut && c.date <= x.fin);
    if (!f) throw o.erreur(409, "exercice_absent", "Aucun exercice ouvert ne contient cette date.");
    for (const l of c.lignes as Ligne[]) {
      const cp = compte(l.compteId);
      if (!cp) throw o.erreur(400, "compte_inconnu", "Compte inconnu.");
      if (masque(cp)) { o.tracer({ type: "security", action: "access_denied", resultat: "denied", details: { compteProtege: cp.numero } }); throw o.erreur(403, "compte_protege", `Le compte ${cp.numero} est protégé : vous n'avez pas la permission d'y imputer.`); }
      if (!cp.imputable || !cp.actif) throw o.erreur(400, "compte_non_imputable", `Le compte ${cp.numero} n'est pas imputable ou est archivé.`);
      if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit > 0) === (l.credit > 0)) throw o.erreur(400, "donnees_invalides", "Chaque ligne porte soit un débit, soit un crédit (entier positif).");
    }
    return { exerciceId: f.id, journalId: c.journalId, date: c.date, piece: String(c.piece).trim(), libelle: String(c.libelle).trim(), lignes: (c.lignes as Ligne[]).map((l) => ({ ...l, libelle: l.libelle || null })) };
  };
  const lignesEtat = () => {
    const f = ex(q.get("exercice")), du = q.get("du") || f.debut, au = q.get("au") || f.fin, cpt = q.get("compte") ?? "", jn = q.get("journal"), br = q.get("brouillons") === "oui";
    const lignes = ecritures.filter((e) => e.exerciceId === f.id && (br || e.statut === "validee") && (!jn || e.journalId === jn) && e.date <= au)
      .flatMap((e) => e.lignes.map((l) => ({ e, l, cp: compte(l.compteId)! }))).filter((x) => !masque(x.cp) && x.cp.numero.startsWith(cpt))
      .sort((a, b) => a.cp.numero.localeCompare(b.cp.numero) || a.e.date.localeCompare(b.e.date));
    const nbMasques = new Set(ecritures.filter((e) => e.exerciceId === f.id).flatMap((e) => e.lignes.map((l) => compte(l.compteId)!)).filter(masque).map((x) => x.id)).size;
    return { f, du, au, lignes, nbMasques, partiel: !!cpt || !!jn, br };
  };

  switch (r1) {
    case "comptes":
      if (r2 === "import") { o.exiger("accounting.admin", true); return { ajoutes: 0, existants: 0, erreurs: ["Démonstration : l'import n'est pas simulé."] }; }
      if (r2 && m === "PATCH") { o.exiger("accounting.admin"); const cp = compte(r2); if (!cp) throw o.erreur(404, "introuvable", "Compte introuvable."); if ("actif" in c) cp.actif = !!c.actif; o.tracer({ type: "accounting", action: "account_update", objetType: "account", objetId: cp.id }); return cp; }
      if (m === "POST") {
        o.exiger("accounting.admin");
        const num = String(c.numero ?? ""), lib = String(c.libelle ?? "").trim();
        if (!/^[1-8][0-9]{2,11}$/.test(num) || lib.length < 2) throw o.erreur(400, "donnees_invalides", "Numéro de 3 à 12 chiffres (classes 1 à 8) et intitulé obligatoires.");
        if (comptes.some((x) => x.numero === num)) throw o.erreur(409, "doublon", "Ce numéro existe déjà.");
        const parent = comptes.filter((x) => num.startsWith(x.numero)).sort((a, b) => b.numero.length - a.numero.length)[0];
        const cp = { id: uid(), numero: num, libelle: lib, imputable: true, actif: true, source: "company" };
        comptes.push(cp); comptes.sort((a, b) => a.numero.localeCompare(b.numero));
        o.tracer({ type: "accounting", action: "account_create", objetType: "account", objetId: cp.id });
        return { ...cp, parent: { numero: parent.numero, libelle: parent.libelle } };
      }
      o.exiger("accounting.read");
      return comptes.filter((x) => (!q.get("recherche") || (x.numero + " " + x.libelle).toLowerCase().includes(q.get("recherche")!.toLowerCase()))
        && (!q.get("classe") || x.numero[0] === q.get("classe")) && (q.get("imputables") !== "oui" || (x.imputable && x.actif && !masque(x))))
        .map((x) => ({ ...x, classe: Number(x.numero[0]), protege: masque(x), utilise: ecritures.some((e) => e.lignes.some((l) => l.compteId === x.id)), aVerifier: x.source === "reference" }));

    case "journaux":
      if (m === "POST") { o.exiger("accounting.admin"); const j = { id: uid(), code: String(c.code), libelle: String(c.libelle), type: String(c.type), actif: true }; journaux.push(j); return j; }
      o.exiger("accounting.read");
      return journaux.map((j) => ({ ...j, validees: ecritures.filter((e) => e.journalId === j.id && e.statut === "validee").length, brouillons: ecritures.filter((e) => e.journalId === j.id && e.statut === "brouillard").length }));

    case "exercices":
      if (r3 === "cloture") {
        o.exiger("accounting.admin", true); const mo = o.motif(c); const f = exercices.find((x) => x.id === r2)!;
        if (ecritures.some((e) => e.exerciceId === f.id && e.statut === "brouillard")) throw o.erreur(409, "regle_comptable", `Clôture impossible : des brouillards restent dans l'exercice ${f.code}. Validez-les ou supprimez-les.`);
        f.statut = "cloture"; f.clotureLe = new Date().toISOString(); o.tracer({ type: "accounting", action: "fiscal_year_close", motif: mo }); return { ok: true };
      }
      if (m === "POST") { o.exiger("accounting.admin"); const f = { id: uid(), code: String(c.code), debut: c.debut, fin: c.fin, statut: "ouvert" as const, clotureLe: null }; exercices.unshift(f); return f; }
      o.exiger("accounting.read");
      return exercices.map((f) => ({ ...f, brouillons: ecritures.filter((e) => e.exerciceId === f.id && e.statut === "brouillard").length, validees: ecritures.filter((e) => e.exerciceId === f.id && e.statut === "validee").length }));

    case "parametres":
      if (m === "PATCH") { o.exiger("accounting.admin", true); separation = !!c.separationSaisieValidation; o.tracer({ type: "security", action: "accounting_settings_change" }); return { separationSaisieValidation: separation }; }
      o.exiger("accounting.read");
      return { separationSaisieValidation: separation, devise: { code: "XAF", decimales: 0 }, comptesProteges: groupes.map((g) => ({ ...g, accessible: perms.has(g.permission) })) };

    case "comptes-proteges":
      o.exiger("accounting.admin", true); o.motif(c);
      groupes = (c.groupes as { prefixe: string; libelle: string; permission: string }[]).map((g) => ({ id: uid(), ...g }));
      o.tracer({ type: "security", action: "protected_accounts_change" }); return { ok: true };

    case "tableau-de-bord": {
      o.exiger("accounting.read");
      const f = ex(q.get("exercice")), l = ecritures.filter((e) => e.exerciceId === f.id && ecrVisible(e)), v = l.filter((e) => e.statut === "validee");
      return { exercice: { id: f.id, code: f.code, debut: f.debut, fin: f.fin, ouvert: f.statut === "ouvert" }, validees: v.length, brouillons: l.length - v.length,
        brouillonsDesequilibres: l.filter((e) => e.statut === "brouillard" && !equilibree(e)).length,
        totalDebit: v.reduce((s, e) => s + tot(e).d, 0), totalCredit: v.reduce((s, e) => s + tot(e).c, 0), comptesMasques: lignesEtat().nbMasques };
    }

    case "grand-livre": {
      o.exiger(r2 === "export" ? "accounting.export" : "accounting.read");
      const s = lignesEtat();
      if (r2 === "export") { o.tracer({ type: "accounting", action: "export", details: { etat: "grand-livre" } }); return "﻿démonstration"; }
      const blocs = new Map<string, any>();
      for (const { e, l, cp } of s.lignes) {
        const b = blocs.get(cp.id) ?? { id: cp.id, compte: cp.numero, libelle: cp.libelle, soldeOuverture: 0, mouvements: [], totalDebit: 0, totalCredit: 0, soldeCloture: 0 };
        blocs.set(cp.id, b);
        if (e.date < s.du) { b.soldeOuverture += l.debit - l.credit; b.soldeCloture = b.soldeOuverture; continue; }
        b.totalDebit += l.debit; b.totalCredit += l.credit; b.soldeCloture = b.soldeOuverture + b.totalDebit - b.totalCredit;
        b.mouvements.push({ ecritureId: e.id, date: e.date, journal: journaux.find((j) => j.id === e.journalId)!.code, numero: e.numero, statut: e.statut, piece: e.piece, libelle: l.libelle || e.libelle, debit: l.debit, credit: l.credit, solde: b.soldeCloture });
      }
      const cs = [...blocs.values()];
      return { exercice: { id: s.f.id, code: s.f.code, debut: s.f.debut, fin: s.f.fin }, du: s.du, au: s.au, comptesMasques: s.nbMasques, comptes: cs,
        totaux: { debit: cs.reduce((x, b) => x + b.totalDebit, 0), credit: cs.reduce((x, b) => x + b.totalCredit, 0) } };
    }

    case "balance": {
      o.exiger(r2 === "export" ? "accounting.export" : "accounting.read");
      if (r2 === "export") { o.tracer({ type: "accounting", action: "export", details: { etat: "balance" } }); return "﻿démonstration"; }
      const s = lignesEtat(), parCompte = new Map<string, any>();
      for (const { e, l, cp } of s.lignes) {
        const b = parCompte.get(cp.id) ?? { compte: cp.numero, libelle: cp.libelle, classe: Number(cp.numero[0]), soldeOuverture: 0, mouvementDebit: 0, mouvementCredit: 0 };
        parCompte.set(cp.id, b);
        if (e.date < s.du) b.soldeOuverture += l.debit - l.credit; else { b.mouvementDebit += l.debit; b.mouvementCredit += l.credit; }
      }
      const lignes = [...parCompte.values()].map((b) => { const so = b.soldeOuverture + b.mouvementDebit - b.mouvementCredit; return { ...b, soldeDebiteur: so > 0 ? so : 0, soldeCrediteur: so < 0 ? -so : 0 }; });
      const sum = (k: string) => lignes.reduce((x, l) => x + l[k], 0);
      const totaux = { mouvementDebit: sum("mouvementDebit"), mouvementCredit: sum("mouvementCredit"), soldeDebiteur: sum("soldeDebiteur"), soldeCrediteur: sum("soldeCrediteur") };
      return { exercice: { id: s.f.id, code: s.f.code }, du: s.du, au: s.au, brouillonsInclus: s.br, lignes, totaux, comptesMasques: s.nbMasques, complete: s.nbMasques === 0 && !s.partiel,
        equilibree: totaux.mouvementDebit === totaux.mouvementCredit && totaux.soldeDebiteur === totaux.soldeCrediteur,
        resultat: perms.has("reports.read") && s.nbMasques === 0 ? -lignes.filter((l) => l.classe >= 6 && l.classe <= 8).reduce((x, l) => x + l.soldeDebiteur - l.soldeCrediteur, 0) : null };
    }

    case "ecritures": {
      if (!r2) {
        if (m === "POST") {
          o.exiger("accounting.create");
          const e: Ecr = { id: uid(), statut: "brouillard", numero: null, ...lireEcriture(), auteur: o.moi().id, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), validateur: null, valideeLe: null, extourneDe: null, motif: null };
          ecritures.push(e); o.tracer({ type: "accounting", action: "entry_create", objetType: "entry", objetId: e.id }); return vue(e);
        }
        o.exiger("accounting.read");
        const r = (q.get("recherche") ?? "").toLowerCase();
        const l = ecritures.filter((e) => ecrVisible(e) && (!q.get("exercice") || e.exerciceId === q.get("exercice")) && (!q.get("journal") || e.journalId === q.get("journal"))
          && (!q.get("statut") || e.statut === q.get("statut")) && (q.get("origine") !== "operations" || !!e.origine) && (q.get("origine") !== "saisie" || !e.origine) && (!r || (e.libelle + " " + e.piece).toLowerCase().includes(r)))
          .sort((a, b) => b.date.localeCompare(a.date) || b.creeLe.localeCompare(a.creeLe)).map(resume);
        return o.page(l, q);
      }
      if (r2 === "validation-groupee" && m === "POST") {
        o.exiger("accounting.approve", true);
        const resultats = [...new Set(c.ids as string[])].map((idE) => {
          const x = ecritures.find((y) => y.id === idE);
          if (!x || !ecrVisible(x)) return { id: idE, ok: false, erreur: "Écriture introuvable." };
          if (x.statut !== "brouillard") return { id: idE, ok: false, erreur: "Déjà validée." };
          if (!equilibree(x)) return { id: idE, ok: false, erreur: "Écriture déséquilibrée." };
          if (separation && x.auteur === o.moi().id) return { id: idE, ok: false, erreur: "Séparation des tâches : une autre personne que l'auteur doit valider cette écriture." };
          valider(x, o.moi().id); o.tracer({ type: "accounting", action: "entry_validate", objetType: "entry", objetId: x.id, details: { lot: true } });
          return { id: idE, ok: true, numero: x.numero };
        });
        return { validees: resultats.filter((x) => x.ok).length, refusees: resultats.filter((x) => !x.ok).length, resultats };
      }
      const e = ecritures.find((x) => x.id === r2);
      if (!e || !ecrVisible(e)) throw o.erreur(404, "introuvable", "Écriture introuvable.");
      if (!r3 && m === "GET") { o.exiger("accounting.read"); return vue(e); }
      if (!r3 && m === "PUT") {
        o.exiger("accounting.update");
        if (e.statut !== "brouillard") throw o.erreur(409, "ecriture_validee", "Une écriture validée ne se modifie pas. Utilisez une extourne.");
        if (e.origine) throw o.erreur(409, "ecriture_generee", `Écriture générée par ${({ facture: "la facture", avoir: "l'avoir", mouvement: "le mouvement" })[e.origine.type]} ${e.origine.reference} : corrigez l'opération d'origine.`);
        Object.assign(e, lireEcriture(), { modifieLe: new Date().toISOString() }); o.tracer({ type: "accounting", action: "entry_update", objetType: "entry", objetId: e.id }); return vue(e);
      }
      if (!r3 && m === "DELETE") {
        o.exiger("accounting.update");
        if (e.statut !== "brouillard") throw o.erreur(409, "ecriture_validee", "Une écriture validée ne se supprime pas. Utilisez une extourne.");
        if (e.origine) throw o.erreur(409, "ecriture_generee", `Écriture générée par ${({ facture: "la facture", avoir: "l'avoir", mouvement: "le mouvement" })[e.origine.type]} ${e.origine.reference} : elle ne se supprime pas.`);
        ecritures.splice(ecritures.indexOf(e), 1); o.tracer({ type: "accounting", action: "entry_delete", objetType: "entry", objetId: e.id }); return { ok: true };
      }
      if (r3 === "validation") {
        o.exiger("accounting.approve", true);
        if (!equilibree(e)) { const t = tot(e); o.tracer({ type: "accounting", action: "entry_validate", resultat: "failure" }); throw o.erreur(409, "regle_comptable", `Validation refusée : écriture déséquilibrée (débit ${t.d} ≠ crédit ${t.c}).`); }
        if (separation && e.auteur === o.moi().id) throw o.erreur(409, "regle_comptable", "Séparation des tâches : une autre personne que l'auteur doit valider cette écriture.");
        valider(e, o.moi().id); o.tracer({ type: "accounting", action: "entry_validate", objetType: "entry", objetId: e.id }); return vue(e);
      }
      if (r3 === "extourne") {
        o.exiger("accounting.cancel", true);
        const mo = o.motif(c);
        if (e.statut !== "validee") throw o.erreur(409, "brouillard", "Seule une écriture validée s'extourne.");
        if (e.extourneDe) throw o.erreur(409, "extourne_d_extourne", "Une extourne ne s'extourne pas.");
        if (ecritures.some((x) => x.extourneDe === e.id)) throw o.erreur(409, "deja_extournee", "Cette écriture a déjà été extournée.");
        const date = c.date || new Date().toISOString().slice(0, 10);
        const f = exercices.find((x) => x.statut === "ouvert" && date >= x.debut && date <= x.fin);
        if (!f) throw o.erreur(409, "exercice_absent", "Aucun exercice ouvert ne contient cette date.");
        const j = journaux.find((x) => x.id === e.journalId)!;
        const x: Ecr = { id: uid(), statut: "brouillard", numero: null, journalId: e.journalId, exerciceId: f.id, date, piece: e.piece, libelle: `Extourne ${j.code} n° ${e.numero} : ${e.libelle}`,
          auteur: o.moi().id, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), validateur: null, valideeLe: null, extourneDe: e.id, motif: mo,
          lignes: e.lignes.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) };
        ecritures.push(x); valider(x, o.moi().id);
        o.tracer({ type: "accounting", action: "entry_reverse", objetType: "entry", objetId: e.id, motif: mo }); return vue(x);
      }
    }
  }
  throw o.erreur(404, "introuvable", "Adresse inconnue.");
}
