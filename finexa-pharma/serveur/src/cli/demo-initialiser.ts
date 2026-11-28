import { transaction } from "../db.js";
import { creerEntreprise } from "../domaine/entreprises.js";
import { memoriserIdentite } from "../domaine/profil-entreprise.js";
import { journaliser } from "../domaine/audit.js";
import { hacherMotDePasse } from "../securite/motdepasse.js";
import { executer, poolProprietaire } from "./outils.js";

/**
 * Crée une officine de DÉMONSTRATION : personnes, produits, lots et prix FICTIFS, pour évaluer le logiciel.
 * Refuse de s'exécuter sans GC_MODE_DEMO=oui. Ne jamais lancer sur une base de production.
 * Tous les comptes actifs reçoivent le même mot de passe, affiché à la fin : acceptable uniquement parce
 * qu'il s'agit de données fictives. Les noms de produits sont des dénominations génériques courantes suivies
 * de « (démo) » ; prix, lots et dates sont inventés.
 */
const PERSONNES: [string, string, string, "active" | "invited" | "disabled"][] = [
  ["Marc Eyinga", "marc.eyinga@demo.cm", "pharmacist_assistant", "active"],
  ["Clarisse Mbarga", "clarisse.mbarga@demo.cm", "seller", "active"],
  ["Hamadou Bouba", "hamadou.bouba@demo.cm", "cashier", "active"],
  ["Esther Ngo Bassa", "esther.ngobassa@demo.cm", "stock_manager", "active"],
  ["Auditeur externe", "audit@demo.cm", "auditor", "disabled"],
];

// [nom, dci, catégorie, famille, forme, dosage, présentation, prix d'achat, prix de vente, seuil]
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

