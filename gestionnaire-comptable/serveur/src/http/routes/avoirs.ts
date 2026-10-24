import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UUID, type Client } from "../../db.js";
import { compteParNumero, genererEcriture } from "../../domaine/comptabilite/generation.js";
import { versEntier } from "../../domaine/comptabilite/montants.js";
import { avecReglesBase } from "../../domaine/comptabilite/erreurs.js";
import { montantLigne, montantTva, quantiteEnMilliemes } from "../../domaine/ventes/calculs.js";
import { genererFacturePdf } from "../../domaine/ventes/pdf.js";
import { COMPTE_CLIENTS, COMPTE_TVA_FACTUREE } from "../../domaine/tresorerie/categories.js";
import { profilDe } from "./entreprise.js";
import { compteUtilisable, resteDu } from "./tresorerie.js";
import { avecCode, chargerFacture, quantiteTexte } from "./ventes.js";
import { pagination, proteger, type Dependances } from "../contexte.js";
import { ErreurHttp, nonTrouve } from "../erreurs.js";

/**
 * Avoirs : annulation totale ou partielle d'une facture émise, qui reste intacte.
 *  - l'avoir reprend des lignes de la facture (même prix, même taux de TVA) pour une quantité au plus égale
 *    à ce qui reste à créditer ; la base refuse tout dépassement (migration 007) ;
 *  - écriture de vente inverse en brouillard (journal VT) : ventes et TVA facturée au débit, 411 au crédit ;
 *  - remboursement facultatif, limité au trop-perçu (ce que le client a payé au-delà du nouveau net dû) :
 *    mouvement de sortie de trésorerie et écriture 411 / trésorerie en brouillard.
 * Permission « sales.cancel », opération sensible (confirmation récente du mot de passe).
 */
async function chargerAvoir(c: Client, id: string) {
  const { rows: [a] } = await c.query(
    `SELECT a.*, a.credit_date::text AS date, i.number AS facture_numero, i.invoice_date::text AS facture_date, i.kind,
            i.customer_id, i.customer_name, i.customer_niu, i.customer_address, i.customer_phone, u.full_name AS auteur,
            (SELECT json_build_object('id', e.id, 'statut', e.status, 'numero', e.entry_number) FROM journal_entries e WHERE e.source_type = 'credit_note' AND e.source_id = a.id) AS ecriture
       FROM credit_notes a JOIN invoices i ON i.id = a.invoice_id JOIN app_users u ON u.id = a.created_by WHERE a.id = $1`, [id]);
  if (!a) return null;
  const { rows: lignes } = await c.query(
    `SELECT cl.line_no, cl.invoice_line_no, cl.quantity::text AS quantite, cl.amount, il.description, il.unit_price
       FROM credit_note_lines cl JOIN invoice_lines il ON il.invoice_id = cl.invoice_id AND il.line_no = cl.invoice_line_no
      WHERE cl.credit_note_id = $1 ORDER BY cl.line_no`, [id]);
  const { rows: [r] } = await c.query(
    "SELECT m.id, m.amount, m.reference, t.name AS compte FROM treasury_movements m JOIN treasury_accounts t ON t.id = m.treasury_account_id WHERE m.credit_note_id = $1", [id]);
  return {
    id: a.id, numero: a.number, date: a.date, motif: a.reason,
    facture: { id: a.invoice_id, numero: a.facture_numero, date: a.facture_date },
    client: { id: a.customer_id, nom: a.customer_name, niu: a.customer_niu, adresse: a.customer_address, telephone: a.customer_phone },
    vendeur: { ...a.seller, logoUrl: a.seller?.logoId ? `/api/entreprise/logos/${a.seller.logoId}` : null }, devise: a.currency, tauxTvaPdm: a.tax_rate_bp,
    lignes: lignes.map((l) => ({ ordre: l.line_no, ligneFacture: l.invoice_line_no, designation: l.description, quantite: Number(l.quantite), prixUnitaire: versEntier(l.unit_price), montant: versEntier(l.amount) })),
    totalHt: versEntier(a.total_ht), totalTva: versEntier(a.total_tax), totalTtc: versEntier(a.total_ttc),
    remboursement: r ? { mouvementId: r.id, montant: versEntier(r.amount), reference: r.reference, compte: r.compte } : null,
    ecriture: a.ecriture ? { id: a.ecriture.id, statut: a.ecriture.statut === "validated" ? "validee" : "brouillard", numero: a.ecriture.numero } : null,
    auteur: a.auteur, creeLe: a.created_at,
  };
}

