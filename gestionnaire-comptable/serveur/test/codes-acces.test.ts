import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";
import { Agent, MDP, entrepriseActive, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/**
 * Codes d'invitation et de réinitialisation remis de la main à la main (constat des essais sous Windows :
 * « Ce lien n'est pas valide ou a expiré » sans autre indication). Les codes sont lisibles, la saisie est tolérante,
 * et le refus dit pourquoi à la personne qui détient un vrai code, sans révéler l'existence d'une entreprise.
 */
const FORME = /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){4}$/;
let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
const nouveauMdp = "Une-phrase-de-passe-fictive-2026";

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "ACCES-01", { mfa: false });
});
after(async () => { await env?.fermer(); });

const inviter = async (email: string) => {
  const r = await e.admin.post("/api/utilisateurs", { nom: "Collaborateur Fictif", email });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps as { utilisateur: { id: string }; invitation: { jeton: string; expireLe: string } };
};
const activer = (code: string, jeton: string, chemin = "invitation/acceptation") =>
  new Agent(env.app).post(`/api/auth/${chemin}`, { codeEntreprise: code, jeton, motDePasse: nouveauMdp });

describe("Codes d'accès lisibles", () => {
  test("Code d'invitation en 5 groupes de 4, sans caractères ambigus ; saisie en minuscules et avec espaces acceptée", async () => {
    const { invitation } = await inviter("lisible@acces-01.cm");
    assert.match(invitation.jeton, FORME);
    const saisie = ` ${invitation.jeton.toLowerCase().replace(/-/g, " ")} `;
    const r = await activer("acces-01", saisie);
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    const cx = await new Agent(env.app).post("/api/auth/connexion", { codeEntreprise: "ACCES-01", email: "lisible@acces-01.cm", motDePasse: nouveauMdp });
    assert.equal(cx.statut, 200);
    // Réutilisé : le compte est actif, on lui dit de se connecter.
    const encore = await activer("ACCES-01", invitation.jeton);
    assert.equal(encore.statut, 400);
    assert.match(encore.corps.erreur.message, /déjà servi : votre compte est actif/);
  });

  test("Invitation renouvelée : l'ancien code est signalé comme remplacé", async () => {
    const { utilisateur, invitation } = await inviter("renouvele@acces-01.cm");
    const nouveau = (await e.admin.post(`/api/utilisateurs/${utilisateur.id}/invitation`, {})).corps.invitation;
    assert.notEqual(nouveau.jeton, invitation.jeton);
    assert.match((await activer("ACCES-01", invitation.jeton)).corps.erreur.message, /code plus récent/);
    assert.equal((await activer("ACCES-01", nouveau.jeton)).statut, 200);
  });

  test("Code expiré : la date d'expiration est indiquée", async () => {
    const { utilisateur, invitation } = await inviter("expire@acces-01.cm");
    await env.superu.query("UPDATE user_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1", [utilisateur.id]);
    assert.match((await activer("ACCES-01", invitation.jeton)).corps.erreur.message, /a expiré le \d{2}\/\d{2}\/\d{4}/);
  });

  test("Code de réinitialisation saisi dans « Activer mon compte » : la bonne rubrique est indiquée", async () => {
    const c = await utilisateurAvecRole(env, e, "cashier", "caisse@acces-01.cm");
    await e.admin.post("/api/auth/confirmation", { motDePasse: MDP });
    const r = await e.admin.post(`/api/utilisateurs/${c.id}/reinitialisation-mot-de-passe`, { motif: "Mot de passe oublié (test)" });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.match(r.corps.reinitialisation.jeton, FORME);
    assert.match((await activer("ACCES-01", r.corps.reinitialisation.jeton)).corps.erreur.message, /code de réinitialisation/);
    assert.equal((await activer("ACCES-01", r.corps.reinitialisation.jeton, "reinitialisation")).statut, 200);
  });

  test("Entreprise inconnue ou code inconnu : même message, avec le nom du serveur et quoi vérifier", async () => {
    const { invitation } = await inviter("inconnu@acces-01.cm");
    const autreEntreprise = await activer("N-EXISTE-PAS", invitation.jeton);
    const codeFaux = await activer("ACCES-01", "ABCD-EFGH-JKMN-PQRS-TUVW");
    assert.equal(autreEntreprise.corps.erreur.message, codeFaux.corps.erreur.message, "on ne révèle pas si l'entreprise existe");
    assert.ok(codeFaux.corps.erreur.message.includes(`serveur « ${hostname()} »`));
    assert.match(codeFaux.corps.erreur.message, /sa propre base/);
  });
});

describe("Serveur et adresses pour les autres postes", () => {
  test("Le nom du serveur est public ; les adresses réseau sont réservées à qui crée des comptes", async () => {
    const s = await new Agent(env.app).get("/api/sante");
    assert.equal(s.corps.serveur, hostname());
    const r = await e.admin.get("/api/reseau");
    assert.equal(r.statut, 200);
    assert.equal(r.corps.nom, hostname());
    assert.ok(r.corps.adresses[0].startsWith("http://") && r.corps.adresses[0].includes(hostname()));
    const c = await utilisateurAvecRole(env, e, "cashier", "caisse2@acces-01.cm");
    assert.equal((await c.agent.get("/api/reseau")).statut, 403);
  });
});