await executer(async () => {
  if (process.env.GC_MODE_DEMO !== "oui") throw new Error("Outil de démonstration : définissez GC_MODE_DEMO=oui pour confirmer qu'il ne s'agit pas d'une base de production.");
  const motDePasse = process.env.GC_DEMO_MOT_DE_PASSE ?? "Demonstration-2026!";
  const pool = poolProprietaire();
  try {
    const e = await creerEntreprise(pool, {
      code: "PH-DEMO-2026", raisonSociale: "Pharmacie Démo", adminEmail: "aissatou.bello@demo.cm", adminNom: "Aïssatou Bello",
      rccm: "RC/DLA/2026/B/0000 (fictif)", niu: "M000000000000X (fictif)",
    });
    const hash = await hacherMotDePasse(motDePasse);
    await transaction(pool, e.entrepriseId, async (c) => {
      await c.query(`UPDATE companies SET address = 'Adresse fictive', phone = '+237 600 00 00 00 (fictif)',
        settings = settings || '{"mfaObligatoire": false}'::jsonb
                   || jsonb_build_object('profil', '{"email": "contact@pharmacie-demo.cm", "ville": "Douala", "formeJuridique": "SARL", "slogan": "Données fictives de démonstration"}'::jsonb,
                                         'pharmacie', '{"delaiAlertePeremption": 90, "tauxTva": [{"libelle": "TVA parapharmacie (taux à vérifier)", "tauxPdm": 1925}]}'::jsonb)
        WHERE id = $1`, [e.entrepriseId]);
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
      const { rows: [esther] } = await c.query("SELECT id FROM app_users WHERE email = 'esther.ngobassa@demo.cm'");
      const ref = async (table: string, nom: string, parent?: string) => {
        const { rows: [x] } = await c.query(`SELECT id FROM ${table} WHERE name = $1 ${table === "categories" ? (parent ? "AND parent_id = $2" : "AND parent_id IS NULL") : ""}`, parent ? [nom, parent] : [nom]);
        if (x) return x.id as string;
        return (await c.query(table === "categories" ? "INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id" : `INSERT INTO ${table} (name) VALUES ($1) RETURNING id`, table === "categories" ? [nom, parent ?? null] : [nom])).rows[0].id as string;
      };
      const { rows: [rayon] } = await c.query("SELECT id FROM storage_locations WHERE kind = 'shelf' LIMIT 1");
      const jour = (decalage: number) => { const d = new Date(); d.setDate(d.getDate() + decalage); return d.toISOString().slice(0, 10); };
      for (const [i, [nom, dci, categorie, famille, forme, dosage, presentation, achat, vente, seuil]] of PRODUITS.entries()) {
        const cat = await ref("categories", categorie);
        const { rows: [p] } = await c.query(
          `INSERT INTO products (name, dci, category_id, form_id, dosage, presentation, manufacturer, purchase_price, sale_price, tax_rate_bp, alert_threshold, barcode, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'Laboratoire fictif',$7,$8,$9,$10,$11,$12) RETURNING id`,
          [nom, dci || null, await ref("categories", famille, cat), await ref("dosage_forms", forme), dosage || null, presentation, achat, vente,
           categorie === "Médicaments" ? 0 : 1925, seuil, `200000000${String(i + 1).padStart(4, "0")}`, esther.id]);
        await c.query("INSERT INTO product_price_history (product_id, purchase_price, sale_price, tax_rate_bp, changed_by) SELECT id, purchase_price, sale_price, tax_rate_bp, $2 FROM products WHERE id = $1", [p.id, esther.id]);
        // Lots fictifs : un lot ordinaire pour tous ; quelques cas pour montrer les alertes.
        const lots: [string, number, number, string?][] = [[`DEMO${101 + i}A`, 400 + i * 20, 40 + (i % 4) * 15]];
        if (i === 0) lots.push(["DEMO100P", 45, 12]);                 // péremption proche
        if (i === 3) lots.push(["DEMO103X", -10, 6]);                 // périmé, encore en stock
        if (i === 5) lots.push(["DEMO105B", 300, 20, "Doute sur l'emballage : en attente de contrôle (démo)"]);
        for (const [numero, joursAvantPeremption, quantite, blocage] of lots) {
          const { rows: [l] } = await c.query(
            `INSERT INTO lots (product_id, lot_number, expiry_date, supplier_name, received_on, purchase_price, location_id, status, status_reason, created_by)
             VALUES ($1,$2,$3,'Grossiste fictif',$4,$5,$6,$7,$8,$9) RETURNING id`,
            [p.id, numero, jour(joursAvantPeremption), jour(-30), achat, rayon.id, blocage ? "blocked" : "available", blocage ?? null, esther.id]);
          await c.query("INSERT INTO stock_movements (lot_id, product_id, kind, quantity, reason, created_by) VALUES ($1,$2,'initial',$3,'Stock initial (démo)',$4)", [l.id, p.id, quantite, esther.id]);
        }
      }
      // Un produit en rupture (aucun stock) et une casse, pour montrer les alertes et l'historique.
      await c.query(`INSERT INTO products (name, dci, category_id, form_id, presentation, sale_price, alert_threshold, created_by)
                     SELECT 'Salbutamol inhalateur (démo)', 'Salbutamol', (SELECT id FROM categories WHERE name = 'Médicaments' AND parent_id IS NULL), (SELECT id FROM dosage_forms WHERE name = 'Autre'),
                            'Flacon pressurisé', 3500, 3, $1`, [esther.id]);
      const { rows: [casse] } = await c.query("SELECT l.id, l.product_id FROM lots l JOIN products p ON p.id = l.product_id WHERE p.name LIKE 'Ibuprofène%' LIMIT 1");
      await c.query("INSERT INTO stock_movements (lot_id, product_id, kind, quantity, reason, created_by) VALUES ($1,$2,'breakage',-2,'Casse ou produit abîmé : boîtes écrasées (démo)',$3)", [casse.id, casse.product_id, esther.id]);
    });
    console.log("Officine de démonstration créée (données fictives).");
    console.log("  Code entreprise : PH-DEMO-2026");
    console.log("  Pharmacienne titulaire et administratrice : aissatou.bello@demo.cm");
    console.log("  Autres comptes : marc.eyinga@demo.cm (adjoint), clarisse.mbarga@demo.cm (vendeuse), hamadou.bouba@demo.cm (caissier), esther.ngobassa@demo.cm (stock)");
    console.log(`  Mot de passe de démonstration (tous les comptes actifs) : ${motDePasse}`);
  } finally { await pool.end(); }
});
