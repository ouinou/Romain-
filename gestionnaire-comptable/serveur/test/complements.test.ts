import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { Agent, MDP, confirmer, entrepriseActive, journal, preparer, totp, url, utilisateurAvecRole, type Env } from "./aide.js";
import { sauvegarder, restaurer } from "../src/domaine/sauvegarde.js";
import { controlerJournaux } from "../src/domaine/controle-journal.js";
import { genererCodeMaitre, normaliserCodeMaitre } from "../src/securite/code-maitre.js";
import { ROLES_SYSTEME } from "../src/domaine/roles-systeme.js";

let env: Env;
let dossier: string;
before(async () => {
  env = await preparer();
  dossier = mkdtempSync(join(tmpdir(), "gc-test-"));
  if (!process.env.GC_PG_BIN && existsSync("/usr/lib/postgresql/16/bin")) process.env.GC_PG_BIN = "/usr/lib/postgresql/16/bin";
});
after(async () => { await env?.fermer(); rmSync(dossier, { recursive: true, force: true }); });

describe("Confirmation avant les opérations sensibles", () => {
  test("Sans confirmation récente, l'opération est refusée ; un mauvais mot de passe aussi", async () => {
    const e = await entrepriseActive(env, "CONF-01", { mfa: false });
    const { id } = await utilisateurAvecRole(env, e, "accountant", "compta@conf-01.cm");
    const admin = new Agent(env.app, "10.0.0.11");
    await admin.post("/api/auth/connexion", { codeEntreprise: "CONF-01", email: e.email, motDePasse: MDP });
    const sans = await admin.post(`/api/utilisateurs/${id}/desactivation`, { motif: "Départ" });
    assert.equal(sans.statut, 403);
    assert.equal(sans.corps.erreur.code, "confirmation_requise");
    assert.equal((await admin.get("/api/audit/export")).corps.erreur.code, "confirmation_requise");
    const faux = await admin.post("/api/auth/confirmation", { motDePasse: "pas-le-bon" });
    assert.equal(faux.statut, 401);
    assert.equal(faux.corps.erreur.code, "confirmation_refusee");
    await confirmer(admin);
    assert.equal((await admin.post(`/api/utilisateurs/${id}/desactivation`, { motif: "Départ" })).statut, 200);
    // La confirmation expire.
    await env.superu.query("UPDATE user_sessions SET reauth_at = now() - interval '6 minutes' WHERE reauth_at IS NOT NULL");
    assert.equal((await admin.post(`/api/utilisateurs/${id}/reactivation`, { motif: "Retour" })).corps.erreur.code, "confirmation_requise");
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.some((x) => x.action === "step_up" && x.outcome === "failure"));
  });

  test("Avec la MFA active, la confirmation exige aussi le code", async () => {
    const e = await entrepriseActive(env, "CONF-02");
    const init = await e.admin.post("/api/auth/mfa/initialisation");
    await e.admin.post("/api/auth/mfa/activation", { code: totp(init.corps.secret) });
    const r = await e.admin.post("/api/auth/confirmation", { motDePasse: MDP });
    assert.equal(r.corps.erreur.code, "mfa_requis");
    await confirmer(e.admin, totp(init.corps.secret, 1));
  });
});

