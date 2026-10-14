import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { transaction, UUID, type Client } from "../../db.js";
import { journaliser, journaliserSysteme, notifier } from "../../domaine/audit.js";
import { creerSession, revoquerSessions, chargerPermissions } from "../../domaine/sessions.js";
import { hacherMotDePasse, politiqueMotDePasse, verifierMotDePasse } from "../../securite/motdepasse.js";
import { empreinteJeton, genererJeton } from "../../securite/jetons.js";
import { genererSecretTotp, uriOtpauth, verifierTotp } from "../../securite/totp.js";
import { chiffrer, dechiffrer } from "../../securite/chiffrement.js";
import { Limiteur } from "../../securite/limiteur.js";
import { normaliserCodeMaitre } from "../../securite/code-maitre.js";
import { COOKIE_SESSION, proteger, type Dependances } from "../contexte.js";
import { ErreurHttp } from "../erreurs.js";

const IDENTIFIANTS_INVALIDES = "Code entreprise, adresse e-mail ou mot de passe incorrect.";

const schemaConnexion = z.object({
  codeEntreprise: z.string().trim().min(1).max(32),
  email: z.string().trim().toLowerCase().email().max(254),
  motDePasse: z.string().min(1).max(256),
  codeMfa: z.string().trim().regex(/^\d{6}$/).optional(),
});

const schemaJeton = z.object({
  codeEntreprise: z.string().trim().min(1).max(32),
  jeton: z.string().min(20).max(200),
  motDePasse: z.string().min(1).max(256),
});

