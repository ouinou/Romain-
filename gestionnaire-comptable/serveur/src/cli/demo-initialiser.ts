import { transaction } from "../db.js";
import { creerEntreprise } from "../domaine/entreprises.js";
import { identiteActuelle, memoriserIdentite } from "../domaine/profil-entreprise.js";
import { journaliser } from "../domaine/audit.js";
import { hacherMotDePasse } from "../securite/motdepasse.js";
import { genererEcriture } from "../domaine/comptabilite/generation.js";
import { executer, poolProprietaire } from "./outils.js";

/**
 * Crée une entreprise de DÉMONSTRATION avec des personnes fictives, pour tester l'interface.
 * Refuse de s'exécuter sans GC_MODE_DEMO=oui. Ne jamais lancer sur une base de production.
 * Tous les comptes actifs reçoivent le même mot de passe, affiché à la fin : c'est volontaire et
 * acceptable uniquement parce qu'il s'agit de données fictives.
 */
const PERSONNES: [string, string, string, "active" | "invited" | "disabled"][] = [
  ["Paul Ngaro", "paul.ngaro@demo.cm", "accountant", "active"],
  ["Amina Mahamat", "amina.mahamat@demo.cm", "cashier", "active"],
  ["Jean Bemba", "jean.bemba@demo.cm", "stock_manager", "active"],
  ["Nadia Koyom", "nadia.koyom@demo.cm", "purchasing_manager", "active"],
  ["Ousmane Djibrine", "ousmane.djibrine@demo.cm", "finance_director", "active"],
  ["Joseph Atangana", "joseph.atangana@demo.cm", "general_manager", "active"],
  ["Rachel Ewane", "rachel.ewane@demo.cm", "hr_manager", "invited"],
  ["Auditeur externe", "audit@demo.cm", "auditor", "disabled"],
];