export function routesAvoirs(app: FastifyInstance, deps: Dependances) {
  app.get("/api/ventes/avoirs", proteger(deps, { permission: "sales.read" }, async (req, ctx) => {
    const q = req.query as Record<string, string | undefined>;
    const { page, taille, offset } = pagination(q);
    const f: string[] = ["TRUE"], v: unknown[] = [];
    const aj = (sql: string, val: unknown) => { v.push(val); f.push(sql.replaceAll("?", `$${v.length}`)); };
    if (q.recherche) aj("(a.number ILIKE ? OR i.number ILIKE ? OR i.customer_name ILIKE ?)", `%${q.recherche.trim()}%`);
    if (q.du && /^\d{4}-\d{2}-\d{2}$/.test(q.du)) aj("a.credit_date >= ?::date", q.du);
    if (q.au && /^\d{4}-\d{2}-\d{2}$/.test(q.au)) aj("a.credit_date <= ?::date", q.au);
    const where = "WHERE " + f.join(" AND ");
    const { rows: [t] } = await ctx.c.query(`SELECT count(*)::int AS total, coalesce(sum(a.total_ttc), 0) AS ttc FROM credit_notes a JOIN invoices i ON i.id = a.invoice_id ${where}`, v);
    const { rows } = await ctx.c.query(
      `SELECT a.id, a.number, a.credit_date::text AS date, a.reason, a.total_ht, a.total_tax, a.total_ttc, a.created_at, i.id AS facture_id, i.number AS facture, i.customer_name, u.full_name AS auteur,
              (SELECT m.amount FROM treasury_movements m WHERE m.credit_note_id = a.id) AS rembourse
         FROM credit_notes a JOIN invoices i ON i.id = a.invoice_id JOIN app_users u ON u.id = a.created_by
         ${where} ORDER BY a.credit_year DESC, a.sequence_no DESC LIMIT ${taille} OFFSET ${offset}`, v);
    return {
      elements: rows.map((r) => ({ id: r.id, numero: r.number, date: r.date, motif: r.reason, facture: { id: r.facture_id, numero: r.facture }, client: r.customer_name,
        totalHt: versEntier(r.total_ht), totalTva: versEntier(r.total_tax), totalTtc: versEntier(r.total_ttc), rembourse: versEntier(r.rembourse ?? 0), auteur: r.auteur, creeLe: r.created_at })),
      total: t.total, totalTtc: versEntier(t.ttc), page, taille,
    };
  }));

  app.get("/api/ventes/avoirs/:id", proteger(deps, { permission: "sales.read" }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw nonTrouve("Avoir");
    const a = await chargerAvoir(ctx.c, id);
    if (!a) throw nonTrouve("Avoir");
    return avecCode(ctx, deps, a);
  }));

  app.post("/api/ventes/factures/:id/avoirs", proteger(deps, { permission: "sales.cancel", sensible: true }, async (req, ctx) => {
    const factureId = (req.params as { id: string }).id;
    if (!UUID.test(factureId)) throw nonTrouve("Facture");
    const d = z.object({
      date: z.string().date(),
      motif: z.string().trim().min(3, "Indiquez le motif de l'avoir (retour de marchandise, erreur de prix…).").max(300),
      lignes: z.array(z.object({ ordre: z.number().int().positive(), quantite: z.number().positive("Quantité positive attendue.") }))
        .min(1, "Choisissez au moins une ligne à créditer.").max(100),
      rembourser: z.object({ compteTresorerieId: z.string().regex(UUID) }).optional(),
    }).parse(req.body);
    if (new Set(d.lignes.map((l) => l.ordre)).size !== d.lignes.length) throw new ErreurHttp(400, "ligne_double", "Chaque ligne de la facture ne figure qu'une fois dans l'avoir.");

    // Un seul avoir ou règlement à la fois sur une facture (même verrou que les encaissements).
    await ctx.c.query("SELECT pg_advisory_xact_lock(hashtextextended('facture:' || $1, 0))", [factureId]);
    const f = await chargerFacture(ctx.c, factureId);
    if (!f) throw nonTrouve("Facture");
    if (d.date < f.date) throw new ErreurHttp(400, "date", `L'avoir ne peut pas être daté avant la facture (${f.date.split("-").reverse().join("/")}).`);

    // Lignes : quantité restante à créditer ; la ligne qui solde reprend exactement le montant restant.
    const lignes = d.lignes.map((l) => {
      const il = f.lignes.find((x) => x.ordre === l.ordre);
      if (!il) throw new ErreurHttp(400, "ligne_inconnue", `La facture ${f.numero} n'a pas de ligne ${l.ordre}.`);
      let qm: bigint, restant: bigint;
      try { qm = quantiteEnMilliemes(l.quantite); restant = quantiteEnMilliemes(il.quantite) - (il.quantiteCreditee ? quantiteEnMilliemes(il.quantiteCreditee) : 0n); }
      catch { throw new ErreurHttp(400, "quantite", `Quantité invalide pour « ${il.designation} » (3 décimales au plus).`); }
      if (qm > restant) throw new ErreurHttp(409, "trop_credite",
        `« ${il.designation} » : ${quantiteTexte(Number(restant) / 1000)} au plus peut encore être crédité (${quantiteTexte(il.quantite)} facturé, ${quantiteTexte(il.quantiteCreditee)} déjà crédité).`);
      const solde = qm === restant;
      return { ordre: il.ordre, designation: il.designation, quantite: l.quantite, prixUnitaire: il.prixUnitaire, montant: solde ? il.montant - il.montantCredite : montantLigne(qm, il.prixUnitaire), solde };
    });
    const totalHt = lignes.reduce((s, l) => s + l.montant, 0);
    // L'avoir qui solde toute la facture reprend la TVA restante ; sinon TVA = HT × taux.
    const creditees = new Map(lignes.filter((l) => l.solde).map((l) => [l.ordre, true]));
    const toutSolde = f.lignes.every((il) => creditees.has(il.ordre) || il.quantiteCreditee === il.quantite);
    const tvaDejaCreditee = f.avoirs.length
      ? versEntier((await ctx.c.query("SELECT coalesce(sum(total_tax), 0) AS t FROM credit_notes WHERE invoice_id = $1", [f.id])).rows[0].t) : 0;
    const totalTva = toutSolde ? f.totalTva - tvaDejaCreditee : montantTva(totalHt, f.tauxTvaPdm);
    const totalTtc = totalHt + totalTva;
    if (totalTtc <= 0) throw new ErreurHttp(400, "montant_nul", "Le montant de l'avoir doit être positif.");

    // Remboursement : seulement le trop-perçu après cet avoir.
    const etat = await resteDu(ctx.c, f.id);
    const tropPercu = Math.min(totalTtc, etat.paye - (etat.ttc - etat.avoirs - totalTtc));
    const tresorerie = d.rembourser ? await compteUtilisable(ctx, d.rembourser.compteTresorerieId) : null;
    if (tresorerie && tropPercu <= 0)
      throw new ErreurHttp(409, "rien_a_rembourser", `Le client n'a rien payé au-delà de ce qu'il doit encore sur la facture ${f.numero} : l'avoir réduit simplement sa dette.`);

    const { rows: [e] } = await ctx.c.query("SELECT legal_name, niu, rccm, address, phone, settings FROM companies WHERE id = $1", [ctx.entrepriseId]);
    const p = profilDe(e.settings);
    const vendeur = { raisonSociale: e.legal_name, niu: e.niu, rccm: e.rccm, adresse: e.address, telephone: e.phone,
      email: p.email, regimeFiscal: p.regimeFiscal, patente: p.patente, logoId: p.logoId, couleurs: p.couleurs };

    const { rows: [av] } = await avecReglesBase(() => ctx.c.query(
      `INSERT INTO credit_notes (invoice_id, credit_date, reason, seller, currency, tax_rate_bp, total_ht, total_tax, total_ttc, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, number`,
      [f.id, d.date, d.motif, JSON.stringify(vendeur), f.devise, f.tauxTvaPdm, totalHt, totalTva, totalTtc, ctx.utilisateur.id]));
    for (const [i, l] of lignes.entries())
      await ctx.c.query("INSERT INTO credit_note_lines (credit_note_id, line_no, invoice_id, invoice_line_no, quantity, amount) VALUES ($1,$2,$3,$4,$5,$6)",
        [av.id, i + 1, f.id, l.ordre, l.quantite, l.montant]);

    // Écriture inverse de la vente, au prorata des lignes créditées.
    const { rows: comptesLignes } = await ctx.c.query("SELECT line_no, revenue_account_id FROM invoice_lines WHERE invoice_id = $1", [f.id]);
    const compteDe = new Map(comptesLignes.map((r) => [r.line_no as number, r.revenue_account_id as string]));
    const parCompte = new Map<string, number>();
    for (const l of lignes) parCompte.set(compteDe.get(l.ordre)!, (parCompte.get(compteDe.get(l.ordre)!) ?? 0) + l.montant);
    const clients = await compteParNumero(ctx.c, COMPTE_CLIENTS);
    const { rows: [jv] } = await ctx.c.query("SELECT id FROM journals WHERE code = 'VT'");
    if (!jv) throw new ErreurHttp(409, "journal_manquant", "Le journal des ventes (VT) est introuvable.");
    const libelle = `Avoir ${av.number} sur ${f.numero} : ${f.client.nom}`;
    const ecriture = await genererEcriture(ctx.c, { journalId: jv.id, date: d.date, piece: av.number, libelle, auteur: ctx.utilisateur.id,
      source: { type: "credit_note", id: av.id },
      lignes: [...[...parCompte].map(([compteId, m]) => ({ compteId, debit: m, credit: 0 })),
               ...(totalTva ? [{ compteId: await compteParNumero(ctx.c, COMPTE_TVA_FACTUREE), debit: totalTva, credit: 0 }] : []),
               { compteId: clients, debit: 0, credit: totalTtc }] });

    let mouvement: string | null = null;
    if (tresorerie) {
      const { rows: [m] } = await avecReglesBase(() => ctx.c.query(
        `INSERT INTO treasury_movements (treasury_account_id, direction, kind, amount, movement_date, reference, label, category, counterpart_account_id, invoice_id, credit_note_id, created_by)
         VALUES ($1,'out','credit_refund',$2,$3,$4,$5,'remboursement_client',$6,$7,$8,$9) RETURNING id`,
        [tresorerie.id, tropPercu, d.date, av.number, `Remboursement ${libelle}`.slice(0, 200), clients, f.id, av.id, ctx.utilisateur.id]));
      mouvement = m.id;
      await genererEcriture(ctx.c, { journalId: tresorerie.journal_id, date: d.date, piece: av.number, libelle: `Remboursement ${libelle}`, auteur: ctx.utilisateur.id,
        source: { type: "treasury_movement", id: m.id }, lignes: [{ compteId: clients, debit: tropPercu, credit: 0 }, { compteId: tresorerie.account_id, debit: 0, credit: tropPercu }] });
    }
    await ctx.journaliser({ type: "sales", action: "credit_note_issue", objetType: "credit_note", objetId: av.id, motif: d.motif,
      apres: { numero: av.number, facture: f.numero, client: f.client.nom, totalHt, totalTva, totalTtc, rembourse: tresorerie ? tropPercu : 0, compte: tresorerie?.name ?? null },
      details: { ecriture, mouvement } });
    return avecCode(ctx, deps, (await chargerAvoir(ctx.c, av.id))!);
  }));

  app.get("/api/ventes/avoirs/:id/pdf", proteger(deps, { permission: "sales.read" }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw nonTrouve("Avoir");
    const a = await chargerAvoir(ctx.c, id);
    if (!a) throw nonTrouve("Avoir");
    const { codeVerification: code } = await avecCode(ctx, deps, a);
    const logo = a.vendeur.logoId ? (await ctx.c.query("SELECT data FROM company_logos WHERE id = $1", [a.vendeur.logoId])).rows[0]?.data as Buffer | undefined : undefined;
    const devise = a.devise === "XAF" ? "FCFA" : a.devise;
    const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/[  ]/g, " ");
    const pdf = await genererFacturePdf({ codeVerification: code, logo,
      numero: a.numero, date: a.date, type: "Facture d'avoir", vendeur: a.vendeur, client: a.client,
      lignes: a.lignes.map((l) => ({ designation: l.designation, quantite: quantiteTexte(l.quantite), prixUnitaire: l.prixUnitaire, montant: l.montant })),
      totalHt: a.totalHt, tauxTvaPdm: a.tauxTvaPdm, totalTva: a.totalTva, totalTtc: a.totalTtc, devise,
      paiement: a.remboursement
        ? `remboursé au client : ${fmt(a.remboursement.montant)} ${devise} (${a.remboursement.compte})${a.remboursement.montant < a.totalTtc ? ` ; le solde vient en déduction de la facture ${a.facture.numero}` : ""}`
        : `vient en déduction de la facture ${a.facture.numero}`,
      paye: 0, avoir: { facture: a.facture.numero, dateFacture: a.facture.date, motif: a.motif },
    });
    await ctx.journaliser({ type: "sales", action: "credit_note_pdf", objetType: "credit_note", objetId: id, details: { numero: a.numero } });
    ctx.rep.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${a.numero}.pdf"`);
    return pdf;
  }));
}
