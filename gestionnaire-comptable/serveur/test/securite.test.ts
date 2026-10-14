import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Agent, MDP, entrepriseActive, journal, preparer, totp, utilisateurAvecRole, type Env } from "./aide.js";
import { verifierTotp, genererSecretTotp, codeHotp, base32Decoder, pasCourant } from "../src/securite/totp.js";
import { politiqueMotDePasse } from "../src/securite/motdepasse.js";

let env: Env;
before(async () => { env = await preparer(); });
after(async () => { await env?.fermer(); });

describe("Outils de sécurité", () => {
  test("TOTP : vecteur de la RFC 6238 et refus du rejeu", () => {
    // RFC 6238, annexe B : secret ASCII « 12345678901234567890 », T = 59 s → 94287082 (8 chiffres) → 287082 sur 6.
    assert.equal(codeHotp(Buffer.from("12345678901234567890"), 1), "287082");
    const s = genererSecretTotp();
    const code = codeHotp(base32Decoder(s), pasCourant());
    const pas = verifierTotp(s, code, 0);
    assert.ok(pas);
    assert.equal(verifierTotp(s, code, pas!), null, "un code déjà utilisé est refusé");
  });

  test("Politique de mot de passe", () => {
    assert.ok(politiqueMotDePasse("court"));
    assert.ok(politiqueMotDePasse("paul.ngaro-2026-x", "paul.ngaro@x.cm"));
    assert.equal(politiqueMotDePasse(MDP, "admin@x.cm", "Admin Principal"), null);
  });
});

describe("Base de données", () => {
  test("Le compte applicatif ne peut ni modifier ni supprimer le journal", async () => {
    const e = await entrepriseActive(env, "BASE-01", { mfa: false });
    const c = await env.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
      await assert.rejects(c.query("UPDATE audit_events SET action = 'x'"), /permission denied/);
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.company_id', $1, true)", [e.entrepriseId]);
      await assert.rejects(c.query("DELETE FROM audit_events"), /permission denied/);
      await c.query("ROLLBACK");
    } finally { c.release(); }
    // Même le propriétaire des tables est bloqué par le déclencheur « ajout seul ».
    await assert.rejects(env.proprio.query("DELETE FROM audit_events"), /ajout seul/);
  });

  test("Sans contexte d'entreprise, le compte applicatif ne voit aucune donnée", async () => {
    const { rows } = await env.pool.query("SELECT count(*)::int AS n FROM app_users");
    assert.equal(rows[0].n, 0);
  });
});

