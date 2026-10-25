import { memoriserIdentite } from "./profil-entreprise.js";
import { initialiserReferentiels } from "./pharmacie/referentiels.js";
import { randomUUID } from "node:crypto";
import type { Pool } from "../db.js";
import { transaction } from "../db.js";
import { ROLES_SYSTEME } from "./roles-systeme.js";
import { journaliser, journaliserSysteme } from "./audit.js";
import { empreinteCodeAcces, genererCodeAcces } from "../securite/jetons.js";
import { genererCodeMaitre, normaliserCodeMaitre } from "../securite/code-maitre.js";
import { hacherMotDePasse } from "../securite/motdepasse.js";

export interface NouvelleEntreprise {
  code: string; raisonSociale: string; adminEmail: string; adminNom: string;
  pays?: string; devise?: string; rccm?: string; niu?: string;
}

/**
 * Crée une entreprise, ses rôles système et son administrateur principal (statut « invité »).
 * Réservé à l'exploitation (outil en ligne de commande, connexion propriétaire gc_owner).
 * Renvoie le jeton d'invitation de l'administrateur (valable 72 h) et le code maître de l'entreprise :
 * deux secrets affichés une seule fois, à remettre à deux personnes différentes de préférence.
 */
export async function creerEntreprise(poolProprietaire: Pool, n: NouvelleEntreprise) {
  const code = n.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{3,31}$/.test(code)) throw new Error("Code entreprise invalide : 4 à 32 caractères, lettres majuscules, chiffres et tirets.");
  const id = randomUUID();
  const jeton = genererCodeAcces();
  const codeMaitre = genererCodeMaitre();
  const hashCodeMaitre = await hacherMotDePasse(normaliserCodeMaitre(codeMaitre));
  const res = await transaction(poolProprietaire, id, async (c) => {
    await c.query(
      `INSERT INTO companies (id, company_code, legal_name, country_code, currency_code, rccm, niu, master_code_hash, master_code_created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
      [id, code, n.raisonSociale.trim(), n.pays ?? "CM", n.devise ?? "XAF", n.rccm ?? null, n.niu ?? null, hashCodeMaitre]);
    // Premier compte : administrateur ET pharmacien titulaire (dans une petite officine, c'est la même personne).
    // Les rôles se séparent ensuite en créant d'autres comptes.
    const rolesPremierCompte: string[] = [];
    for (const r of ROLES_SYSTEME) {
      const { rows } = await c.query(
        "INSERT INTO roles (role_key, display_name, description, is_system_role, mfa_required) VALUES ($1,$2,$3,true,$4) RETURNING id",
        [r.cle, r.libelle, r.description, r.mfa]);
      if (r.cle === "company_admin" || r.cle === "pharmacist_owner") rolesPremierCompte.push(rows[0].id);
      await c.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`, [rows[0].id, r.permissions]);
    }
    const { rows: [admin] } = await c.query(
      "INSERT INTO app_users (email, full_name, status) VALUES ($1,$2,'invited') RETURNING id",
      [n.adminEmail.trim().toLowerCase(), n.adminNom.trim()]);
    for (const r of rolesPremierCompte) await c.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)", [admin.id, r]);
    const { rows: [tok] } = await c.query(
      "INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,'invitation',$2, now() + interval '72 hours') RETURNING expires_at",
      [admin.id, empreinteCodeAcces(jeton)]);
    // Référentiels de départ de l'officine (modifiables, archivables) : formes, emplacements, grandes catégories.
    await initialiserReferentiels(c);
    await memoriserIdentite(c, id);   // identité imprimée sur les documents (reçus compris)
    await journaliser(c, { type: "company", action: "create", objetType: "company", objetId: id, apres: { code, raisonSociale: n.raisonSociale }, details: { origine: "outil d'exploitation" } });
    await journaliser(c, { type: "users", action: "invite", objetType: "user", objetId: admin.id, apres: { email: n.adminEmail, role: "company_admin" }, details: { origine: "outil d'exploitation" } });
    return { entrepriseId: id, code, adminId: admin.id as string, jetonInvitation: jeton, expireLe: tok.expires_at as Date, codeMaitre };
  });
  await journaliserSysteme(poolProprietaire, "company.create", "success", { code, entrepriseId: id });
  return res;
}