describe("Code maître de l'entreprise", () => {
  test("Format et normalisation", () => {
    const c = genererCodeMaitre();
    assert.match(c, /^GCM(-[2-9A-HJKMNP-Z]{4}){6}$/);
    assert.equal(normaliserCodeMaitre(c.toLowerCase().replaceAll("-", " ")), normaliserCodeMaitre(c));
  });

  test("Récupère l'accès d'un administrateur, une seule fois, et prévient les administrateurs", async () => {
    const e = await entrepriseActive(env, "MAITRE-01");
    const init = await e.admin.post("/api/auth/mfa/initialisation");
    await e.admin.post("/api/auth/mfa/activation", { code: totp(init.corps.secret) });
    const { id: compta } = await utilisateurAvecRole(env, e, "accountant", "compta@maitre-01.cm");
    const anonyme = new Agent(env.app, "10.9.9.9");
    const base = { codeEntreprise: "MAITRE-01", codeMaitre: e.codeMaitre };

    // Code valable mais compte qui n'est pas administrateur : refusé, code NON consommé.
    assert.equal((await anonyme.post("/api/auth/recuperation", { ...base, email: "compta@maitre-01.cm" })).statut, 400);
    // Bon code, bon administrateur.
    const ok = await anonyme.post("/api/auth/recuperation", { ...base, email: e.email });
    assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
    assert.equal((await e.admin.get("/api/auth/moi")).statut, 401, "sessions de l'administrateur fermées");
    // Le code est consommé.
    assert.equal((await anonyme.post("/api/auth/recuperation", { ...base, email: e.email })).statut, 400);
    // Nouveau mot de passe, MFA réinitialisée.
    const nouveau = "Recuperation-Reussie-2026";
    assert.equal((await anonyme.post("/api/auth/reinitialisation", { codeEntreprise: "MAITRE-01", jeton: ok.corps.reinitialisation.jeton, motDePasse: nouveau })).statut, 200);
    const admin = new Agent(env.app);
    const cx = await admin.post("/api/auth/connexion", { codeEntreprise: "MAITRE-01", email: e.email, motDePasse: nouveau });
    assert.equal(cx.statut, 200, "connexion sans code MFA : la MFA a été réinitialisée");
    assert.equal(cx.corps.mfaAConfigurer, true);
    const notifs = await admin.get("/api/notifications");
    assert.ok(notifs.corps.elements.some((n: { titre: string }) => n.titre === "Code maître utilisé"));
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.some((x) => x.action === "master_code_recovery" && x.outcome === "success"));
    assert.ok(ev.some((x) => x.action === "master_code_recovery" && x.outcome === "denied" && x.event_details.raison === "pas_un_administrateur_actif"));
    assert.ok(compta);
  });

  test("5 essais incorrects bloquent le code maître ; régénération sous confirmation", async () => {
    const e = await entrepriseActive(env, "MAITRE-02", { mfa: false });
    const a = new Agent(env.app, "10.9.9.8");
    for (let i = 0; i < 5; i++)
      assert.equal((await a.post("/api/auth/recuperation", { codeEntreprise: "MAITRE-02", codeMaitre: genererCodeMaitre(), email: e.email })).statut, 400);
    const bloque = await a.post("/api/auth/recuperation", { codeEntreprise: "MAITRE-02", codeMaitre: e.codeMaitre, email: e.email });
    assert.equal(bloque.statut, 423, "même le bon code est refusé pendant le blocage");
    assert.equal((await e.admin.get("/api/entreprise")).corps.codeMaitre.bloque, true);
    // Régénération : l'ancien code cesse d'être valable, le blocage est levé.
    const nouveau = await e.admin.post("/api/entreprise/code-maitre");
    assert.equal(nouveau.statut, 200);
    assert.notEqual(nouveau.corps.codeMaitre, e.codeMaitre);
    const info = (await e.admin.get("/api/entreprise")).corps;
    assert.equal(info.codeMaitre.actif, true);
    assert.equal(info.codeMaitre.bloque, false);
    assert.equal(JSON.stringify(info).includes("$argon2"), false, "le hachage n'est jamais renvoyé");
  });
});