describe("Authentification et double authentification", () => {
  test("Un administrateur doit activer la MFA avant d'administrer", async () => {
    const e = await entrepriseActive(env, "MFA-01");
    const moi = await e.admin.get("/api/auth/moi");
    assert.equal(moi.statut, 200);
    assert.equal(moi.corps.mfa.requise, true);
    assert.equal((await e.admin.get("/api/utilisateurs")).corps.erreur.code, "mfa_a_configurer");

    const init = await e.admin.post("/api/auth/mfa/initialisation");
    assert.match(init.corps.uri, /^otpauth:\/\/totp\//);
    assert.equal((await e.admin.post("/api/auth/mfa/activation", { code: "000000" })).statut, 400);
    assert.equal((await e.admin.post("/api/auth/mfa/activation", { code: totp(init.corps.secret) })).statut, 200);
    assert.equal((await e.admin.get("/api/utilisateurs")).statut, 200);

    await e.admin.post("/api/auth/deconnexion");
    assert.equal((await e.admin.get("/api/auth/moi")).statut, 401);

    const ident = { codeEntreprise: "MFA-01", email: e.email, motDePasse: MDP };
    assert.equal((await e.admin.post("/api/auth/connexion", ident)).corps.erreur.code, "mfa_requis");
    const code = totp(init.corps.secret, 1);
    assert.equal((await e.admin.post("/api/auth/connexion", { ...ident, codeMfa: code })).statut, 200);
    const autre = new Agent(env.app);
    assert.equal((await autre.post("/api/auth/connexion", { ...ident, codeMfa: code })).corps.erreur.code, "mfa_invalide", "rejeu refusé");
  });

  test("Message identique pour un compte inconnu et un mauvais mot de passe", async () => {
    const e = await entrepriseActive(env, "AUTH-01", { mfa: false });
    const a = new Agent(env.app);
    const inconnu = await a.post("/api/auth/connexion", { codeEntreprise: "AUTH-01", email: "personne@auth-01.cm", motDePasse: MDP });
    const faux = await a.post("/api/auth/connexion", { codeEntreprise: "AUTH-01", email: e.email, motDePasse: "mauvais-mot-de-passe" });
    const entreprise = await a.post("/api/auth/connexion", { codeEntreprise: "N-EXISTE-PAS", email: e.email, motDePasse: MDP });
    assert.equal(inconnu.statut, 401); assert.equal(faux.statut, 401); assert.equal(entreprise.statut, 401);
    assert.equal(inconnu.corps.erreur.message, faux.corps.erreur.message);
    assert.equal(entreprise.corps.erreur.message, faux.corps.erreur.message);
    const { rows } = await env.superu.query("SELECT details FROM system_events WHERE event_type = 'auth.unknown_company'");
    assert.ok(rows.some((r) => r.details.code === "N-EXISTE-PAS"), "code inconnu tracé dans le journal système");
  });

  test("Verrouillage après 5 échecs, avec trace et notification", async () => {
    const e = await entrepriseActive(env, "LOCK-01", { mfa: false });
    const { agent: caissier } = await utilisateurAvecRole(env, e, "cashier", "caisse@lock-01.cm");
    for (let i = 0; i < 5; i++)
      await new Agent(env.app).post("/api/auth/connexion", { codeEntreprise: "LOCK-01", email: "caisse@lock-01.cm", motDePasse: "pas-le-bon-mdp" });
    const r = await new Agent(env.app).post("/api/auth/connexion", { codeEntreprise: "LOCK-01", email: "caisse@lock-01.cm", motDePasse: MDP });
    assert.equal(r.statut, 423, "le bon mot de passe est refusé pendant le verrouillage");
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.some((x) => x.action === "account_locked"));
    assert.equal(ev.filter((x) => x.action === "login" && x.outcome === "failure").length, 5);
    const notifs = await e.admin.get("/api/notifications");
    assert.ok(notifs.corps.elements.some((n: { titre: string }) => n.titre === "Compte verrouillé"));
    assert.equal((await caissier.get("/api/notifications")).corps.elements.length, 0, "le caissier ne voit pas les alertes d'administration");
  });

  test("Réinitialisation du mot de passe par code à usage unique", async () => {
    const e = await entrepriseActive(env, "RESET-01", { mfa: false });
    const { agent, id } = await utilisateurAvecRole(env, e, "accountant", "compta@reset-01.cm");
    const r = await e.admin.post(`/api/utilisateurs/${id}/reinitialisation-mot-de-passe`, { motif: "Mot de passe oublié" });
    assert.equal(r.statut, 200);
    const nouveau = "Nouveau-Mot-De-Passe-2026";
    const corps = { codeEntreprise: "RESET-01", jeton: r.corps.reinitialisation.jeton, motDePasse: nouveau };
    assert.equal((await new Agent(env.app).post("/api/auth/reinitialisation", corps)).statut, 200);
    assert.equal((await new Agent(env.app).post("/api/auth/reinitialisation", corps)).statut, 400, "jeton à usage unique");
    assert.equal((await agent.get("/api/auth/moi")).statut, 401, "les sessions existantes sont fermées");
    assert.equal((await new Agent(env.app).post("/api/auth/connexion", { codeEntreprise: "RESET-01", email: "compta@reset-01.cm", motDePasse: nouveau })).statut, 200);
  });

  test("Connexion depuis un poste inhabituel signalée", async () => {
    const e = await entrepriseActive(env, "IP-01", { mfa: false });
    await utilisateurAvecRole(env, e, "accountant", "compta@ip-01.cm", "10.0.0.5");
    const ailleurs = new Agent(env.app, "192.168.50.77");
    await ailleurs.post("/api/auth/connexion", { codeEntreprise: "IP-01", email: "compta@ip-01.cm", motDePasse: MDP });
    const ev = await journal(env, e.entrepriseId);
    const inhabituel = ev.find((x) => x.action === "unusual_login");
    assert.ok(inhabituel);
    assert.equal(inhabituel.ip_address, "192.168.50.77");
  });

  test("Une requête qui modifie sans l'en-tête X-GC-Requete est refusée", async () => {
    const r = await env.app.inject({ method: "POST", url: "/api/auth/connexion", payload: {} });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().erreur.code, "en_tete_manquant");
  });
});

describe("Isolation entre entreprises", () => {
  test("Un cookie détourné vers une autre entreprise ne donne aucun accès", async () => {
    const a = await entrepriseActive(env, "ISO-A", { mfa: false });
    const b = await entrepriseActive(env, "ISO-B", { mfa: false });
    const usersB = (await b.admin.get("/api/utilisateurs")).corps.elements;
    // A demande un utilisateur de B par son identifiant : introuvable (RLS).
    assert.equal((await a.admin.get(`/api/utilisateurs/${usersB[0].id}`)).statut, 404);
    // A remplace l'identifiant d'entreprise de son cookie par celui de B : session inconnue.
    const pirate = new Agent(env.app);
    pirate.cookie = a.admin.cookie.replace(a.entrepriseId, b.entrepriseId);
    assert.equal((await pirate.get("/api/utilisateurs")).statut, 401);
    // Les listes ne mélangent jamais les entreprises.
    const usersA = (await a.admin.get("/api/utilisateurs")).corps.elements;
    assert.ok(usersA.every((u: { email: string }) => u.email.endsWith("@iso-a.cm")));
  });
});

