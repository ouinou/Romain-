import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Agent, cfgTest, MDP, preparer, type Env } from "./aide.js";
import { construireApp } from "../src/http/app.js";
import type { FastifyInstance } from "fastify";

/** Assistant de première installation : seulement depuis le serveur, seulement tant qu'aucune entreprise n'existe. */
let env: Env;
let app: FastifyInstance;
before(async () => {
  env = await preparer();
  app = construireApp({ pool: env.pool, cfg: cfgTest, poolProprietaire: env.proprio });
  await app.ready();
});
after(async () => { await app?.close(); await env?.fermer(); });

const premiere = { code: "premiere-01", raisonSociale: "Première SARL", adminEmail: "Admin@Premiere.cm", adminNom: "Admin Premier" };

test("Refusé depuis un autre poste du réseau ; désactivé si le serveur n'a pas la connexion propriétaire", async () => {
  const distant = new Agent(app, "192.168.1.25");
  assert.equal((await distant.get("/api/installation")).corps.disponible, false);
  assert.equal((await distant.post("/api/installation/entreprise", premiere)).statut, 403);
  const sansProprio = new Agent(env.app, "127.0.0.1");
  assert.equal((await sansProprio.get("/api/installation")).corps.disponible, false);
  assert.equal((await sansProprio.post("/api/installation/entreprise", premiere)).statut, 404);
});

test("Depuis le serveur : crée la première entreprise, puis se ferme définitivement", async () => {
  const local = new Agent(app, "127.0.0.1");
  assert.equal((await local.get("/api/installation")).corps.disponible, true);
  assert.equal((await local.post("/api/installation/entreprise", { ...premiere, adminEmail: "pas-un-email" })).statut, 400);
  const r = await local.post("/api/installation/entreprise", premiere);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.code, "PREMIERE-01");
  assert.match(r.corps.codeMaitre, /^GCM-/);
  // L'administrateur active son compte avec le code d'invitation, puis se connecte.
  const admin = new Agent(app, "127.0.0.1");
  assert.equal((await admin.post("/api/auth/invitation/acceptation", { codeEntreprise: "PREMIERE-01", jeton: r.corps.invitation, motDePasse: MDP })).statut, 200);
  assert.equal((await admin.post("/api/auth/connexion", { codeEntreprise: "PREMIERE-01", email: "admin@premiere.cm", motDePasse: MDP })).statut, 200);
  // Fermé : une deuxième « première installation » est refusée, même en parallèle.
  assert.equal((await local.get("/api/installation")).corps.disponible, false);
  const deux = await Promise.all([1, 2].map((i) => local.post("/api/installation/entreprise", { ...premiere, code: `AUTRE-0${i}` })));
  assert.deepEqual(deux.map((x) => x.statut), [409, 409]);
  const { rows } = await env.superu.query("SELECT count(*)::int AS n FROM companies");
  assert.equal(rows[0].n, 1);
});