describe("Comptes inutilisés et rôle Comptable", () => {
  test("Un compte inutilisé depuis plus de 90 jours est désactivé à sa connexion, puis réactivable", async () => {
    const e = await entrepriseActive(env, "INACT-01", { mfa: false });
    const { id } = await utilisateurAvecRole(env, e, "cashier", "caisse@inact-01.cm");
    const vieux = "now() - interval '120 days'";
    await env.superu.query(`UPDATE app_users SET last_login_at = ${vieux}, password_changed_at = ${vieux}, created_at = ${vieux} WHERE id = $1`, [id]);
    const cx = await new Agent(env.app).post("/api/auth/connexion", { codeEntreprise: "INACT-01", email: "caisse@inact-01.cm", motDePasse: MDP });
    assert.equal(cx.statut, 403);
    assert.match(cx.corps.erreur.message, /90 jours/);
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "auto_disable_inactive"));
    assert.equal((await e.admin.post(`/api/utilisateurs/${id}/reactivation`, { motif: "Retour de congé" })).statut, 200);
    assert.equal((await new Agent(env.app).post("/api/auth/connexion", { codeEntreprise: "INACT-01", email: "caisse@inact-01.cm", motDePasse: MDP })).statut, 200);
  });

  test("Le dernier administrateur n'est jamais désactivé automatiquement", async () => {
    const e = await entrepriseActive(env, "INACT-02", { mfa: false });
    await env.superu.query("UPDATE app_users SET last_login_at = now() - interval '400 days', password_changed_at = now() - interval '400 days', created_at = now() - interval '400 days' WHERE email = $1", [e.email]);
    assert.equal((await new Agent(env.app).post("/api/auth/connexion", { codeEntreprise: "INACT-02", email: e.email, motDePasse: MDP })).statut, 200);
  });

  test("Le Comptable n'a accès ni aux banques, ni à la paie, ni aux résultats globaux par défaut", () => {
    const compta = ROLES_SYSTEME.find((r) => r.cle === "accountant")!;
    assert.ok(compta.permissions.every((p) => !/^(treasury|payroll|reports|hr)\./.test(p)));
    assert.ok(compta.permissions.includes("accounting.create"));
  });
});

describe("Secrets absents des journaux", () => {
  test("Ni mot de passe, ni jeton, ni code maître, ni cookie dans le journal d'audit et le journal système", async () => {
    const e = await entrepriseActive(env, "SECRET-01", { mfa: false });
    const { id } = await utilisateurAvecRole(env, e, "accountant", "compta@secret-01.cm");
    const reset = await e.admin.post(`/api/utilisateurs/${id}/reinitialisation-mot-de-passe`, { motif: "Oubli" });
    await new Agent(env.app).post("/api/auth/reinitialisation", { codeEntreprise: "SECRET-01", jeton: reset.corps.reinitialisation.jeton, motDePasse: "Un-Autre-Mot-De-Passe-99" });
    await new Agent(env.app).post("/api/auth/connexion", { codeEntreprise: "SECRET-01", email: "compta@secret-01.cm", motDePasse: "mauvais-mdp-secret-123" });
    await new Agent(env.app).post("/api/auth/recuperation", { codeEntreprise: "SECRET-01", codeMaitre: "GCM-FAUX-CODE-SECRET", email: e.email });
    const secrets = [MDP, "Un-Autre-Mot-De-Passe-99", "mauvais-mdp-secret-123", "GCM-FAUX-CODE-SECRET", e.codeMaitre,
                     e.jetonInvitation, reset.corps.reinitialisation.jeton, e.admin.cookie.split(".")[1]];
    const { rows: [{ audit }] } = await env.superu.query("SELECT string_agg(t::text, ' ') AS audit FROM audit_events t");
    const { rows: [{ systeme }] } = await env.superu.query("SELECT string_agg(t::text, ' ') AS systeme FROM system_events t");
    for (const s of secrets) {
      assert.equal(audit.includes(s), false, `secret trouvé dans audit_events : ${s.slice(0, 6)}…`);
      assert.equal(systeme.includes(s), false, `secret trouvé dans system_events : ${s.slice(0, 6)}…`);
    }
  });
});