describe("Permissions et utilisateurs", () => {
  test("Un caissier ne peut pas consulter les utilisateurs ; le refus est journalisé", async () => {
    const e = await entrepriseActive(env, "PERM-01", { mfa: false });
    const { agent, id } = await utilisateurAvecRole(env, e, "cashier", "caisse@perm-01.cm");
    const r = await agent.get("/api/utilisateurs");
    assert.equal(r.statut, 403);
    const ev = await journal(env, e.entrepriseId);
    const refus = ev.find((x) => x.action === "access_denied");
    assert.equal(refus.actor_user_id, id);
    assert.equal(refus.outcome, "denied");
    assert.equal(refus.event_details.permission, "users.read");
    const moi = await agent.get("/api/auth/moi");
    assert.deepEqual(moi.corps.permissions, ["cash.create", "cash.print", "cash.read", "cash.submit"]);
  });

  test("La désactivation ferme immédiatement les sessions", async () => {
    const e = await entrepriseActive(env, "DESAC-01", { mfa: false });
    const { agent, id } = await utilisateurAvecRole(env, e, "accountant", "compta@desac-01.cm");
    assert.equal((await agent.get("/api/auth/moi")).statut, 200);
    assert.equal((await e.admin.post(`/api/utilisateurs/${id}/desactivation`, {})).statut, 400, "motif obligatoire");
    assert.equal((await e.admin.post(`/api/utilisateurs/${id}/desactivation`, { motif: "Départ de l'entreprise" })).statut, 200);
    assert.equal((await agent.get("/api/auth/moi")).statut, 401);
    const ev = await journal(env, e.entrepriseId);
    const d = ev.find((x) => x.action === "disable");
    assert.equal(d.reason, "Départ de l'entreprise");
    assert.deepEqual(d.previous_value, { statut: "active" });
    assert.deepEqual(d.new_value, { statut: "disabled" });
  });

  test("Un administrateur ne peut ni se désactiver ni changer ses propres rôles ; le dernier administrateur est protégé", async () => {
    const e = await entrepriseActive(env, "SELF-01", { mfa: false });
    const moi = (await e.admin.get("/api/auth/moi")).corps;
    assert.equal((await e.admin.post(`/api/utilisateurs/${moi.utilisateur.id}/desactivation`, { motif: "essai" })).corps.erreur.code, "action_sur_soi_interdite");
    assert.equal((await e.admin.put(`/api/utilisateurs/${moi.utilisateur.id}/roles`, { roles: [], motif: "essai" })).statut, 403);
    // Avec un second administrateur, le premier peut être désactivé…
    const { agent: admin2, id: id2 } = await utilisateurAvecRole(env, e, "company_admin", "admin2@self-01.cm");
    assert.equal((await admin2.post(`/api/utilisateurs/${moi.utilisateur.id}/desactivation`, { motif: "Test" })).statut, 200);
    // …mais admin2, désormais seul administrateur actif, ne peut pas retirer ses propres droits.
    assert.equal((await admin2.put(`/api/utilisateurs/${id2}/roles`, { roles: [], motif: "Essai de retrait" })).statut, 403);
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.filter((x) => x.action === "self_change_denied").length >= 2);
  });

  test("Rôle personnalisé : création, attribution, et interdiction de modifier un rôle que l'on détient", async () => {
    const e = await entrepriseActive(env, "ROLE-01", { mfa: false });
    const cat = await e.admin.get("/api/permissions/catalogue");
    assert.equal(cat.corps.modules.length, 14);
    assert.equal(cat.corps.actions.length, 10);
    const r = await e.admin.post("/api/roles", { cle: "caissier_chef", libelle: "Caissier principal", permissions: ["cash.read", "cash.approve"] });
    assert.equal(r.statut, 200);
    assert.deepEqual(r.corps.permissions, ["cash.approve", "cash.read"]);
    assert.equal((await e.admin.post("/api/roles", { cle: "pirate", libelle: "Pirate", permissions: ["audit.delete"] })).statut, 400);
    const systeme = ((await e.admin.get("/api/roles")).corps as { cle: string; id: string }[]).find((x) => x.cle === "company_admin")!;
    assert.equal((await e.admin.put(`/api/roles/${systeme.id}/permissions`, { permissions: [], motif: "essai" })).corps.erreur.code, "role_systeme");
    const { agent: admin2, id: id2 } = await utilisateurAvecRole(env, e, "company_admin", "admin2@role-01.cm");
    const roles = (await e.admin.get("/api/roles")).corps as { cle: string; id: string }[];
    await e.admin.put(`/api/utilisateurs/${id2}/roles`, { roles: [systeme.id, r.corps.id], motif: "Supplément de caisse" });
    assert.equal((await admin2.put(`/api/roles/${r.corps.id}/permissions`, { permissions: ["cash.read", "cash.approve", "treasury.approve"], motif: "auto" })).corps.erreur.code, "auto_attribution_interdite");
    assert.equal((await e.admin.put(`/api/roles/${r.corps.id}/permissions`, { permissions: ["cash.read"], motif: "Réduction des droits" })).statut, 200);
    const ev = await journal(env, e.entrepriseId);
    const ch = ev.find((x) => x.action === "permissions_change");
    assert.deepEqual(ch.event_details.retirees, ["cash.approve"]);
    assert.ok(roles.length >= 11);
  });

  test("Pagination et recherche des utilisateurs", async () => {
    const e = await entrepriseActive(env, "PAGE-01", { mfa: false });
    for (let i = 0; i < 7; i++) await e.admin.post("/api/utilisateurs", { nom: `Employé Numéro ${i}`, email: `e${i}@page-01.cm` });
    const p1 = await e.admin.get("/api/utilisateurs?taille=3&page=1&tri=email");
    assert.equal(p1.corps.total, 8);
    assert.equal(p1.corps.elements.length, 3);
    const p3 = await e.admin.get("/api/utilisateurs?taille=3&page=3&tri=email");
    assert.equal(p3.corps.elements.length, 2);
    const rech = await e.admin.get("/api/utilisateurs?recherche=num%C3%A9ro%204");
    assert.equal(rech.corps.total, 1);
    assert.equal((await e.admin.get("/api/utilisateurs?statut=invited")).corps.total, 7);
  });
});

