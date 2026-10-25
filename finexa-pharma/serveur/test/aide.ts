import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { creerPool, type Pool } from "../src/db.js";
import { migrer } from "../src/domaine/migrations.js";
import { creerEntreprise } from "../src/domaine/entreprises.js";
import { construireApp } from "../src/http/app.js";
import type { Config } from "../src/config.js";
import { codeHotp, base32Decoder, pasCourant } from "../src/securite/totp.js";

/**
 * Environnement de test : une base PostgreSQL neuve par fichier de test.
 * Prérequis : rôles gc_owner, gc_app, gc_backup créés sur le serveur désigné par GC_TEST_SUPER.
 */
const SUPER = process.env.GC_TEST_SUPER ?? "postgresql://postgres@%2Ftmp:5433/postgres";
export const url = (role: string, base: string) => { const u = new URL(SUPER); u.username = role; u.pathname = "/" + base; return u.toString(); };

export const cfgTest: Config = {
  port: 0, hote: "127.0.0.1", baseDeDonnees: "", cleChiffrement: randomBytes(32),
  sessionInactiviteMinutes: 15, sessionDureeMaxHeures: 10, cookieSecurise: false, confirmationMinutes: 5,
  echecsAvantVerrouillage: 5, verrouillageMinutes: 15, tentativesParIpParFenetre: 1000, fenetreTentativesMinutes: 10,
};

export interface Env { app: FastifyInstance; pool: Pool; proprio: Pool; superu: Pool; base: string; fermer: () => Promise<void> }

export async function preparer(): Promise<Env> {
  const base = "gc_test_" + randomBytes(4).toString("hex");
  const admin = new pg.Client({ connectionString: SUPER });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${base} OWNER gc_owner`);
  await admin.end();
  const superu = creerPool(url("postgres", base), 2);
  await superu.query("ALTER SCHEMA public OWNER TO gc_owner; REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  const proprio = creerPool(url("gc_owner", base), 2);
  await migrer(proprio, join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"), () => {});
  const pool = creerPool(url("gc_app", base), 5);
  const app = construireApp({ pool, cfg: cfgTest });
  await app.ready();
  return {
    app, pool, proprio, superu, base,
    fermer: async () => {
      await app.close(); await pool.end(); await proprio.end(); await superu.end();
      const a = new pg.Client({ connectionString: SUPER }); await a.connect();
      await a.query(`DROP DATABASE ${base} WITH (FORCE)`); await a.end();
    },
  };
}

/** Petit client HTTP qui garde son cookie de session, comme un navigateur. */
export class Agent {
  cookie = "";
  constructor(private app: FastifyInstance, public ip = "10.0.0.10") {}
  async req(method: string, url: string, body?: unknown, enTetes: Record<string, string> = {}) {
    const r = await this.app.inject({
      method: method as "GET", url, payload: body as object, remoteAddress: this.ip,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(method !== "GET" ? { "x-gc-requete": "1" } : {}), ...enTetes },
    });
    const sc = r.cookies.find((c) => c.name === "gc_session");
    if (sc) this.cookie = sc.value ? `gc_session=${sc.value}` : "";
    return { statut: r.statusCode, corps: r.headers["content-type"]?.toString().includes("json") ? r.json() : r.body, brut: r };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, b: unknown = {}) => this.req("POST", u, b);
  put = (u: string, b: unknown = {}) => this.req("PUT", u, b);
  patch = (u: string, b: unknown = {}) => this.req("PATCH", u, b);
  del = (u: string) => this.req("DELETE", u);
}

export const MDP = "Correct-Cheval-Batterie-42";

/** Code TOTP valide pour un pas donné (par défaut le pas courant). */
export const totp = (secret: string, decalage = 0) => codeHotp(base32Decoder(secret), pasCourant() + decalage);

/**
 * Crée une entreprise et active son administrateur. mfa=false désactive l'obligation MFA
 * pour simplifier les tests qui ne portent pas sur elle.
 */
export async function entrepriseActive(env: Env, code: string, opts: { mfa?: boolean } = {}) {
  const email = `admin@${code.toLowerCase()}.cm`;
  const r = await creerEntreprise(env.proprio, { code, raisonSociale: `${code} SARL`, adminEmail: email, adminNom: "Admin Principal" });
  if (opts.mfa === false) await env.superu.query("UPDATE companies SET settings = '{\"mfaObligatoire\": false}' WHERE id = $1", [r.entrepriseId]);
  const admin = new Agent(env.app);
  const acc = await admin.post("/api/auth/invitation/acceptation", { codeEntreprise: code, jeton: r.jetonInvitation, motDePasse: MDP });
  if (acc.statut !== 200) throw new Error("acceptation: " + JSON.stringify(acc.corps));
  const cx = await admin.post("/api/auth/connexion", { codeEntreprise: code, email, motDePasse: MDP });
  if (cx.statut !== 200) throw new Error("connexion: " + JSON.stringify(cx.corps));
  await confirmer(admin);
  return { ...r, email, admin };
}

/** Crée un utilisateur avec un rôle système donné et le connecte. */
export async function utilisateurAvecRole(env: Env, e: Awaited<ReturnType<typeof entrepriseActive>>, cleRole: string, email: string, ip = "10.0.0.20") {
  const roles = (await e.admin.get("/api/roles")).corps as { id: string; cle: string }[];
  const role = roles.find((r) => r.cle === cleRole)!;
  const cr = await e.admin.post("/api/utilisateurs", { nom: "Personne Test " + cleRole, email, roles: [role.id] });
  if (cr.statut !== 200) throw new Error("création: " + JSON.stringify(cr.corps));
  const agent = new Agent(env.app, ip);
  await agent.post("/api/auth/invitation/acceptation", { codeEntreprise: e.code, jeton: cr.corps.invitation.jeton, motDePasse: MDP });
  const cx = await agent.post("/api/auth/connexion", { codeEntreprise: e.code, email, motDePasse: MDP });
  if (cx.statut !== 200) throw new Error("connexion: " + JSON.stringify(cx.corps));
  await confirmer(agent);
  return { agent, id: cr.corps.utilisateur.id as string };
}

/** Lit le journal d'une entreprise directement en base (superutilisateur). */
export async function journal(env: Env, entrepriseId: string) {
  const { rows } = await env.superu.query("SELECT * FROM audit_events WHERE company_id = $1 ORDER BY sequence_no", [entrepriseId]);
  return rows;
}

/** Confirmation par mot de passe (opérations sensibles), valable quelques minutes. */
export async function confirmer(agent: Agent, codeMfa?: string) {
  const r = await agent.post("/api/auth/confirmation", { motDePasse: MDP, ...(codeMfa ? { codeMfa } : {}) });
  if (r.statut !== 200) throw new Error("confirmation: " + JSON.stringify(r.corps));
}
