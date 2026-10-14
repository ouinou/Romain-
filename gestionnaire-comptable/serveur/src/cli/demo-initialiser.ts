import { transaction } from "../db.js";
import { creerEntreprise } from "../domaine/entreprises.js";
import { journaliser } from "../domaine/audit.js";
import { hacherMotDePasse } from "../securite/motdepasse.js";
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
  ["Ousmane Djibrine", "ousmane.djibrine@demo.cm", "finance_director", "invited"],
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
    });
    console.log("Entreprise de démonstration créée (données fictives).");
    console.log("  Code entreprise : GC-DEMO-2026");
    console.log("  Administratrice : mariam.saleh@demo.cm");
    console.log("  Autres comptes   : paul.ngaro@demo.cm (comptable), amina.mahamat@demo.cm (caissière), jean.bemba@demo.cm (stocks), nadia.koyom@demo.cm (achats)");
    console.log(`  Mot de passe de démonstration (tous les comptes actifs) : ${motDePasse}`);
    console.log("  Double authentification obligatoire : désactivée pour la démonstration (réactivable dans Entreprise).");
  } finally { await pool.end(); }
});