describe("Journal d'audit", () => {
  test("Chaîne intacte, puis falsification détectée", async () => {
    const e = await entrepriseActive(env, "AUDIT-01", { mfa: false });
    const ok = await e.admin.get("/api/audit/integrite");
    assert.equal(ok.corps.valide, true);
    assert.ok(ok.corps.total >= 4);
    // Falsification par un superutilisateur qui contourne les protections.
    await env.superu.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only");
    await env.superu.query("UPDATE audit_events SET reason = 'modifié en douce' WHERE company_id = $1 AND sequence_no = 2", [e.entrepriseId]);
    await env.superu.query("DELETE FROM audit_events WHERE company_id = $1 AND sequence_no = 3", [e.entrepriseId]);
    await env.superu.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only");
    const ko = await e.admin.get("/api/audit/integrite");
    assert.equal(ko.corps.valide, false);
    const problemes = ko.corps.anomalies.map((a: { sequence: number; probleme: string }) => `${a.sequence}:${a.probleme}`);
    assert.ok(problemes.includes("2:contenu modifié après enregistrement"));
    assert.ok(problemes.some((p: string) => p.startsWith("4:événements 3 à 3 absents")));
  });

  test("Toute tentative de modification du journal par l'API est refusée et tracée", async () => {
    const e = await entrepriseActive(env, "AUDIT-02", { mfa: false });
    const r = await e.admin.del("/api/audit/1");
    assert.equal(r.statut, 403);
    assert.equal(r.corps.erreur.code, "journal_non_modifiable");
    const ev = await journal(env, e.entrepriseId);
    const t = ev.find((x) => x.action === "audit_tamper_attempt");
    assert.equal(t.outcome, "denied");
    assert.equal(t.event_details.methode, "DELETE");
  });

  test("Horodatage serveur, séquence, filtres et export CSV journalisé", async () => {
    const e = await entrepriseActive(env, "AUDIT-03", { mfa: false });
    const liste = await e.admin.get("/api/audit?type=auth&taille=50");
    assert.ok(liste.corps.elements.length >= 2);
    assert.ok(liste.corps.elements.every((x: { type: string }) => x.type === "auth"));
    const seqs = (await e.admin.get("/api/audit?taille=100")).corps.elements.map((x: { sequence: number }) => x.sequence);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a));
    const exp = await e.admin.get("/api/audit/export");
    assert.equal(exp.statut, 200);
    assert.match(String(exp.brut.headers["content-type"]), /text\/csv/);
    assert.ok(String(exp.corps).startsWith("﻿\"Séquence\";"));
    const ev = await journal(env, e.entrepriseId);
    assert.equal(ev.at(-1).action, "export");
    // Un caissier n'a pas le droit d'exporter le journal.
    const { agent } = await utilisateurAvecRole(env, e, "cashier", "c@audit-03.cm");
    assert.equal((await agent.get("/api/audit/export")).statut, 403);
  });
});