export function routesAuth(app: FastifyInstance, deps: Dependances) {
  const { pool, cfg } = deps;
  const limiteur = new Limiteur(cfg.tentativesParIpParFenetre, cfg.fenetreTentativesMinutes * 60_000);

  const poserCookie = (rep: FastifyReply, entrepriseId: string, jeton: string) =>
    rep.setCookie(COOKIE_SESSION, `${entrepriseId}.${jeton}`, {
      httpOnly: true, sameSite: "strict", secure: cfg.cookieSecurise, path: "/", maxAge: cfg.sessionDureeMaxHeures * 3600,
    });

  const limiter = (ip: string) => {
    if (!limiteur.autoriser(ip))
      throw new ErreurHttp(429, "trop_de_tentatives", "Trop de tentatives depuis ce poste. Patientez quelques minutes avant de réessayer.");
  };

  /** Résout le code entreprise ; un code inconnu est tracé dans le journal système. */
  async function entrepriseParCode(code: string, ip: string, contexte: string) {
    const { rows: [r] } = await pool.query("SELECT company_id_by_code($1) AS id", [code]);
    if (!r.id) await journaliserSysteme(pool, "auth.unknown_company", "failure", { code: code.slice(0, 32), contexte }, ip);
    return r.id as string | null;
  }

  // ---------------------------------------------------------------- Connexion
  app.post("/api/auth/connexion", async (req, rep) => {
    const ip = req.ip;
    limiter(ip);
    const d = schemaConnexion.parse(req.body);
    const entrepriseId = await entrepriseParCode(d.codeEntreprise, ip, "connexion");
    if (!entrepriseId) {
      await verifierMotDePasse(null, d.motDePasse);
      throw new ErreurHttp(401, "identifiants_invalides", IDENTIFIANTS_INVALIDES);
    }

    const sortie = await transaction(pool, entrepriseId, async (c) => {
      const echec = async (action: string, details: Record<string, unknown>, acteurId: string | null = null, resultat: "failure" | "denied" = "failure") =>
        journaliser(c, { type: "auth", action, resultat, acteurId, ip, details: { email: d.email, ...details } });

      const { rows: [u] } = await c.query(
        `SELECT id, email, full_name, password_hash, status, failed_login_count, mfa_enabled, mfa_secret_enc, mfa_last_step,
                locked_until IS NOT NULL AND locked_until > now() AS verrouille,
                access_expires_at IS NOT NULL AND access_expires_at < now() AS acces_expire,
                greatest(last_login_at, reactivated_at, password_changed_at, created_at) AS derniere_activite,
                (SELECT coalesce((settings->>'inactiviteJours')::int, 90) FROM companies WHERE id = company_id) AS inactivite_jours
           FROM app_users WHERE lower(email) = $1 FOR UPDATE`, [d.email]);

      if (!u) {
        await verifierMotDePasse(null, d.motDePasse);
        await echec("login", { raison: "compte_inconnu" });
        return { erreur: new ErreurHttp(401, "identifiants_invalides", IDENTIFIANTS_INVALIDES) };
      }
      if (u.verrouille) {
        await echec("login", { raison: "compte_verrouille" }, u.id, "denied");
        return { erreur: new ErreurHttp(423, "compte_verrouille", "Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard ou contactez votre administrateur.") };
      }

      const enregistrerEchec = async (raison: string) => {
        const n = u.failed_login_count + 1;
        if (n >= cfg.echecsAvantVerrouillage) {
          await c.query("UPDATE app_users SET failed_login_count = 0, locked_until = now() + make_interval(mins => $2) WHERE id = $1", [u.id, cfg.verrouillageMinutes]);
          await echec("login", { raison }, u.id);
          await journaliser(c, { type: "security", action: "account_locked", resultat: "success", objetType: "user", objetId: u.id, ip, details: { echecs: n, minutes: cfg.verrouillageMinutes } });
          await notifier(c, { permission: "users.admin", type: "security", titre: "Compte verrouillé", corps: `${u.full_name} (${u.email}) : ${n} échecs de connexion consécutifs. Compte bloqué ${cfg.verrouillageMinutes} minutes.` });
        } else {
          await c.query("UPDATE app_users SET failed_login_count = $2 WHERE id = $1", [u.id, n]);
          await echec("login", { raison }, u.id);
        }
      };

      if (!(await verifierMotDePasse(u.password_hash, d.motDePasse))) {
        await enregistrerEchec("mot_de_passe");
        return { erreur: new ErreurHttp(401, "identifiants_invalides", IDENTIFIANTS_INVALIDES) };
      }
      // Compte inutilisé depuis trop longtemps : désactivé automatiquement (sauf s'il est le dernier administrateur).
      if (u.status === "active" && u.inactivite_jours > 0 &&
          Date.now() - new Date(u.derniere_activite).getTime() > u.inactivite_jours * 86_400_000 &&
          !(await estDernierAdmin(c, u.id))) {
        await c.query("UPDATE app_users SET status = 'disabled' WHERE id = $1", [u.id]);
        await revoquerSessions(c, u.id, "compte_inutilise");
        await journaliser(c, { type: "users", action: "auto_disable_inactive", objetType: "user", objetId: u.id, ip,
          avant: { statut: "active" }, apres: { statut: "disabled" }, details: { joursSansActivite: u.inactivite_jours } });
        await notifier(c, { permission: "users.admin", type: "warning", titre: "Compte inutilisé désactivé",
          corps: `${u.full_name} n'avait pas utilisé son compte depuis plus de ${u.inactivite_jours} jours. Réactivez-le si nécessaire.` });
        return { erreur: new ErreurHttp(403, "compte_inactif", `Compte désactivé après ${u.inactivite_jours} jours sans utilisation. Contactez votre administrateur.`) };
      }
      if (u.status !== "active" || u.acces_expire) {
        await echec("login", { raison: u.acces_expire ? "acces_expire" : `statut_${u.status}` }, u.id, "denied");
        return { erreur: new ErreurHttp(403, "compte_inactif", u.acces_expire ? "Votre accès a expiré. Contactez votre administrateur." : "Ce compte n'est pas actif. Contactez votre administrateur.") };
      }
      if (u.mfa_enabled) {
        if (!d.codeMfa) return { erreur: new ErreurHttp(401, "mfa_requis", "Saisissez le code à 6 chiffres de votre application d'authentification.") };
        const pas = verifierTotp(dechiffrer(cfg.cleChiffrement, u.mfa_secret_enc), d.codeMfa, Number(u.mfa_last_step));
        if (pas === null) {
          await enregistrerEchec("code_mfa");
          return { erreur: new ErreurHttp(401, "mfa_invalide", "Code de vérification incorrect ou déjà utilisé.") };
        }
        await c.query("UPDATE app_users SET mfa_last_step = $2 WHERE id = $1", [u.id, pas]);
      }

      // Connexion réussie. Détection simple d'un comportement inhabituel : poste jamais vu en 90 jours.
      const { rows: [hist] } = await c.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE ip_address = $2)::int AS meme_ip
           FROM audit_events
          WHERE actor_user_id = $1 AND event_type = 'auth' AND action = 'login' AND outcome = 'success'
            AND occurred_at > now() - interval '90 days'`, [u.id, ip]);
      await c.query("UPDATE app_users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [u.id]);
      const s = await creerSession(c, cfg, u.id, ip, req.headers["user-agent"] ?? null);
      await journaliser(c, { type: "auth", action: "login", acteurId: u.id, sessionId: s.sessionId, ip, details: { mfa: u.mfa_enabled } });
      if (hist.total > 0 && hist.meme_ip === 0) {
        await journaliser(c, { type: "security", action: "unusual_login", acteurId: u.id, sessionId: s.sessionId, ip, details: { raison: "nouveau_poste" } });
        await notifier(c, { permission: "users.admin", type: "security", titre: "Connexion depuis un nouveau poste", corps: `${u.full_name} s'est connecté depuis ${ip}, adresse inhabituelle sur les 90 derniers jours.` });
        await notifier(c, { destinataireId: u.id, type: "security", titre: "Connexion depuis un nouveau poste", corps: `Connexion depuis ${ip}. Si ce n'était pas vous, changez votre mot de passe et prévenez votre administrateur.` });
      }
      const { mfaRequis } = await chargerPermissions(c, u.id);
      return { valeur: { jeton: s.jeton, utilisateur: { id: u.id, email: u.email, nom: u.full_name }, mfaAConfigurer: mfaRequis && !u.mfa_enabled } };
    });
    if ("erreur" in sortie) throw sortie.erreur;
    poserCookie(rep, entrepriseId, sortie.valeur.jeton);
    return { utilisateur: sortie.valeur.utilisateur, mfaAConfigurer: sortie.valeur.mfaAConfigurer };
  });

  // ---------------------------------------------------------------- Déconnexion
  app.post("/api/auth/deconnexion", proteger(deps, { permission: null, avantMfa: true }, async (_req, ctx) => {
    await ctx.c.query("UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'deconnexion' WHERE id = $1", [ctx.sessionId]);
    await ctx.journaliser({ type: "auth", action: "logout" });
    ctx.rep.clearCookie(COOKIE_SESSION, { path: "/" });
    return { ok: true };
  }));

  // ---------------------------------------------------------------- Profil courant
  app.get("/api/auth/moi", proteger(deps, { permission: null, avantMfa: true }, async (_req, ctx) => {
    const { rows: [e] } = await ctx.c.query("SELECT id, company_code, legal_name, country_code, currency_code FROM companies WHERE id = $1", [ctx.entrepriseId]);
    const { rows: roles } = await ctx.c.query(
      "SELECT r.id, r.role_key, r.display_name FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.archived_at IS NULL WHERE ur.user_id = $1 ORDER BY r.display_name",
      [ctx.utilisateur.id]);
    const { rows: [mfa] } = await ctx.c.query("SELECT bool_or(r.mfa_required) AS requis FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1", [ctx.utilisateur.id]);
    return {
      utilisateur: ctx.utilisateur,
      entreprise: { id: e.id, code: e.company_code, raisonSociale: e.legal_name, pays: e.country_code, devise: e.currency_code },
      roles: roles.map((r) => ({ id: r.id, cle: r.role_key, libelle: r.display_name })),
      permissions: [...ctx.permissions].sort(),
      mfa: { active: ctx.utilisateur.mfaActive, requise: !!mfa?.requis },
      session: { id: ctx.sessionId, inactiviteMinutes: cfg.sessionInactiviteMinutes },
    };
  }));

  // ---------------------------------------------------------------- Changement de mot de passe
  app.post("/api/auth/mot-de-passe", proteger(deps, { permission: null, avantMfa: true }, async (req, ctx) => {
    const d = z.object({ ancien: z.string().min(1).max(256), nouveau: z.string().min(1).max(256) }).parse(req.body);
    const { rows: [u] } = await ctx.c.query("SELECT password_hash, email, full_name FROM app_users WHERE id = $1 FOR UPDATE", [ctx.utilisateur.id]);
    if (!(await verifierMotDePasse(u.password_hash, d.ancien)))
      throw new ErreurHttp(400, "mot_de_passe_incorrect", "Le mot de passe actuel est incorrect.",
        { type: "auth", action: "password_change", resultat: "failure", objetType: "user", objetId: ctx.utilisateur.id });
    const erreur = politiqueMotDePasse(d.nouveau, u.email, u.full_name);
    if (erreur) throw new ErreurHttp(400, "mot_de_passe_faible", erreur);
    if (d.nouveau === d.ancien) throw new ErreurHttp(400, "mot_de_passe_identique", "Choisissez un mot de passe différent de l'actuel.");
    await ctx.c.query("UPDATE app_users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [ctx.utilisateur.id, await hacherMotDePasse(d.nouveau)]);
    const n = await revoquerSessions(ctx.c, ctx.utilisateur.id, "changement_mot_de_passe", ctx.sessionId);
    await ctx.journaliser({ type: "auth", action: "password_change", objetType: "user", objetId: ctx.utilisateur.id, details: { autresSessionsFermees: n } });
    return { ok: true, autresSessionsFermees: n };
  }));

  // ---------------------------------------------------------------- Jetons à usage unique (invitation, réinitialisation)
  async function utiliserJeton(objet: "invitation" | "password_reset", body: unknown, ip: string) {
    limiter(ip);
    const d = schemaJeton.parse(body);
    const entrepriseId = await entrepriseParCode(d.codeEntreprise, ip, objet);
    const invalide = new ErreurHttp(400, "jeton_invalide", "Ce lien n'est pas valide ou a expiré. Demandez-en un nouveau à votre administrateur.");
    if (!entrepriseId) throw invalide;
    const sortie = await transaction(pool, entrepriseId, async (c) => {
      const { rows: [t] } = await c.query(
        `SELECT t.id, t.user_id, u.email, u.full_name, u.status
           FROM user_tokens t JOIN app_users u ON u.id = t.user_id
          WHERE t.token_hash = $1 AND t.purpose = $2 AND t.used_at IS NULL AND t.expires_at > now()
          FOR UPDATE OF t`, [empreinteJeton(d.jeton), objet]);
      if (!t) {
        await journaliser(c, { type: "auth", action: objet === "invitation" ? "invitation_accept" : "password_reset", resultat: "failure", ip, details: { raison: "jeton_invalide" } });
        return { erreur: invalide };
      }
      if (objet === "password_reset" && t.status !== "active") return { erreur: invalide };
      if (objet === "invitation" && t.status !== "invited") return { erreur: invalide };
      const faible = politiqueMotDePasse(d.motDePasse, t.email, t.full_name);
      if (faible) return { erreur: new ErreurHttp(400, "mot_de_passe_faible", faible) };
      await c.query("UPDATE user_tokens SET used_at = now() WHERE id = $1", [t.id]);
      await c.query(
        `UPDATE app_users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL,
                              status = CASE WHEN status = 'invited' THEN 'active' ELSE status END
          WHERE id = $1`, [t.user_id, await hacherMotDePasse(d.motDePasse)]);
      const n = await revoquerSessions(c, t.user_id, objet === "invitation" ? "activation" : "reinitialisation_mot_de_passe");
      await journaliser(c, {
        type: "auth", action: objet === "invitation" ? "invitation_accept" : "password_reset",
        acteurId: t.user_id, objetType: "user", objetId: t.user_id, ip, details: { sessionsFermees: n },
      });
      return { valeur: { ok: true } };
    });
    if ("erreur" in sortie) throw sortie.erreur;
    return sortie.valeur;
  }

  app.post("/api/auth/invitation/acceptation", (req) => utiliserJeton("invitation", req.body, req.ip));
  app.post("/api/auth/reinitialisation", (req) => utiliserJeton("password_reset", req.body, req.ip));

  // ---------------------------------------------------------------- Double authentification (TOTP)
  app.post("/api/auth/mfa/initialisation", proteger(deps, { permission: null, avantMfa: true }, async (_req, ctx) => {
    if (ctx.utilisateur.mfaActive) throw new ErreurHttp(409, "mfa_deja_active", "La double authentification est déjà active.");
    const secret = genererSecretTotp();
    await ctx.c.query("UPDATE app_users SET mfa_pending_secret_enc = $2 WHERE id = $1", [ctx.utilisateur.id, chiffrer(cfg.cleChiffrement, secret)]);
    return { secret, uri: uriOtpauth(secret, ctx.utilisateur.email) };
  }));

  app.post("/api/auth/mfa/activation", proteger(deps, { permission: null, avantMfa: true }, async (req, ctx) => {
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).parse(req.body);
    const { rows: [u] } = await ctx.c.query("SELECT mfa_pending_secret_enc, mfa_last_step FROM app_users WHERE id = $1 FOR UPDATE", [ctx.utilisateur.id]);
    if (!u.mfa_pending_secret_enc) throw new ErreurHttp(409, "mfa_non_initialisee", "Commencez par générer un secret de double authentification.");
    const pas = verifierTotp(dechiffrer(cfg.cleChiffrement, u.mfa_pending_secret_enc), code, Number(u.mfa_last_step));
    if (pas === null) throw new ErreurHttp(400, "mfa_invalide", "Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.");
    await ctx.c.query(
      "UPDATE app_users SET mfa_enabled = true, mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_last_step = $2 WHERE id = $1",
      [ctx.utilisateur.id, pas]);
    await ctx.journaliser({ type: "security", action: "mfa_enable", objetType: "user", objetId: ctx.utilisateur.id });
    return { ok: true };
  }));

  // ---------------------------------------------------------------- Confirmation avant opération sensible
  // Mot de passe (et code MFA s'il est activé) ressaisis : valable quelques minutes pour cette session.
  // Les échecs comptent pour le verrouillage du compte, comme à la connexion.
  app.post("/api/auth/confirmation", proteger(deps, { permission: null, avantMfa: true }, async (req, ctx) => {
    const d = z.object({ motDePasse: z.string().min(1).max(256), codeMfa: z.string().trim().regex(/^\d{6}$/).optional() }).parse(req.body);
    const { rows: [u] } = await ctx.c.query(
      "SELECT password_hash, failed_login_count, mfa_enabled, mfa_secret_enc, mfa_last_step FROM app_users WHERE id = $1 FOR UPDATE", [ctx.utilisateur.id]);
    let raison: string | null = null, pas: number | null = null;
    if (!(await verifierMotDePasse(u.password_hash, d.motDePasse))) raison = "mot_de_passe";
    else if (u.mfa_enabled) {
      pas = d.codeMfa ? verifierTotp(dechiffrer(cfg.cleChiffrement, u.mfa_secret_enc), d.codeMfa, Number(u.mfa_last_step)) : null;
      if (pas === null) raison = d.codeMfa ? "code_mfa" : "code_mfa_absent";
    }
    if (raison) {
      const n = u.failed_login_count + 1;
      const verrou = n >= cfg.echecsAvantVerrouillage;
      await ctx.c.query(
        `UPDATE app_users SET failed_login_count = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id = $1`,
        [ctx.utilisateur.id, verrou ? 0 : n, verrou, cfg.verrouillageMinutes]);
      await ctx.journaliser({ type: "auth", action: "step_up", resultat: "failure", details: { raison } });
      if (verrou) {
        await revoquerSessions(ctx.c, ctx.utilisateur.id, "echecs_confirmation");
        await ctx.journaliser({ type: "security", action: "account_locked", objetType: "user", objetId: ctx.utilisateur.id, details: { echecs: n, contexte: "confirmation" } });
        await notifier(ctx.c, { permission: "users.admin", type: "security", titre: "Compte verrouillé", corps: `${ctx.utilisateur.nom} : ${n} échecs de confirmation. Sessions fermées.` });
      }
      // Réponse d'erreur sans exception : la transaction est validée et le compteur d'échecs conservé.
      ctx.rep.status(401);
      return { erreur: raison === "code_mfa_absent"
        ? { code: "mfa_requis", message: "Saisissez aussi le code de votre application d'authentification." }
        : { code: "confirmation_refusee", message: "Mot de passe ou code incorrect." } };
    }
    if (pas !== null) await ctx.c.query("UPDATE app_users SET mfa_last_step = $2 WHERE id = $1", [ctx.utilisateur.id, pas]);
    await ctx.c.query("UPDATE app_users SET failed_login_count = 0 WHERE id = $1", [ctx.utilisateur.id]);
    await ctx.c.query("UPDATE user_sessions SET reauth_at = now() WHERE id = $1", [ctx.sessionId]);
    await ctx.journaliser({ type: "auth", action: "step_up" });
    return { ok: true, valableMinutes: cfg.confirmationMinutes };
  }));

  // ---------------------------------------------------------------- Récupération d'accès par le code maître
  // Rétablit l'accès d'un administrateur actif (mot de passe ou téléphone MFA perdu).
  // Le code est consommé, la MFA de ce compte est réinitialisée, ses sessions fermées,
  // et un code de réinitialisation de 30 min est remis. Tous les administrateurs sont prévenus.
  app.post("/api/auth/recuperation", async (req) => {
    const ip = req.ip;
    limiter(ip);
    const d = z.object({
      codeEntreprise: z.string().trim().min(1).max(32),
      codeMaitre: z.string().trim().min(10).max(60),
      email: z.string().trim().toLowerCase().email().max(254),
    }).parse(req.body);
    const refus = new ErreurHttp(400, "recuperation_refusee", "Récupération impossible : vérifiez le code entreprise, le code maître et l'adresse de l'administrateur.");
    const entrepriseId = await entrepriseParCode(d.codeEntreprise, ip, "recuperation");
    if (!entrepriseId) { await verifierMotDePasse(null, d.codeMaitre); throw refus; }

    const sortie = await transaction(pool, entrepriseId, async (c) => {
      const { rows: [e] } = await c.query(
        `SELECT master_code_hash, master_code_failed_count,
                master_code_locked_until IS NOT NULL AND master_code_locked_until > now() AS verrouille
           FROM companies WHERE id = $1 FOR UPDATE`, [entrepriseId]);
      const trace = (resultat: "failure" | "denied" | "success", details: Record<string, unknown>, acteurId: string | null = null) =>
        journaliser(c, { type: "security", action: "master_code_recovery", resultat, acteurId, ip, details: { email: d.email, ...details } });
      if (e.verrouille) {
        await trace("denied", { raison: "code_maitre_verrouille" });
        return { erreur: new ErreurHttp(423, "code_maitre_verrouille", "Trop d'essais avec le code maître. Réessayez dans une heure.") };
      }
      const valide = await verifierMotDePasse(e.master_code_hash, normaliserCodeMaitre(d.codeMaitre));
      if (!valide) {
        const n = e.master_code_failed_count + 1, verrou = n >= 5;
        await c.query(
          `UPDATE companies SET master_code_failed_count = $2,
                  master_code_locked_until = CASE WHEN $3 THEN now() + interval '1 hour' ELSE master_code_locked_until END WHERE id = $1`,
          [entrepriseId, verrou ? 0 : n, verrou]);
        await trace("failure", { raison: e.master_code_hash ? "code_incorrect" : "aucun_code_actif", echecs: n });
        if (verrou) await notifier(c, { permission: "users.admin", type: "security", titre: "Code maître bloqué",
          corps: "5 essais incorrects du code maître. Il est bloqué pour une heure." });
        return { erreur: refus };
      }
      const { rows: [u] } = await c.query(
        `SELECT u.id, u.full_name FROM app_users u
          WHERE lower(u.email) = $1 AND u.status = 'active'
            AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.archived_at IS NULL
                          JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
                         WHERE ur.user_id = u.id AND p.permission_key = 'users.admin')
          FOR UPDATE OF u`, [d.email]);
      if (!u) {
        await trace("denied", { raison: "pas_un_administrateur_actif" });
        return { erreur: refus };
      }
      await c.query("UPDATE companies SET master_code_hash = NULL, master_code_failed_count = 0, master_code_locked_until = NULL WHERE id = $1", [entrepriseId]);
      await c.query(
        `UPDATE app_users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL,
                              failed_login_count = 0, locked_until = NULL WHERE id = $1`, [u.id]);
      const fermees = await revoquerSessions(c, u.id, "recuperation_code_maitre");
      await c.query("UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL", [u.id]);
      const jeton = genererJeton();
      const { rows: [t] } = await c.query(
        `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'password_reset', $2, now() + interval '30 minutes') RETURNING expires_at`,
        [u.id, empreinteJeton(jeton)]);
      await trace("success", { sessionsFermees: fermees, mfaReinitialisee: true }, u.id);
      await notifier(c, { permission: "users.admin", type: "security", titre: "Code maître utilisé",
        corps: `Le code maître a servi à rétablir l'accès de ${u.full_name}. Il n'est plus valable : un administrateur doit en générer un nouveau. Si cette opération n'était pas prévue, réagissez immédiatement.` });
      return { valeur: { reinitialisation: { jeton, expireLe: t.expires_at }, message: "Accès rétabli. Choisissez un nouveau mot de passe, puis réactivez la double authentification et générez un nouveau code maître." } };
    });
    if ("erreur" in sortie) throw sortie.erreur;
    return sortie.valeur;
  });

  // ---------------------------------------------------------------- Mes sessions
  app.get("/api/auth/sessions", proteger(deps, { permission: null, avantMfa: true }, async (_req, ctx) => {
    const { rows } = await ctx.c.query(
      `SELECT id, created_at, last_seen_at, expires_at, host(ip_address) AS ip, user_agent
         FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [ctx.utilisateur.id]);
    return rows.map((s) => ({ id: s.id, creeLe: s.created_at, derniereActivite: s.last_seen_at, expireLe: s.expires_at, ip: s.ip, agent: s.user_agent, courante: s.id === ctx.sessionId }));
  }));

  app.delete<{ Params: { id: string } }>("/api/auth/sessions/:id", proteger(deps, { permission: null, avantMfa: true }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw new ErreurHttp(404, "introuvable", "Session introuvable.");
    const r = await ctx.c.query("UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'revocation_utilisateur' WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [id, ctx.utilisateur.id]);
    if (!r.rowCount) throw new ErreurHttp(404, "introuvable", "Session introuvable.");
    await ctx.journaliser({ type: "auth", action: "session_revoke", objetType: "session", objetId: id });
    return { ok: true };
  }));
}

/** Vrai si ce compte est le seul administrateur actif (permission users.admin) de l'entreprise. */
async function estDernierAdmin(c: Client, utilisateurId: string) {
  const { rows: [r] } = await c.query(
    `SELECT count(DISTINCT u.id) FILTER (WHERE u.id <> $1)::int AS autres,
            count(DISTINCT u.id) FILTER (WHERE u.id = $1)::int AS moi
       FROM app_users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles ro ON ro.id = ur.role_id AND ro.archived_at IS NULL
       JOIN role_permissions rp ON rp.role_id = ro.id
       JOIN permissions p ON p.id = rp.permission_id AND p.permission_key = 'users.admin'
      WHERE u.status = 'active'`, [utilisateurId]);
  return r.moi > 0 && r.autres === 0;
}
