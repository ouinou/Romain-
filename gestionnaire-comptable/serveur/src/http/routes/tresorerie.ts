import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { compteParNumero, genererEcriture } from "../../domaine/comptabilite/generation.js";
import { compteMasque } from "../../domaine/comptabilite/visibilite.js";
import { MONTANT_MAX, versEntier } from "../../domaine/comptabilite/montants.js";
import { avecReglesBase } from "../../domaine/comptabilite/erreurs.js";
import { CATEGORIES_ENTREE, CATEGORIES_SORTIE, COMPTE_TVA_RECUPERABLE, COMPTE_CLIENTS } from "../../domaine/tresorerie/categories.js";
import { exigerConfirmation, pagination, proteger, type Ctx, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";

const TYPES = { caisse: "cash", banque: "bank", mobile: "mobile" } as const;
const LIB_TYPES: Record<string, string> = { cash: "caisse", bank: "banque", mobile: "mobile money" };
const montant = z.number().int("Montant entier attendu (FCFA).").positive("Le montant doit être positif.").max(MONTANT_MAX);
const motif = z.string().trim().min(3, "Motif obligatoire (3 caractères minimum).").max(500);

/** Permission de lecture : trésorerie complète, ou seulement ses caisses attitrées. */
const peutLireTout = (ctx: Ctx) => ctx.a("treasury.read");
const exigerLecture = (ctx: Ctx) => {
  if (!ctx.a("treasury.read") && !ctx.a("cash.read"))
    throw new ErreurHttp(403, "acces_refuse", "Vous n'avez pas accès à la trésorerie.", { type: "security", action: "access_denied", resultat: "denied", details: { permission: "treasury.read|cash.read" } });
};

/** Condition SQL (alias t) : comptes de trésorerie visibles par l'utilisateur ($1 = id utilisateur). */
export const visibles = (ctx: Ctx) => peutLireTout(ctx) ? "TRUE"
  : "(t.kind = 'cash' AND EXISTS (SELECT 1 FROM treasury_account_holders h WHERE h.treasury_account_id = t.id AND h.user_id = $1))";

/** Compte de trésorerie utilisable en écriture par l'utilisateur, sinon refus tracé. */
export async function compteUtilisable(ctx: Ctx, id: string) {
  const { rows: [t] } = await ctx.c.query(
    `SELECT t.*, a.account_number, EXISTS (SELECT 1 FROM treasury_account_holders h WHERE h.treasury_account_id = t.id AND h.user_id = $2) AS attitre
       FROM treasury_accounts t JOIN accounts a ON a.id = t.account_id WHERE t.id = $1`, [id, ctx.utilisateur.id]);
  if (!t) throw nonTrouve("Compte de trésorerie");
  const autorise = ctx.a("treasury.create") || (t.kind === "cash" && t.attitre && ctx.a("cash.create"));
  if (!autorise) throw new ErreurHttp(403, "acces_refuse", `Vous n'êtes pas autorisé à enregistrer des opérations sur « ${t.name} ».`,
    { type: "security", action: "access_denied", resultat: "denied", objetType: "treasury_account", objetId: id });
  if (!t.active) throw new ErreurHttp(409, "compte_inactif", `Le compte de trésorerie « ${t.name} » est désactivé.`);
  return t as { id: string; name: string; kind: string; account_id: string; journal_id: string; account_number: string };
}

/** Compte de contrepartie : par catégorie (utilisateurs non comptables) ou par compte (comptables). */
async function contrepartie(ctx: Ctx, sens: "in" | "out", categorie?: string, compteId?: string) {
  if (compteId) {
    if (!ctx.a("accounting.read")) throw new ErreurHttp(403, "acces_refuse", "Le choix direct d'un compte est réservé aux personnes ayant accès à la comptabilité ; choisissez une catégorie.");
    const { rows: [a] } = await ctx.c.query(`SELECT a.id, a.account_number, a.label, a.postable, a.active, ${compteMasque("a", 2)} AS masque FROM accounts a WHERE a.id = $1`, [compteId, [...ctx.permissions]]);
    if (!a || !a.postable || !a.active) throw new ErreurHttp(400, "compte_non_imputable", "Compte inconnu, archivé ou non imputable.");
    if (a.masque) throw new ErreurHttp(403, "compte_protege", `Le compte ${a.account_number} est protégé.`, { type: "security", action: "access_denied", resultat: "denied", details: { compteProtege: a.account_number } });
    return { id: a.id as string, numero: a.account_number as string, libelle: a.label as string, categorie: null, tva: true };
  }
  const cat = (sens === "in" ? CATEGORIES_ENTREE : CATEGORIES_SORTIE).find((x) => x.code === categorie);
  if (!cat) throw new ErreurHttp(400, "categorie_inconnue", "Choisissez une catégorie d'opération.");
  const { rows: [a] } = await ctx.c.query(`SELECT a.id, a.label, ${compteMasque("a", 2)} AS masque FROM accounts a WHERE a.account_number = $1`, [cat.compte, [...ctx.permissions]]);
  if (a?.masque) throw new ErreurHttp(403, "compte_protege", `La catégorie « ${cat.libelle} » est réservée aux personnes autorisées.`, { type: "security", action: "access_denied", resultat: "denied", details: { categorie: cat.code } });
  return { id: await compteParNumero(ctx.c, cat.compte), numero: cat.compte, libelle: a?.label ?? cat.libelle, categorie: cat.code, tva: !!cat.tva };
}

async function soldeCompte(c: Client, id: string) {
  const { rows: [r] } = await c.query("SELECT coalesce(sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS s FROM treasury_movements WHERE treasury_account_id = $1", [id]);
  return versEntier(r.s);
}

/** Montant restant dû sur une facture (TTC − règlements nets). */
export async function resteDu(c: Client, factureId: string) {
  const { rows: [f] } = await c.query(
    `SELECT i.number, i.total_ttc, coalesce((SELECT sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END) FROM treasury_movements m WHERE m.invoice_id = i.id), 0) AS paye
       FROM invoices i WHERE i.id = $1`, [factureId]);
  if (!f) throw nonTrouve("Facture");
  return { numero: f.number as string, reste: versEntier(f.total_ttc) - versEntier(f.paye) };
}

interface NouveauMouvement {
  compte: Awaited<ReturnType<typeof compteUtilisable>>; sens: "in" | "out"; kind: string; montant: number; tva: number;
  date: string; libelle: string; reference: string; categorie: string | null; contrepartieId: string; tvaCompteId: string | null;
  factureId?: string | null; transfertGroupe?: string | null; annulationDe?: string | null; raison?: string | null;
}

/** Insère un mouvement (la base attribue numéro et référence, contrôle le solde de caisse) et renvoie sa ligne. */
async function insererMouvement(ctx: Ctx, m: NouveauMouvement) {
  const { rows: [r] } = await avecReglesBase(() => ctx.c.query(
    `INSERT INTO treasury_movements (treasury_account_id, direction, kind, amount, tax_amount, movement_date, reference, label, category,
                                     counterpart_account_id, tax_account_id, invoice_id, transfer_group, reversal_of, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, reference, sequence_no`,
    [m.compte.id, m.sens, m.kind, m.montant, m.tva, m.date, m.reference, m.libelle, m.categorie, m.contrepartieId, m.tvaCompteId,
     m.factureId ?? null, m.transfertGroupe ?? null, m.annulationDe ?? null, m.raison ?? null, ctx.utilisateur.id]));
  return r as { id: string; reference: string; sequence_no: number };
}

/** Écriture brouillard d'un mouvement simple : trésorerie contre contrepartie (et TVA récupérable). */
async function ecritureMouvement(ctx: Ctx, m: NouveauMouvement, mvt: { id: string; reference: string }) {
  const lignes = m.sens === "in"
    ? [{ compteId: m.compte.account_id, debit: m.montant, credit: 0 }, { compteId: m.contrepartieId, debit: 0, credit: m.montant }]
    : [{ compteId: m.contrepartieId, debit: m.montant - m.tva, credit: 0 },
       ...(m.tva ? [{ compteId: m.tvaCompteId!, debit: m.tva, credit: 0 }] : []),
       { compteId: m.compte.account_id, debit: 0, credit: m.montant }];
  return genererEcriture(ctx.c, { journalId: m.compte.journal_id, date: m.date, piece: mvt.reference, libelle: m.libelle, auteur: ctx.utilisateur.id,
    source: { type: "treasury_movement", id: mvt.id }, lignes });
}

const vueMouvement = (r: Record<string, any>) => ({
  id: r.id, compte: { id: r.treasury_account_id, nom: r.compte_nom, type: r.compte_type }, sens: r.direction === "in" ? "entree" : "sortie",
  nature: r.kind, montant: versEntier(r.amount), tva: versEntier(r.tax_amount), date: r.date, reference: r.reference, libelle: r.label,
  categorie: r.category, contrepartie: { numero: r.cp_numero, libelle: r.cp_libelle }, factureId: r.invoice_id, facture: r.facture_numero ?? null,
  annulationDe: r.reversal_of, annuleePar: r.annule_par, motif: r.reason, auteur: r.auteur, creeLe: r.created_at,
  ecriture: r.entry_id ? { id: r.entry_id, statut: r.entry_status === "validated" ? "validee" : "brouillard", numero: r.entry_number } : null,
});

const SELECT_MOUVEMENTS = `
  SELECT m.*, m.movement_date::text AS date, t.name AS compte_nom, t.kind AS compte_type, a.account_number AS cp_numero, a.label AS cp_libelle,
         u.full_name AS auteur, i.number AS facture_numero,
         (SELECT x.id FROM treasury_movements x WHERE x.reversal_of = m.id) AS annule_par,
         e.id AS entry_id, e.status AS entry_status, e.entry_number
    FROM treasury_movements m
    JOIN treasury_accounts t ON t.id = m.treasury_account_id
    JOIN accounts a ON a.id = m.counterpart_account_id
    JOIN app_users u ON u.id = m.created_by
    LEFT JOIN invoices i ON i.id = m.invoice_id
    LEFT JOIN journal_entries e ON e.source_type = 'treasury_movement' AND e.source_id = m.id`;

export function routesTresorerie(app: FastifyInstance, deps: Dependances) {
  /* ------------------------------------------------------------ Comptes de trésorerie */
  app.get("/api/tresorerie/comptes", proteger(deps, { permission: null }, async (_req, ctx) => {
    exigerLecture(ctx);
    const { rows } = await ctx.c.query(
      `SELECT t.id, t.kind, t.name, t.bank_name, t.account_reference, t.active, a.account_number, a.label AS compte_libelle, j.code AS journal,
              coalesce(sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END), 0) AS solde,
              coalesce(sum(m.amount) FILTER (WHERE m.direction = 'in' AND m.movement_date = current_date), 0) AS entrees_jour,
              coalesce(sum(m.amount) FILTER (WHERE m.direction = 'out' AND m.movement_date = current_date), 0) AS sorties_jour,
              (SELECT coalesce(json_agg(json_build_object('id', u.id, 'nom', u.full_name)), '[]') FROM treasury_account_holders h JOIN app_users u ON u.id = h.user_id WHERE h.treasury_account_id = t.id) AS caissiers
         FROM treasury_accounts t JOIN accounts a ON a.id = t.account_id JOIN journals j ON j.id = t.journal_id
         LEFT JOIN treasury_movements m ON m.treasury_account_id = t.id
        WHERE ${visibles(ctx)} ${peutLireTout(ctx) ? "AND $1::uuid IS NOT NULL" : ""}
        GROUP BY t.id, a.account_number, a.label, j.code ORDER BY t.kind, t.name`, [ctx.utilisateur.id]);
    return rows.map((t) => ({
      id: t.id, type: t.kind, nom: t.name, banque: t.bank_name, referenceBancaire: t.account_reference, actif: t.active,
      compte: { numero: t.account_number, libelle: t.compte_libelle }, journal: t.journal, solde: versEntier(t.solde),
      entreesJour: versEntier(t.entrees_jour), sortiesJour: versEntier(t.sorties_jour), caissiers: t.caissiers,
    }));
  }));

  app.post("/api/tresorerie/comptes", proteger(deps, { permission: "treasury.admin" }, async (req, ctx) => {
    const d = z.object({
      type: z.enum(["caisse", "banque", "mobile"]), nom: z.string().trim().min(2).max(80),
      banque: z.string().trim().max(80).optional(), referenceBancaire: z.string().trim().max(60).optional(), compteId: z.string().regex(UUID).optional(),
    }).parse(req.body);
    const kind = TYPES[d.type];
    let compteId = d.compteId;
    if (!compteId) {
      // Sous-compte créé automatiquement : 5711, 5712… pour une caisse ; 5211, 5212… pour une banque ou du mobile money.
      const base = kind === "cash" ? "571" : "521";
      const { rows } = await ctx.c.query("SELECT account_number FROM accounts WHERE account_number LIKE $1 || '_%'", [base]);
      const pris = new Set(rows.map((r) => r.account_number));
      let i = 1; while (pris.has(base + i) && i < 9) i++;
      const numero = pris.has(base + i) ? base + String(Date.now()).slice(-3) : base + i;
      const { rows: [a] } = await avecReglesBase(() => ctx.c.query(
        "INSERT INTO accounts (account_number, label, postable, source) VALUES ($1,$2,true,'company') RETURNING id", [numero, `${d.nom}`.slice(0, 200)]));
      compteId = a.id;
      await ctx.journaliser({ type: "accounting", action: "account_create", objetType: "account", objetId: a.id, apres: { numero, libelle: d.nom }, details: { origine: "compte de trésorerie" } });
    }
    const { rows: [j] } = await ctx.c.query("SELECT id FROM journals WHERE code = $1", [kind === "cash" ? "CA" : "BQ"]);
    if (!j) throw new ErreurHttp(409, "journal_manquant", "Le journal CA ou BQ est introuvable.");
    const { rows: [t] } = await avecReglesBase(() => ctx.c.query(
      "INSERT INTO treasury_accounts (kind, name, account_id, journal_id, bank_name, account_reference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [kind, d.nom, compteId, j.id, d.banque ?? null, d.referenceBancaire ?? null]));
    await ctx.journaliser({ type: "treasury", action: "account_create", objetType: "treasury_account", objetId: t.id, apres: { type: d.type, nom: d.nom } });
    return { id: t.id };
  }));

  app.patch("/api/tresorerie/comptes/:id", proteger(deps, { permission: "treasury.admin" }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw nonTrouve("Compte de trésorerie");
    const d = z.object({ nom: z.string().trim().min(2).max(80).optional(), actif: z.boolean().optional(), caissiers: z.array(z.string().regex(UUID)).max(50).optional() }).parse(req.body);
    const { rows: [avant] } = await ctx.c.query("SELECT name, active, kind FROM treasury_accounts WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) throw nonTrouve("Compte de trésorerie");
    await avecReglesBase(() => ctx.c.query("UPDATE treasury_accounts SET name = coalesce($2, name), active = coalesce($3, active) WHERE id = $1", [id, d.nom ?? null, d.actif ?? null]));
    let caissiers: string[] | undefined;
    if (d.caissiers) {
      // Attribuer une caisse donne accès à de l'argent : confirmation par mot de passe exigée.
      exigerConfirmation(ctx);
      if (avant.kind !== "cash" && d.caissiers.length) throw new ErreurHttp(400, "pas_une_caisse", "Seule une caisse s'attribue à des caissiers.");
      await ctx.c.query("DELETE FROM treasury_account_holders WHERE treasury_account_id = $1", [id]);
      for (const u of new Set(d.caissiers)) await avecReglesBase(() => ctx.c.query("INSERT INTO treasury_account_holders (treasury_account_id, user_id) VALUES ($1,$2)", [id, u]));
      caissiers = d.caissiers;
    }
    await ctx.journaliser({ type: "treasury", action: "account_update", objetType: "treasury_account", objetId: id,
      avant: { nom: avant.name, actif: avant.active }, apres: { nom: d.nom ?? avant.name, actif: d.actif ?? avant.active, caissiers } });
    return { ok: true };
  }));

  // Personnes pouvant être attitrées à une caisse : comptes actifs disposant du droit « caisse : créer ».
  app.get("/api/tresorerie/caissiers-possibles", proteger(deps, { permission: "treasury.admin" }, async (_req, ctx) => {
    const { rows } = await ctx.c.query(
      `SELECT DISTINCT u.id, u.full_name FROM app_users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.archived_at IS NULL
         JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id AND p.permission_key = 'cash.create'
        WHERE u.status = 'active' ORDER BY u.full_name`);
    return rows.map((r) => ({ id: r.id, nom: r.full_name }));
  }));

  /* ------------------------------------------------------------ Catégories */
  app.get("/api/tresorerie/categories", proteger(deps, { permission: null }, async (_req, ctx) => {
    exigerLecture(ctx);
    const { rows } = await ctx.c.query(`SELECT a.account_number, ${compteMasque("a", 1)} AS masque FROM accounts a WHERE a.postable AND a.active`, [[...ctx.permissions]]);
    const dispo = new Map(rows.map((r) => [r.account_number, !r.masque]));
    const f = (l: typeof CATEGORIES_ENTREE) => l.filter((c) => dispo.get(c.compte)).map((c) => ({ code: c.code, libelle: c.libelle, compte: c.compte, tva: !!c.tva }));
    return { entrees: f(CATEGORIES_ENTREE), sorties: f(CATEGORIES_SORTIE) };
  }));

  /* ------------------------------------------------------------ Mouvements */
  app.get("/api/tresorerie/mouvements", proteger(deps, { permission: null }, async (req, ctx) => {
    exigerLecture(ctx);
    const q = req.query as Record<string, string | undefined>;
    const { page, taille, offset } = pagination(q);
    const f = [visibles(ctx).replaceAll("t.", "t.")], v: unknown[] = [ctx.utilisateur.id];
    const aj = (sql: string, val: unknown) => { v.push(val); f.push(sql.replaceAll("?", `$${v.length}`)); };
    if (q.compte && UUID.test(q.compte)) aj("m.treasury_account_id = ?", q.compte);
    if (q.du && /^\d{4}-\d{2}-\d{2}$/.test(q.du)) aj("m.movement_date >= ?::date", q.du);
    if (q.au && /^\d{4}-\d{2}-\d{2}$/.test(q.au)) aj("m.movement_date <= ?::date", q.au);
    if (q.sens === "entree" || q.sens === "sortie") aj("m.direction = ?", q.sens === "entree" ? "in" : "out");
    if (q.recherche) aj("(m.label ILIKE ? OR m.reference ILIKE ?)", `%${q.recherche.trim()}%`);
    const where = "WHERE " + f.join(" AND ") + (peutLireTout(ctx) ? " AND $1::uuid IS NOT NULL" : "");
    const { rows: [{ total }] } = await ctx.c.query(`SELECT count(*)::int AS total FROM treasury_movements m JOIN treasury_accounts t ON t.id = m.treasury_account_id ${where}`, v);
    const { rows } = await ctx.c.query(`${SELECT_MOUVEMENTS} ${where} ORDER BY m.movement_date DESC, m.created_at DESC LIMIT ${taille} OFFSET ${offset}`, v);
    return { elements: rows.map(vueMouvement), total, page, taille };
  }));

  app.get("/api/tresorerie/mouvements/:id", proteger(deps, { permission: null }, async (req, ctx) => {
    exigerLecture(ctx);
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw nonTrouve("Mouvement");
    const { rows: [r] } = await ctx.c.query(`${SELECT_MOUVEMENTS} WHERE m.id = $2 AND ${visibles(ctx)} ${peutLireTout(ctx) ? "AND $1::uuid IS NOT NULL" : ""}`, [ctx.utilisateur.id, id]);
    if (!r) throw nonTrouve("Mouvement");
    return vueMouvement(r);
  }));

  // Encaissement ou dépense.
  app.post("/api/tresorerie/mouvements", proteger(deps, { permission: null }, async (req, ctx) => {
    const d = z.object({
      compteTresorerieId: z.string().regex(UUID), sens: z.enum(["entree", "sortie"]), montant, date: z.string().date(),
      libelle: z.string().trim().min(2, "Libellé obligatoire.").max(200), reference: z.string().trim().max(60).optional(),
      categorie: z.string().optional(), compteId: z.string().regex(UUID).optional(),
      tva: z.number().int().min(0).max(MONTANT_MAX).default(0), factureId: z.string().regex(UUID).optional(),
    }).parse(req.body);
    const compte = await compteUtilisable(ctx, d.compteTresorerieId);
    const sens = d.sens === "entree" ? "in" : "out";
    let kind = sens === "in" ? "receipt" : "expense";
    let cp: Awaited<ReturnType<typeof contrepartie>>;
    if (d.factureId) {
      if (sens !== "in") throw new ErreurHttp(400, "sens", "Un règlement de facture est un encaissement.");
      await ctx.c.query("SELECT pg_advisory_xact_lock(hashtextextended('facture:' || $1, 0))", [d.factureId]);
      const f = await resteDu(ctx.c, d.factureId);
      if (d.montant > f.reste) throw new ErreurHttp(409, "trop_percu", `Il reste ${f.reste} FCFA à régler sur la facture ${f.numero} : montant trop élevé.`);
      cp = { id: await compteParNumero(ctx.c, COMPTE_CLIENTS), numero: COMPTE_CLIENTS, libelle: "Clients", categorie: "encaissement_client", tva: false };
      kind = "invoice_payment";
    } else cp = await contrepartie(ctx, sens, d.categorie, d.compteId);
    if (d.tva && (sens === "in" || !cp.tva)) throw new ErreurHttp(400, "tva", "La TVA récupérable ne s'applique qu'à une dépense soumise à TVA.");
    if (d.tva >= d.montant) throw new ErreurHttp(400, "tva", "La TVA doit être inférieure au montant TTC.");
    const m: NouveauMouvement = { compte, sens, kind, montant: d.montant, tva: d.tva, date: d.date, libelle: d.libelle, reference: d.reference ?? "",
      categorie: cp.categorie, contrepartieId: cp.id, tvaCompteId: d.tva ? await compteParNumero(ctx.c, COMPTE_TVA_RECUPERABLE) : null, factureId: d.factureId ?? null };
    const mvt = await insererMouvement(ctx, m);
    const ecriture = await ecritureMouvement(ctx, m, mvt);
    await ctx.journaliser({ type: "treasury", action: sens === "in" ? "receipt" : "expense", objetType: "treasury_movement", objetId: mvt.id,
      apres: { compte: compte.name, montant: d.montant, tva: d.tva, contrepartie: cp.numero, reference: mvt.reference }, details: { ecriture } });
    const { rows: [r] } = await ctx.c.query(`${SELECT_MOUVEMENTS} WHERE m.id = $1`, [mvt.id]);
    return vueMouvement(r);
  }));

  // Transfert entre deux comptes de trésorerie (ex. versement de la caisse à la banque).
  app.post("/api/tresorerie/transferts", proteger(deps, { permission: null }, async (req, ctx) => {
    const d = z.object({ de: z.string().regex(UUID), vers: z.string().regex(UUID), montant, date: z.string().date(),
      libelle: z.string().trim().min(2).max(200), reference: z.string().trim().max(60).optional() }).parse(req.body);
    if (d.de === d.vers) throw new ErreurHttp(400, "meme_compte", "Choisissez deux comptes différents.");
    const de = await compteUtilisable(ctx, d.de), vers = await compteUtilisable(ctx, d.vers);
    const groupe = crypto.randomUUID();
    const sortie: NouveauMouvement = { compte: de, sens: "out", kind: "transfer", montant: d.montant, tva: 0, date: d.date, libelle: d.libelle, reference: d.reference ?? "",
      categorie: "transfert", contrepartieId: vers.account_id, tvaCompteId: null, transfertGroupe: groupe };
    const m1 = await insererMouvement(ctx, sortie);
    const m2 = await insererMouvement(ctx, { ...sortie, compte: vers, sens: "in", reference: m1.reference, contrepartieId: de.account_id });
    // Une seule écriture pour les deux mouvements : débit du compte destinataire, crédit du compte d'origine.
    const ecriture = await genererEcriture(ctx.c, { journalId: de.journal_id, date: d.date, piece: m1.reference, libelle: d.libelle, auteur: ctx.utilisateur.id,
      source: { type: "treasury_movement", id: m1.id }, lignes: [{ compteId: vers.account_id, debit: d.montant, credit: 0 }, { compteId: de.account_id, debit: 0, credit: d.montant }] });
    await ctx.journaliser({ type: "treasury", action: "transfer", objetType: "treasury_movement", objetId: m1.id,
      apres: { de: de.name, vers: vers.name, montant: d.montant, reference: m1.reference }, details: { ecriture, mouvementEntree: m2.id } });
    return { sortie: m1.id, entree: m2.id, reference: m1.reference };
  }));

  // Annulation : mouvement inverse, motivé, et écriture inverse en brouillard. Le mouvement d'origine reste.
  app.post("/api/tresorerie/mouvements/:id/annulation", proteger(deps, { permission: "treasury.cancel", sensible: true }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw nonTrouve("Mouvement");
    const d = z.object({ motif, date: z.string().date().optional() }).parse(req.body);
    const { rows: [o] } = await ctx.c.query("SELECT * FROM treasury_movements WHERE id = $1", [id]);
    if (!o) throw nonTrouve("Mouvement");
    if (o.kind === "reversal") throw new ErreurHttp(409, "annulation_d_annulation", "Une annulation ne s'annule pas.");
    const jambes = o.transfer_group
      ? (await ctx.c.query("SELECT * FROM treasury_movements WHERE transfer_group = $1 ORDER BY direction DESC", [o.transfer_group])).rows
      : [o];
    const date = d.date ?? new Date().toISOString().slice(0, 10);
    const crees: string[] = [];
    // On annule d'abord la jambe « entrée » : sa contrepartie est une sortie, soumise au contrôle du solde de caisse.
    for (const j of jambes.sort((a, b) => (a.direction === "in" ? -1 : 1) - (b.direction === "in" ? -1 : 1))) {
      const { rows: [deja] } = await ctx.c.query("SELECT 1 FROM treasury_movements WHERE reversal_of = $1", [j.id]);
      if (deja) throw new ErreurHttp(409, "deja_annule", "Ce mouvement a déjà été annulé.");
      const compte = await compteUtilisable(ctx, j.treasury_account_id);
      const inv: NouveauMouvement = { compte, sens: j.direction === "in" ? "out" : "in", kind: "reversal", montant: versEntier(j.amount), tva: versEntier(j.tax_amount),
        date, libelle: `Annulation ${j.reference} : ${j.label}`.slice(0, 200), reference: `ANN-${j.reference}`.slice(0, 60), categorie: j.category,
        contrepartieId: j.counterpart_account_id, tvaCompteId: j.tax_account_id, factureId: j.invoice_id, transfertGroupe: null, annulationDe: j.id, raison: d.motif };
      const mvt = await insererMouvement(ctx, inv);
      crees.push(mvt.id);
      if (!o.transfer_group) {
        // Écriture inverse de l'écriture d'origine.
        const { rows: lignes } = await ctx.c.query(
          `SELECT l.account_id, l.debit, l.credit FROM entry_lines l JOIN journal_entries e ON e.id = l.entry_id
            WHERE e.source_type = 'treasury_movement' AND e.source_id = $1 ORDER BY l.line_no`, [j.id]);
        await genererEcriture(ctx.c, { journalId: compte.journal_id, date, piece: mvt.reference, libelle: inv.libelle, auteur: ctx.utilisateur.id,
          source: { type: "treasury_movement", id: mvt.id }, lignes: lignes.map((l) => ({ compteId: l.account_id, debit: versEntier(l.credit), credit: versEntier(l.debit) })) });
      } else if (j.direction === "out") {
        const destination = jambes.find((x) => x.direction === "in")!;
        const cd = await compteUtilisable(ctx, destination.treasury_account_id);
        await genererEcriture(ctx.c, { journalId: compte.journal_id, date, piece: mvt.reference, libelle: inv.libelle, auteur: ctx.utilisateur.id,
          source: { type: "treasury_movement", id: mvt.id }, lignes: [{ compteId: compte.account_id, debit: versEntier(j.amount), credit: 0 }, { compteId: cd.account_id, debit: 0, credit: versEntier(j.amount) }] });
      }
    }
    await ctx.journaliser({ type: "treasury", action: "movement_cancel", objetType: "treasury_movement", objetId: id, motif: d.motif, details: { annulations: crees } });
    return { annulations: crees };
  }));

  /* ------------------------------------------------------------ Tableau de trésorerie */
  app.get("/api/tresorerie/tableau", proteger(deps, { permission: null }, async (_req, ctx) => {
    exigerLecture(ctx);
    const cond = visibles(ctx) + (peutLireTout(ctx) ? " AND $1::uuid IS NOT NULL" : "");
    const { rows: [r] } = await ctx.c.query(
      `SELECT coalesce(sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END), 0) AS total,
              coalesce(sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END) FILTER (WHERE t.kind = 'cash'), 0) AS caisses,
              coalesce(sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END) FILTER (WHERE t.kind <> 'cash'), 0) AS banques,
              coalesce(sum(m.amount) FILTER (WHERE m.direction = 'in' AND m.movement_date = current_date), 0) AS entrees_jour,
              coalesce(sum(m.amount) FILTER (WHERE m.direction = 'out' AND m.movement_date = current_date), 0) AS sorties_jour
         FROM treasury_accounts t LEFT JOIN treasury_movements m ON m.treasury_account_id = t.id WHERE ${cond}`, [ctx.utilisateur.id]);
    const { rows: [b] } = ctx.a("accounting.read")
      ? await ctx.c.query("SELECT count(*)::int AS n FROM journal_entries WHERE status = 'draft' AND source_type IS NOT NULL")
      : { rows: [{ n: null }] };
    return { total: versEntier(r.total), caisses: versEntier(r.caisses), banques: versEntier(r.banques),
      entreesJour: versEntier(r.entrees_jour), sortiesJour: versEntier(r.sorties_jour), ecrituresAValider: b.n };
  }));
}
