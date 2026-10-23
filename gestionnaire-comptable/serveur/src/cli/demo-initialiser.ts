import { transaction } from "../db.js";
import { creerEntreprise } from "../domaine/entreprises.js";
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
      code: "GC-DEMO-2026", raisonSociale: "ITI Démonstration SARL", adminEmail: "mariam.saleh@demo.cm", adminNom: "Mariam Saleh",
      rccm: "RC/DLA/2026/B/0000 (fictif)", niu: "M000000000000X (fictif)",
    });
    const hash = await hacherMotDePasse(motDePasse);
    await transaction(pool, e.entrepriseId, async (c) => {
      await c.query("UPDATE companies SET settings = settings || '{\"mfaObligatoire\": false}', address = 'Douala (adresse fictive)' WHERE id = $1", [e.entrepriseId]);
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
      // TVA de démonstration : 19,25 % (taux À VÉRIFIER dans la loi de finances en vigueur avant tout usage réel).
      // Profil fictif complet (en-tête des factures). Logo et couleurs : à choisir par l'entreprise dans « Entreprise ».
      await c.query(`UPDATE companies SET phone = '+237 600 00 00 00 (fictif)',
        settings = jsonb_set(settings, '{profil}', '{"email": "contact@demo.cm", "regimeFiscal": "Régime du réel (à vérifier)", "patente": "PAT-DEMO-0000 (fictif)"}') WHERE id = $1`, [e.entrepriseId]);
      await c.query(`UPDATE companies SET settings = jsonb_set(settings, '{fiscal}', '{"tvaApplicable": true, "tauxTvaPdm": 1925, "mentionsFacture": "Document de démonstration : données fictives, taux de TVA à vérifier."}') WHERE id = $1`, [e.entrepriseId]);
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