await executer(async () => {
  if (process.env.GC_MODE_DEMO !== "oui") throw new Error("Outil de démonstration : définissez GC_MODE_DEMO=oui pour confirmer qu'il ne s'agit pas d'une base de production.");
  const motDePasse = process.env.GC_DEMO_MOT_DE_PASSE ?? "Demonstration-2026!";
  const pool = poolProprietaire();
  try {
    const e = await creerEntreprise(pool, {
      code: "GC-DEMO-2026", raisonSociale: "Entreprise Démo SARL", adminEmail: "mariam.saleh@demo.cm", adminNom: "Mariam Saleh",
      rccm: "RC/DLA/2026/B/0000 (fictif)", niu: "M000000000000X (fictif)",
    });
    const hash = await hacherMotDePasse(motDePasse);
    await transaction(pool, e.entrepriseId, async (c) => {
      await c.query("UPDATE companies SET settings = settings || '{\"mfaObligatoire\": false}', address = 'Adresse fictive' WHERE id = $1", [e.entrepriseId]);
      // TVA de démonstration : 19,25 % (taux À VÉRIFIER dans la loi de finances en vigueur avant tout usage réel).
      // Profil fictif complet (en-tête des factures). Logo et couleurs : à choisir par l'entreprise dans « Entreprise ».
      await c.query(`UPDATE companies SET phone = '+237 600 00 00 00 (fictif)',
        settings = jsonb_set(settings, '{profil}', '{"email": "contact@demo.cm", "regimeFiscal": "Régime du réel (à vérifier)", "patente": "PAT-DEMO-0000 (fictif)", "ville": "Douala", "formeJuridique": "SARL"}') WHERE id = $1`, [e.entrepriseId]);
      await c.query(`UPDATE companies SET settings = jsonb_set(settings, '{fiscal}', '{"tvaApplicable": true, "tauxTvaPdm": 1925, "mentionsFacture": "Document de démonstration : données fictives, taux de TVA à vérifier."}') WHERE id = $1`, [e.entrepriseId]);
      // Identité imprimée sur les documents : calculée par le même service que dans le logiciel (aucune copie en dur).
      await memoriserIdentite(c, e.entrepriseId);
      await c.query("UPDATE app_users SET status = 'active', password_hash = $2, password_changed_at = now() WHERE id = $1", [e.adminId, hash]);
      await c.query("UPDATE user_tokens SET used_at = now() WHERE user_id = $1", [e.adminId]);
      for (const [nom, email, role, statut] of PERSONNES) {
        const { rows: [u] } = await c.query(
          "INSERT INTO app_users (email, full_name, status, password_hash, password_changed_at) VALUES ($1,$2,$3,$4, CASE WHEN $4::text IS NULL THEN NULL ELSE now() END) RETURNING id",
          [email, nom, statut, statut === "invited" ? null : hash]);
        await c.query("INSERT INTO user_roles (user_id, role_id, assigned_by) SELECT $1, id, $2 FROM roles WHERE role_key = $3", [u.id, e.adminId, role]);
        await journaliser(c, { type: "users", action: "create", objetType: "user", objetId: u.id, apres: { email, nom, role, statut }, details: { origine: "données de démonstration" } });
      }
      // Écritures fictives : saisies par le comptable ou le DAF, validées par une autre personne.
      const id = async (email: string) => (await c.query("SELECT id FROM app_users WHERE email = $1", [email])).rows[0].id as string;
      const [paul, ousmane, joseph] = [await id("paul.ngaro@demo.cm"), await id("ousmane.djibrine@demo.cm"), await id("joseph.atangana@demo.cm")];
      const an = new Date().getFullYear();
      const ecr: [string, string, string, string, string, [string, number, number][], string | null][] = [
        ["BQ", "01-05", "BQ-DEMO-001", "Apport initial en capital", ousmane, [["521", 500000, 0], ["101", 0, 500000]], joseph],
        ["VT", "01-12", "VT-DEMO-001", "Vente au comptant", paul, [["571", 500000, 0], ["701", 0, 500000]], ousmane],
        ["AC", "01-15", "FAC-DEMO-001", "Achat de fournitures de bureau", paul, [["605", 150000, 0], ["401", 0, 150000]], ousmane],
        ["CA", "01-20", "CA-DEMO-001", "Petite dépense de caisse", paul, [["605", 100000, 0], ["571", 0, 100000]], ousmane],
        ["AC", "02-03", "FAC-DEMO-002", "Facture d'électricité (à valider)", paul, [["605", 45000, 0], ["401", 0, 45000]], null],
      ];
      for (const [jc, jour, piece, libelle, auteur, lignes, validateur] of ecr) {
        const { rows: [e] } = await c.query(
          `INSERT INTO journal_entries (fiscal_year_id, journal_id, entry_date, piece_reference, label, created_by)
           SELECT f.id, j.id, $2::date, $3, $4, $5 FROM fiscal_years f, journals j WHERE j.code = $1 AND $2::date BETWEEN f.start_date AND f.end_date
           RETURNING id`, [jc, `${an}-${jour}`, piece, libelle, auteur]);
        for (const [i, [compte, d, cr]] of lignes.entries())
          await c.query("INSERT INTO entry_lines (entry_id, line_no, account_id, debit, credit) SELECT $1, $2, id, $4, $5 FROM accounts WHERE account_number = $3", [e.id, i + 1, compte, d, cr]);
        if (validateur) await c.query("UPDATE journal_entries SET status = 'validated', validated_by = $2 WHERE id = $1", [e.id, validateur]);
      }
      // Trésorerie : caisse attitrée à la caissière, banque et mobile money ; fonds de caisse initial.
      const amina = await id("amina.mahamat@demo.cm");
      const tresorerie: [string, string, string, string][] = [["cash", "Caisse principale", "5711", "CA"], ["bank", "Banque fictive", "5211", "BQ"], ["mobile", "Mobile money (fictif)", "5212", "BQ"]];
      const ids: Record<string, { id: string; compte: string; journal: string }> = {};
      for (const [kind, nom, numero, journal] of tresorerie) {
        const { rows: [a] } = await c.query("INSERT INTO accounts (account_number, label, postable, source) VALUES ($1,$2,true,'company') RETURNING id", [numero, nom]);
        const { rows: [t] } = await c.query("INSERT INTO treasury_accounts (kind, name, account_id, journal_id) SELECT $1, $2, $3, id FROM journals WHERE code = $4 RETURNING id, journal_id", [kind, nom, a.id, journal]);
        ids[kind] = { id: t.id, compte: a.id, journal: t.journal_id };
      }
      await c.query("INSERT INTO treasury_account_holders (treasury_account_id, user_id) VALUES ($1,$2)", [ids.cash.id, amina]);
      const { rows: [capital] } = await c.query("SELECT id FROM accounts WHERE account_number = '101'");
      const { rows: [m] } = await c.query(
        `INSERT INTO treasury_movements (treasury_account_id, direction, kind, amount, movement_date, reference, label, category, counterpart_account_id, created_by)
         VALUES ($1, 'in', 'receipt', 100000, make_date($2, 1, 3), '', 'Fonds de caisse initial', 'apport', $3, $4) RETURNING id, reference`, [ids.cash.id, an, capital.id, ousmane]);
      await genererEcriture(c, { journalId: ids.cash.journal, date: `${an}-01-03`, piece: m.reference, libelle: "Fonds de caisse initial", auteur: ousmane,
        source: { type: "treasury_movement", id: m.id }, lignes: [{ compteId: ids.cash.compte, debit: 100000, credit: 0 }, { compteId: capital.id, debit: 0, credit: 100000 }] });
      // Historique FICTIF de ventes sur les cinq mois précédents, pour que le tableau de bord d'une installation
      // d'évaluation montre des courbes. Seulement avec GC_DEMO_HISTORIQUE=oui (option « démonstration » du setup).
      if (process.env.GC_DEMO_HISTORIQUE === "oui") await historiqueVentes(c, { amina, ousmane, joseph, an, ids, entrepriseId: e.entrepriseId });
    });
    console.log("Entreprise de démonstration créée (données fictives).");
    console.log("  Code entreprise : GC-DEMO-2026");
    console.log("  Administratrice : mariam.saleh@demo.cm");
    console.log("  Autres comptes   : paul.ngaro@demo.cm (comptable), ousmane.djibrine@demo.cm (DAF), joseph.atangana@demo.cm (DG),");
    console.log("                     amina.mahamat@demo.cm (caissière), jean.bemba@demo.cm (stocks), nadia.koyom@demo.cm (achats)");
    console.log(`  Mot de passe de démonstration (tous les comptes actifs) : ${motDePasse}`);
    console.log("  Double authentification obligatoire : désactivée pour la démonstration (réactivable dans Entreprise).");
  } finally { await pool.end(); }
});