describe("Sauvegarde, restauration et copie externe du journal", () => {
  test("Sauvegarde chiffrée puis restauration : données et chaîne d'audit intactes", async () => {
    const e = await entrepriseActive(env, "SAUV-01", { mfa: false });
    const cle = randomBytes(32);
    const s = await sauvegarder({ base: url("gc_backup", env.base), cle, dossier });
    assert.ok(readFileSync(s.fichier).subarray(0, 6).equals(Buffer.from("GCSV1\n")));
    assert.equal(readFileSync(s.fichier).includes(Buffer.from("SAUV-01")), false, "le contenu n'apparaît pas en clair");

    const nom = `${env.base}_r`;
    const admin = new pg.Client({ connectionString: url("postgres", "postgres") });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${nom}`);
      await assert.rejects(restaurer({ fichier: s.fichier, baseCible: url("postgres", nom), cle: randomBytes(32) }), /clé|altéré/);
      await restaurer({ fichier: s.fichier, baseCible: url("postgres", nom), cle });
      const r = new pg.Client({ connectionString: url("postgres", nom) });
      await r.connect();
      const { rows: [c] } = await r.query("SELECT id FROM companies WHERE company_code = 'SAUV-01'");
      assert.equal(c.id, e.entrepriseId);
      const { rowCount } = await r.query("SELECT * FROM audit_verify_chain($1)", [e.entrepriseId]);
      assert.equal(rowCount, 0, "chaîne d'audit intacte après restauration");
      await assert.rejects(r.query("DELETE FROM audit_events"), /ajout seul/, "protections recréées");
      await r.end();
      await assert.rejects(restaurer({ fichier: s.fichier, baseCible: url("postgres", nom), cle }), /pas vide/);
      // Fichier altéré : refusé par l'empreinte, puis par le chiffrement authentifié sans le .sha256.
      const b = readFileSync(s.fichier); b[300] ^= 0xff; writeFileSync(s.fichier, b);
      await admin.query(`DROP DATABASE ${nom}`); await admin.query(`CREATE DATABASE ${nom}`);
      await assert.rejects(restaurer({ fichier: s.fichier, baseCible: url("postgres", nom), cle }), /SHA-256/);
      rmSync(`${s.fichier}.sha256`);
      await assert.rejects(restaurer({ fichier: s.fichier, baseCible: url("postgres", nom), cle }), /altéré/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
      await admin.end();
    }
  });

  test("Copie du journal sur un support distinct, et détection d'un écart avec la copie", async () => {
    const e = await entrepriseActive(env, "COPIE-01", { mfa: false });
    const o = { fichierAncrages: join(dossier, "ancrages.tsv"), dossierCopie: join(dossier, "copie") };
    const r1 = (await controlerJournaux(env.proprio, o)).find((x) => x.code === "COPIE-01")!;
    assert.equal(r1.valide, true);
    assert.equal(r1.copies, r1.total);
    const lignes = readFileSync(join(o.dossierCopie, "COPIE-01.jsonl"), "utf8").trim().split("\n");
    assert.equal(lignes.length, r1.total);
    assert.equal((await controlerJournaux(env.proprio, o)).find((x) => x.code === "COPIE-01")!.copies, 0, "copie incrémentale");
    await e.admin.get("/api/audit/integrite");   // nouvel événement
    assert.equal((await controlerJournaux(env.proprio, o)).find((x) => x.code === "COPIE-01")!.copies, 1);
    // Réécriture du dernier événement en base par un superutilisateur.
    await env.superu.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only");
    await env.superu.query("UPDATE audit_events SET reason = 'retouché' WHERE company_id = $1 AND sequence_no = (SELECT max(sequence_no) FROM audit_events WHERE company_id = $1)", [e.entrepriseId]);
    await env.superu.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only");
    const r4 = (await controlerJournaux(env.proprio, o)).find((x) => x.code === "COPIE-01")!;
    assert.equal(r4.valide, false);
    assert.ok(r4.anomalies.some((a) => a.probleme.includes("contenu modifié")));
  });
});
