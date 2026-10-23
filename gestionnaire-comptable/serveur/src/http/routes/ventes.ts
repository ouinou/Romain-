import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { compteParNumero, genererEcriture } from "../../domaine/comptabilite/generation.js";
import { MONTANT_MAX, versEntier } from "../../domaine/comptabilite/montants.js";
import { avecReglesBase } from "../../domaine/comptabilite/erreurs.js";
import { montantLigne, montantTva, quantiteEnMilliemes } from "../../domaine/ventes/calculs.js";
import { genererFacturePdf } from "../../domaine/ventes/pdf.js";
import { codeVerification, verifierSignature } from "../../domaine/ventes/signature.js";
import { profilDe } from "./entreprise.js";
import { COMPTE_CLIENTS, COMPTE_SERVICES_VENDUS, COMPTE_TVA_FACTUREE, COMPTE_VENTES_MARCHANDISES } from "../../domaine/tresorerie/categories.js";
import { compteUtilisable } from "./tresorerie.js";
import { pagination, proteger, type Ctx, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";

const TYPES: Record<string, string> = { goods: "Vente de marchandises", services: "Prestation de services", mixed: "Vente et prestation" };

/** Paramètres fiscaux de l'entreprise (aucun taux codé en dur : à saisir d'après la loi de finances en vigueur). */
async function parametresFiscaux(c: Client, entrepriseId: string) {
  const { rows: [e] } = await c.query("SELECT settings, currency_code FROM companies WHERE id = $1", [entrepriseId]);
  const f = e.settings?.fiscal ?? {};
  return { tvaApplicable: !!f.tvaApplicable, tauxTvaPdm: f.tvaApplicable ? Number(f.tauxTvaPdm ?? 0) : 0, mentionsFacture: (f.mentionsFacture as string) ?? "", devise: e.currency_code as string };
}

async function chargerFacture(c: Client, id: string) {
  const { rows: [f] } = await c.query(
    `SELECT i.*, i.invoice_date::text AS date, u.full_name AS auteur, t.name AS tresorerie,
            coalesce((SELECT sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END) FROM treasury_movements m WHERE m.invoice_id = i.id), 0) AS paye,
            (SELECT json_build_object('id', e.id, 'statut', e.status, 'numero', e.entry_number) FROM journal_entries e WHERE e.source_type = 'invoice' AND e.source_id = i.id) AS ecriture
       FROM invoices i JOIN app_users u ON u.id = i.created_by LEFT JOIN treasury_accounts t ON t.id = i.treasury_account_id WHERE i.id = $1`, [id]);
  if (!f) return null;
  const { rows: lignes } = await c.query(
    "SELECT l.line_no, l.description, l.quantity::text AS quantite, l.unit_price, l.amount, a.account_number FROM invoice_lines l JOIN accounts a ON a.id = l.revenue_account_id WHERE l.invoice_id = $1 ORDER BY l.line_no", [id]);
  const { rows: reglements } = await c.query(
    "SELECT m.id, m.movement_date::text AS date, m.direction, m.amount, m.reference, m.kind, t.name AS compte FROM treasury_movements m JOIN treasury_accounts t ON t.id = m.treasury_account_id WHERE m.invoice_id = $1 ORDER BY m.created_at", [id]);
  const ttc = versEntier(f.total_ttc), paye = versEntier(f.paye);
  return {
    id: f.id, numero: f.number, date: f.date, type: f.kind, typeLibelle: TYPES[f.kind],
    client: { id: f.customer_id, nom: f.customer_name, niu: f.customer_niu, adresse: f.customer_address, telephone: f.customer_phone },
    vendeur: { ...f.seller, logoUrl: f.seller?.logoId ? `/api/entreprise/logos/${f.seller.logoId}` : null }, devise: f.currency, tauxTvaPdm: f.tax_rate_bp,
    lignes: lignes.map((l) => ({ ordre: l.line_no, designation: l.description, quantite: Number(l.quantite), prixUnitaire: versEntier(l.unit_price), montant: versEntier(l.amount), nature: l.account_number === COMPTE_SERVICES_VENDUS ? "service" : "marchandise" })),
    totalHt: versEntier(f.total_ht), totalTva: versEntier(f.total_tax), totalTtc: ttc, paye, reste: ttc - paye,
    statutPaiement: paye >= ttc ? "payee" : paye > 0 ? "partielle" : "impayee",
    paiement: f.payment_mode === "immediate" ? "comptant" : "credit", tresorerie: f.tresorerie, note: f.notes,
    reglements: reglements.map((r) => ({ id: r.id, date: r.date, montant: (r.direction === "in" ? 1 : -1) * versEntier(r.amount), reference: r.reference, compte: r.compte, nature: r.kind })),
    ecriture: f.ecriture ? { id: f.ecriture.id, statut: f.ecriture.statut === "validated" ? "validee" : "brouillard", numero: f.ecriture.numero } : null,
    auteur: f.auteur, creeLe: f.created_at,
  };
}

/** Ajoute le code de vérification signé (contenu du QR imprimé sur la facture). */
async function avecCode<T extends { numero: string; date: string; totalTtc: number; devise: string }>(ctx: Ctx, deps: Dependances, f: T) {
  const { rows: [e] } = await ctx.c.query("SELECT company_code FROM companies WHERE id = $1", [ctx.entrepriseId]);
  return { ...f, codeVerification: await codeVerification(ctx.c, deps.cfg.cleChiffrement,
    { codeEntreprise: e.company_code, numero: f.numero, date: f.date, totalTtc: f.totalTtc, devise: f.devise }) };
}

const quantiteTexte = (q: number) => q.toLocaleString("fr-FR", { maximumFractionDigits: 3 }).replace(/[  ]/g, " ");

export function routesVentes(app: FastifyInstance, deps: Dependances) {
  /* ------------------------------------------------------------ Paramètres fiscaux */
  app.get("/api/ventes/parametres", proteger(deps, { permission: "sales.read" }, async (_req, ctx) => parametresFiscaux(ctx.c, ctx.entrepriseId)));

  app.patch("/api/ventes/parametres", proteger(deps, { permission: "accounting.admin", sensible: true }, async (req, ctx) => {
    const d = z.object({
      tvaApplicable: z.boolean(),
      tauxTvaPdm: z.number().int().min(0).max(10000).default(0),
      mentionsFacture: z.string().trim().max(500).default(""),
    }).parse(req.body);
    if (d.tvaApplicable && d.tauxTvaPdm === 0) throw new ErreurHttp(400, "taux_tva", "Indiquez le taux de TVA applicable.");
    const avant = await parametresFiscaux(ctx.c, ctx.entrepriseId);
    await ctx.c.query("UPDATE companies SET settings = jsonb_set(settings, '{fiscal}', $2::jsonb) WHERE id = $1", [ctx.entrepriseId, JSON.stringify(d)]);
    await ctx.journaliser({ type: "security", action: "fiscal_settings_change", objetType: "company", objetId: ctx.entrepriseId, avant, apres: d });
    return parametresFiscaux(ctx.c, ctx.entrepriseId);
  }));

  /* ------------------------------------------------------------ Clients */
  app.get("/api/ventes/clients", proteger(deps, { permission: "sales.read" }, async (req, ctx) => {
    const q = (req.query as { recherche?: string }).recherche?.trim();
    const { rows } = await ctx.c.query(
      `SELECT c.id, c.name, c.niu, c.phone, c.email, c.address,
              (SELECT count(*)::int FROM invoices i WHERE i.customer_id = c.id) AS factures
         FROM customers c WHERE c.active ${q ? "AND (c.name ILIKE $1 OR c.phone ILIKE $1 OR c.niu ILIKE $1)" : ""} ORDER BY c.name LIMIT 200`, q ? [`%${q}%`] : []);
    return rows.map((c) => ({ id: c.id, nom: c.name, niu: c.niu, telephone: c.phone, email: c.email, adresse: c.address, factures: c.factures }));
  }));

  app.post("/api/ventes/clients", proteger(deps, { permission: "sales.create" }, async (req, ctx) => {
    const d = z.object({ nom: z.string().trim().min(2).max(200), niu: z.string().trim().max(30).optional(), telephone: z.string().trim().max(40).optional(),
      email: z.string().trim().email().max(254).optional().or(z.literal("")), adresse: z.string().trim().max(300).optional() }).parse(req.body);
    const { rows: [c] } = await ctx.c.query("INSERT INTO customers (name, niu, phone, email, address) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [d.nom, d.niu || null, d.telephone || null, d.email || null, d.adresse || null]);
    await ctx.journaliser({ type: "sales", action: "customer_create", objetType: "customer", objetId: c.id, apres: { nom: d.nom } });
    return { id: c.id, nom: d.nom };
  }));

  /* ------------------------------------------------------------ Factures */
  app.get("/api/ventes/factures", proteger(deps, { permission: "sales.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { page, taille, offset } = pagination(q);
    const f: string[] = ["TRUE"], v: unknown[] = [];
    const aj = (sql: string, val: unknown) => { v.push(val); f.push(sql.replaceAll("?", `$${v.length}`)); };
    if (q.recherche) aj("(i.number ILIKE ? OR i.customer_name ILIKE ?)", `%${q.recherche.trim()}%`);
    if (q.du && /^\d{4}-\d{2}-\d{2}$/.test(q.du)) aj("i.invoice_date >= ?::date", q.du);
    if (q.au && /^\d{4}-\d{2}-\d{2}$/.test(q.au)) aj("i.invoice_date <= ?::date", q.au);
    const paye = "coalesce((SELECT sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END) FROM treasury_movements m WHERE m.invoice_id = i.id), 0)";
    if (q.statut === "payee") f.push(`${paye} >= i.total_ttc`);
    if (q.statut === "impayee") f.push(`${paye} < i.total_ttc`);
    const where = "WHERE " + f.join(" AND ");
    const { rows: [t] } = await ctx.c.query(`SELECT count(*)::int AS total, coalesce(sum(i.total_ttc), 0) AS ttc, coalesce(sum(i.total_ttc - ${paye}), 0) AS reste FROM invoices i ${where}`, v);
    const { rows } = await ctx.c.query(
      `SELECT i.id, i.number, i.invoice_date::text AS date, i.kind, i.customer_name, i.total_ht, i.total_tax, i.total_ttc, i.payment_mode, i.created_at, ${paye} AS paye, u.full_name AS auteur
         FROM invoices i JOIN app_users u ON u.id = i.created_by ${where} ORDER BY i.invoice_year DESC, i.sequence_no DESC LIMIT ${taille} OFFSET ${offset}`, v);
    return {
      elements: rows.map((r) => {
        const ttc = versEntier(r.total_ttc), p = versEntier(r.paye);
        return { id: r.id, numero: r.number, date: r.date, type: r.kind, client: r.customer_name, totalHt: versEntier(r.total_ht), totalTva: versEntier(r.total_tax),
          totalTtc: ttc, paye: p, reste: ttc - p, statutPaiement: p >= ttc ? "payee" : p > 0 ? "partielle" : "impayee", paiement: r.payment_mode === "immediate" ? "comptant" : "credit", auteur: r.auteur, creeLe: r.created_at };
      }),
      total: t.total, totalTtc: versEntier(t.ttc), totalReste: versEntier(t.reste), page, taille,
    };
  }));

  app.get("/api/ventes/factures/:id", proteger(deps, { permission: "sales.read" }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw nonTrouve("Facture");
    const f = await chargerFacture(ctx.c, id);
    if (!f) throw nonTrouve("Facture");
    return avecCode(ctx, deps, f);
  }));

  // Vérification d'une facture à partir du contenu de son code QR (scanné ou saisi).
  // Authentique = signature valide ET facture présente dans la base avec la même date et le même montant.
  app.post("/api/ventes/verification", proteger(deps, { permission: "sales.read" }, async (req, ctx) => {
    const d = z.object({ contenu: z.string().trim().min(1, "Scannez ou collez le code de la facture.").max(400) }).parse(req.body);
    const { rows: [e] } = await ctx.c.query("SELECT company_code FROM companies WHERE id = $1", [ctx.entrepriseId]);
    const s = await verifierSignature(ctx.c, deps.cfg.cleChiffrement, e.company_code, d.contenu);
    let reponse: Record<string, unknown>;
    if (!s.authentique) reponse = { authentique: false, raison: s.raison };
    else {
      const { rows: [i] } = await ctx.c.query("SELECT id, invoice_date::text AS date, total_ttc, currency FROM invoices WHERE number = $1", [s.numero]);
      if (!i) reponse = { authentique: false, raison: `Signature valide, mais la facture ${s.numero} est absente de la base : vérifiez que vous êtes dans la bonne entreprise et que la base n'a pas été restaurée à une date antérieure.` };
      else if (i.date !== s.donnees!.date || versEntier(i.total_ttc) !== s.donnees!.totalTtc || i.currency !== s.donnees!.devise)
        reponse = { authentique: false, raison: `La facture ${s.numero} existe, mais sa date ou son montant ne correspondent pas au code.` };
      else {
        const f = (await chargerFacture(ctx.c, i.id))!;
        reponse = { authentique: true, facture: { id: f.id, numero: f.numero, date: f.date, client: f.client.nom, totalTtc: f.totalTtc, devise: f.devise, statutPaiement: f.statutPaiement, auteur: f.auteur, creeLe: f.creeLe } };
      }
    }
    await ctx.journaliser({ type: "sales", action: "invoice_verify", resultat: reponse.authentique ? "success" : "failure",
      details: { numero: s.authentique ? s.numero : null, raison: reponse.authentique ? null : reponse.raison } });
    return reponse;
  }));

  // Émission d'une facture (vente ou prestation), avec encaissement immédiat facultatif.
  app.post("/api/ventes/factures", proteger(deps, { permission: "sales.create" }, async (req, ctx) => {
    const d = z.object({
      date: z.string().date(),
      client: z.object({
        id: z.string().regex(UUID).optional(), nom: z.string().trim().max(200).optional(), niu: z.string().trim().max(30).optional(),
        telephone: z.string().trim().max(40).optional(), adresse: z.string().trim().max(300).optional(), enregistrer: z.boolean().default(false),
      }).default({}),
      lignes: z.array(z.object({
        designation: z.string().trim().min(1, "Désignation obligatoire.").max(200),
        quantite: z.number().positive("Quantité positive attendue.").max(1e9),
        prixUnitaire: z.number().int("Prix unitaire entier (FCFA).").min(0).max(MONTANT_MAX),
        nature: z.enum(["marchandise", "service"]),
      })).min(1, "Ajoutez au moins une ligne.").max(100),
      paiement: z.discriminatedUnion("mode", [z.object({ mode: z.literal("comptant"), compteTresorerieId: z.string().regex(UUID) }), z.object({ mode: z.literal("credit") })]),
      note: z.string().trim().max(500).optional(),
    }).parse(req.body);

    // Montants exacts.
    const lignes = d.lignes.map((l) => {
      let qm: bigint;
      try { qm = quantiteEnMilliemes(l.quantite); } catch { throw new ErreurHttp(400, "quantite", `Quantité invalide pour « ${l.designation} » (3 décimales au plus).`); }
      return { ...l, montant: montantLigne(qm, l.prixUnitaire) };
    });
    const totalHt = lignes.reduce((s, l) => s + l.montant, 0);
    const fiscal = await parametresFiscaux(ctx.c, ctx.entrepriseId);
    const totalTva = montantTva(totalHt, fiscal.tauxTvaPdm), totalTtc = totalHt + totalTva;
    if (totalTtc <= 0) throw new ErreurHttp(400, "montant_nul", "Le montant de la facture doit être positif.");
    if (totalTtc > MONTANT_MAX) throw new ErreurHttp(400, "montant", "Montant trop élevé.");
    const tresorerie = d.paiement.mode === "comptant" ? await compteUtilisable(ctx, d.paiement.compteTresorerieId) : null;

    // Client : fiche existante, nouvelle fiche, ou simple nom (client de passage).
    let client = { id: null as string | null, nom: d.client.nom || "Client comptant", niu: d.client.niu || null, adresse: d.client.adresse || null, telephone: d.client.telephone || null };
    if (d.client.id) {
      const { rows: [c] } = await ctx.c.query("SELECT id, name, niu, address, phone FROM customers WHERE id = $1", [d.client.id]);
      if (!c) throw new ErreurHttp(400, "client_inconnu", "Client introuvable.");
      client = { id: c.id, nom: c.name, niu: c.niu, adresse: c.address, telephone: c.phone };
    } else if (d.client.enregistrer && d.client.nom) {
      const { rows: [c] } = await ctx.c.query("INSERT INTO customers (name, niu, phone, address) VALUES ($1,$2,$3,$4) RETURNING id", [client.nom, client.niu, client.telephone, client.adresse]);
      client.id = c.id;
    }
    const { rows: [e] } = await ctx.c.query("SELECT legal_name, niu, rccm, address, phone, settings FROM companies WHERE id = $1", [ctx.entrepriseId]);
    // Identité du vendeur figée à l'émission : une réimpression garde l'en-tête, le logo et les couleurs du jour de la facture.
    const p = profilDe(e.settings);
    const vendeur = { raisonSociale: e.legal_name, niu: e.niu, rccm: e.rccm, adresse: e.address, telephone: e.phone,
      email: p.email, regimeFiscal: p.regimeFiscal, patente: p.patente, logoId: p.logoId, couleurs: p.couleurs };   // logoUrl est recalculé à la lecture
    const comptes = {
      marchandise: await compteParNumero(ctx.c, COMPTE_VENTES_MARCHANDISES), service: await compteParNumero(ctx.c, COMPTE_SERVICES_VENDUS),
      clients: await compteParNumero(ctx.c, COMPTE_CLIENTS), tva: totalTva ? await compteParNumero(ctx.c, COMPTE_TVA_FACTUREE) : null,
    };
    const natures = new Set(lignes.map((l) => l.nature));
    const kind = natures.size > 1 ? "mixed" : natures.has("service") ? "services" : "goods";

    const { rows: [inv] } = await avecReglesBase(() => ctx.c.query(
      `INSERT INTO invoices (invoice_date, kind, customer_id, customer_name, customer_niu, customer_address, customer_phone, seller, currency,
                             tax_rate_bp, total_ht, total_tax, total_ttc, payment_mode, treasury_account_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id, number`,
      [d.date, kind, client.id, client.nom, client.niu, client.adresse, client.telephone, JSON.stringify(vendeur), fiscal.devise,
       fiscal.tauxTvaPdm, totalHt, totalTva, totalTtc, tresorerie ? "immediate" : "credit", tresorerie?.id ?? null, d.note || null, ctx.utilisateur.id]));
    for (const [i, l] of lignes.entries())
      await ctx.c.query("INSERT INTO invoice_lines (invoice_id, line_no, description, quantity, unit_price, amount, revenue_account_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [inv.id, i + 1, l.designation, l.quantite, l.prixUnitaire, l.montant, comptes[l.nature]]);

    // Écriture de vente (brouillard) : 411 au débit, ventes et TVA facturée au crédit.
    const parCompte = new Map<string, number>();
    for (const l of lignes) parCompte.set(comptes[l.nature], (parCompte.get(comptes[l.nature]) ?? 0) + l.montant);
    const { rows: [jv] } = await ctx.c.query("SELECT id FROM journals WHERE code = 'VT'");
    if (!jv) throw new ErreurHttp(409, "journal_manquant", "Le journal des ventes (VT) est introuvable.");
    const libelle = `Facture ${inv.number} : ${client.nom}`;
    const ecritureVente = await genererEcriture(ctx.c, { journalId: jv.id, date: d.date, piece: inv.number, libelle, auteur: ctx.utilisateur.id,
      source: { type: "invoice", id: inv.id },
      lignes: [{ compteId: comptes.clients, debit: totalTtc, credit: 0 }, ...[...parCompte].map(([compteId, m]) => ({ compteId, debit: 0, credit: m })),
               ...(totalTva ? [{ compteId: comptes.tva!, debit: 0, credit: totalTva }] : [])] });

    // Encaissement immédiat : mouvement de trésorerie et écriture de règlement (brouillard).
    let mouvement: string | null = null;
    if (tresorerie) {
      const { rows: [m] } = await avecReglesBase(() => ctx.c.query(
        `INSERT INTO treasury_movements (treasury_account_id, direction, kind, amount, movement_date, reference, label, category, counterpart_account_id, invoice_id, created_by)
         VALUES ($1,'in','invoice_payment',$2,$3,$4,$5,'encaissement_client',$6,$7,$8) RETURNING id, reference`,
        [tresorerie.id, totalTtc, d.date, inv.number, `Règlement ${libelle}`.slice(0, 200), comptes.clients, inv.id, ctx.utilisateur.id]));
      mouvement = m.id;
      await genererEcriture(ctx.c, { journalId: tresorerie.journal_id, date: d.date, piece: inv.number, libelle: `Règlement ${libelle}`, auteur: ctx.utilisateur.id,
        source: { type: "treasury_movement", id: m.id }, lignes: [{ compteId: tresorerie.account_id, debit: totalTtc, credit: 0 }, { compteId: comptes.clients, debit: 0, credit: totalTtc }] });
    }
    await ctx.journaliser({ type: "sales", action: "invoice_issue", objetType: "invoice", objetId: inv.id,
      apres: { numero: inv.number, client: client.nom, totalHt, totalTva, totalTtc, paiement: d.paiement.mode, caisse: tresorerie?.name ?? null },
      details: { ecritureVente, mouvement } });
    return avecCode(ctx, deps, (await chargerFacture(ctx.c, inv.id))!);
  }));

  // PDF de la facture : même contenu à chaque génération (données figées). Chaque génération est tracée.
  app.get("/api/ventes/factures/:id/pdf", proteger(deps, { permission: "sales.read" }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw nonTrouve("Facture");
    const f = await chargerFacture(ctx.c, id);
    if (!f) throw nonTrouve("Facture");
    const fiscal = await parametresFiscaux(ctx.c, ctx.entrepriseId);
    const { codeVerification: code } = await avecCode(ctx, deps, f);
    const logo = f.vendeur.logoId ? (await ctx.c.query("SELECT data FROM company_logos WHERE id = $1", [f.vendeur.logoId])).rows[0]?.data as Buffer | undefined : undefined;
    const pdf = await genererFacturePdf({ codeVerification: code, logo,
      numero: f.numero, date: f.date, type: f.typeLibelle, vendeur: f.vendeur, client: f.client,
      lignes: f.lignes.map((l) => ({ designation: l.designation, quantite: quantiteTexte(l.quantite), prixUnitaire: l.prixUnitaire, montant: l.montant })),
      totalHt: f.totalHt, tauxTvaPdm: f.tauxTvaPdm, totalTva: f.totalTva, totalTtc: f.totalTtc, devise: f.devise === "XAF" ? "FCFA" : f.devise,
      paiement: f.paiement === "comptant" ? `comptant${f.tresorerie ? ` (${f.tresorerie})` : ""}` : f.reste <= 0 ? "réglée" : "à crédit", paye: f.paye,
      note: f.note, mentions: fiscal.mentionsFacture || null,
    });
    await ctx.journaliser({ type: "sales", action: "invoice_pdf", objetType: "invoice", objetId: id, details: { numero: f.numero } });
    ctx.rep.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${f.numero}.pdf"`);
    return pdf;
  }));
}