/** Ventes fictives des cinq mois précédents (dans l'exercice en cours), avec écritures validées et encaissements. */
async function historiqueVentes(c: import("../db.js").Client, d: {
  amina: string; ousmane: string; joseph: string; an: number; entrepriseId: string;
  ids: Record<string, { id: string; compte: string; journal: string }>;
}) {
  const vendeur = await identiteActuelle(c, d.entrepriseId);
  const compte = async (n: string) => (await c.query("SELECT id FROM accounts WHERE account_number = $1", [n])).rows[0].id as string;
  const cpt = { "701": await compte("701"), "706": await compte("706"), "411": await compte("411"), "443": await compte("443") };
  const { rows: [jv] } = await c.query("SELECT id FROM journals WHERE code = 'VT'");
  const clients: string[] = [];
  for (const [nom, tel] of [["Établissements Fictifs Mbarga", "+237 600 00 00 01"], ["Cabinet Démo Ndjamena", "+237 600 00 00 02"], ["Boutique Démo Akwa", "+237 600 00 00 03"]])
    clients.push((await c.query("INSERT INTO customers (name, phone, address) VALUES ($1,$2,'Douala (fictif)') RETURNING id", [nom, tel])).rows[0].id);
  // [jour, client, désignation, nature, quantité, prix HT, paiement] — montants fixes : l'historique est le même à chaque installation.
  const MODELES: [number, number, string, "marchandise" | "service", number, number, "caisse" | "banque" | "credit"][][] = [
    [[4, 0, "Ramettes de papier A4", "marchandise", 40, 3500, "caisse"], [12, 1, "Maintenance informatique", "service", 1, 120000, "banque"], [21, 2, "Cartouches d'encre", "marchandise", 12, 15000, "caisse"]],
    [[3, 1, "Audit de caisse", "service", 1, 250000, "credit"], [10, 0, "Classeurs et chemises", "marchandise", 60, 1200, "caisse"], [18, 2, "Installation de poste", "service", 2, 35000, "banque"], [26, 0, "Cartouches d'encre", "marchandise", 8, 15000, "caisse"]],
    [[5, 2, "Formation logiciel", "service", 1, 180000, "banque"], [11, 0, "Ramettes de papier A4", "marchandise", 50, 3500, "caisse"], [19, 1, "Maintenance informatique", "service", 1, 120000, "credit"], [27, 2, "Cartouches d'encre", "marchandise", 15, 15000, "caisse"]],
    [[2, 0, "Imprimante laser", "marchandise", 2, 145000, "banque"], [9, 1, "Assistance comptable", "service", 1, 200000, "banque"], [16, 2, "Ramettes de papier A4", "marchandise", 70, 3500, "caisse"], [23, 0, "Cartouches d'encre", "marchandise", 10, 15000, "credit"], [28, 1, "Installation de poste", "service", 3, 35000, "caisse"]],
    [[3, 2, "Maintenance informatique", "service", 1, 120000, "banque"], [8, 0, "Classeurs et chemises", "marchandise", 90, 1200, "caisse"], [15, 1, "Formation logiciel", "service", 1, 180000, "credit"], [22, 2, "Cartouches d'encre", "marchandise", 20, 15000, "caisse"], [27, 0, "Imprimante laser", "marchandise", 1, 145000, "banque"]],
  ];
  const maintenant = new Date();
  for (let k = 5; k >= 1; k--) {
    const debut = new Date(maintenant.getFullYear(), maintenant.getMonth() - k, 1);
    if (debut.getFullYear() !== d.an) continue;   // l'exercice de démonstration couvre l'année civile en cours
    for (const [jour, cl, designation, nature, qte, pu, paiement] of MODELES[5 - k]) {
      const date = `${d.an}-${String(debut.getMonth() + 1).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
      const ht = qte * pu, tva = Math.floor((ht * 1925 + 5000) / 10000), ttc = ht + tva;
      const t = paiement === "caisse" ? d.ids.cash : paiement === "banque" ? d.ids.bank : null;
      const auteur = paiement === "caisse" ? d.amina : d.ousmane;
      const { rows: [nomClient] } = await c.query("SELECT name, phone FROM customers WHERE id = $1", [clients[cl]]);
      const { rows: [inv] } = await c.query(
        `INSERT INTO invoices (invoice_date, kind, customer_id, customer_name, customer_phone, seller, currency, tax_rate_bp, total_ht, total_tax, total_ttc, payment_mode, treasury_account_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'XAF',1925,$7,$8,$9,$10,$11,$12) RETURNING id, number`,
        [date, nature === "service" ? "services" : "goods", clients[cl], nomClient.name, nomClient.phone, JSON.stringify(vendeur), ht, tva, ttc, t ? "immediate" : "credit", t?.id ?? null, auteur]);
      const revenu = nature === "service" ? cpt["706"] : cpt["701"];
      await c.query("INSERT INTO invoice_lines (invoice_id, line_no, description, quantity, unit_price, amount, revenue_account_id) VALUES ($1,1,$2,$3,$4,$5,$6)", [inv.id, designation, qte, pu, ht, revenu]);
      const libelle = `Facture ${inv.number} : ${nomClient.name}`;
      const valider = async (ecriture: string) => c.query("UPDATE journal_entries SET status = 'validated', validated_by = $2 WHERE id = $1", [ecriture, auteur === d.ousmane ? d.joseph : d.ousmane]);
      await valider(await genererEcriture(c, { journalId: jv.id, date, piece: inv.number, libelle, auteur, source: { type: "invoice", id: inv.id },
        lignes: [{ compteId: cpt["411"], debit: ttc, credit: 0 }, { compteId: revenu, debit: 0, credit: ht }, { compteId: cpt["443"], debit: 0, credit: tva }] }));
      // Encaissement : immédiat, ou pour une vente à crédit, un acompte de la moitié par la banque dix jours plus tard.
      const reglement = t ? { compte: t, montant: ttc, date } : { compte: d.ids.bank, montant: Math.floor(ttc / 2), date: date.slice(0, 8) + String(Math.min(jour + 10, 28)).padStart(2, "0") };
      const { rows: [m] } = await c.query(
        `INSERT INTO treasury_movements (treasury_account_id, direction, kind, amount, movement_date, reference, label, category, counterpart_account_id, invoice_id, created_by)
         VALUES ($1,'in','invoice_payment',$2,$3,$4,$5,'encaissement_client',$6,$7,$8) RETURNING id`,
        [reglement.compte.id, reglement.montant, reglement.date, inv.number, `Règlement ${libelle}`.slice(0, 200), cpt["411"], inv.id, auteur]);
      await valider(await genererEcriture(c, { journalId: reglement.compte.journal, date: reglement.date, piece: inv.number, libelle: `Règlement ${libelle}`, auteur,
        source: { type: "treasury_movement", id: m.id }, lignes: [{ compteId: reglement.compte.compte, debit: reglement.montant, credit: 0 }, { compteId: cpt["411"], debit: 0, credit: reglement.montant }] }));
    }
  }
}
