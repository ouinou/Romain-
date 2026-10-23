import type { FastifyReply, FastifyRequest } from "fastify";
import type { Client, Pool } from "../db.js";
import { transaction, UUID } from "../db.js";
import type { Config } from "../config.js";
import { journaliser, journaliserIsole, type Evenement } from "../domaine/audit.js";
import { validerSession } from "../domaine/sessions.js";
import { ErreurHttp } from "./erreurs.js";

export const COOKIE_SESSION = "gc_session";

export interface Dependances { pool: Pool; cfg: Config }

/** Contexte d'une requête authentifiée, toujours limitée à l'entreprise de la session. */
export interface Ctx {
  c: Client;
  entrepriseId: string;
  sessionId: string;
  utilisateur: { id: string; email: string; nom: string; mfaActive: boolean };
  permissions: Set<string>;
  /** L'utilisateur a ressaisi son mot de passe il y a moins de quelques minutes. */
  confirmee: boolean;
  ip: string;
  a: (permission: string) => boolean;
  /** Journalise avec l'auteur, la session et l'adresse IP de la requête. */
  journaliser: (e: Evenement) => Promise<void>;
  rep: FastifyReply;
}

export function lireCookieSession(req: FastifyRequest): { entrepriseId: string; jeton: string } | null {
  const v = req.cookies[COOKIE_SESSION];
  if (!v) return null;
  const i = v.indexOf(".");
  const entrepriseId = v.slice(0, i), jeton = v.slice(i + 1);
  if (i < 0 || !UUID.test(entrepriseId) || jeton.length < 20) return null;
  return { entrepriseId, jeton };
}

interface Options {
  /** Permission « module.action » exigée, vérifiée côté serveur. null = toute personne connectée. */
  permission: string | null;
  /** Route accessible même si la double authentification reste à configurer. */
  avantMfa?: boolean;
  /** Opération sensible : exige une confirmation récente par mot de passe (et code MFA). */
  sensible?: boolean;
}

type Traitement<T> = (req: FastifyRequest, ctx: Ctx) => Promise<T>;

/**
 * Enveloppe commune à toutes les routes protégées :
 * session valide → contexte entreprise (RLS) → contrôle MFA → contrôle de permission → traitement.
 * Un refus de permission est toujours journalisé.
 */
export function proteger<T>(deps: Dependances, opts: Options, traitement: Traitement<T>) {
  return async (req: FastifyRequest, rep: FastifyReply): Promise<T> => {
    const ck = lireCookieSession(req);
    if (!ck) throw new ErreurHttp(401, "non_authentifie", "Connexion requise.");
    const ip = req.ip;
    let ctxAudit: Pick<Evenement, "acteurId" | "sessionId" | "ip"> = { ip };
    try {
      const sortie = await transaction(deps.pool, ck.entrepriseId, async (c) => {
        const v = await validerSession(c, deps.cfg, ck.jeton, req.headers["x-gc-automatique"] === "1");
        if ("refus" in v) return { erreur: new ErreurHttp(401, "session_invalide", v.refus) };
        ctxAudit = { acteurId: v.utilisateur.id, sessionId: v.sessionId, ip };
        if (v.mfaAConfigurer && !opts.avantMfa)
          return { erreur: new ErreurHttp(403, "mfa_a_configurer", "Activez la double authentification avant d'accéder à cette fonction.") };
        if (opts.permission && !v.permissions.has(opts.permission)) {
          await journaliser(c, {
            ...ctxAudit, type: "security", action: "access_denied", resultat: "denied",
            details: { permission: opts.permission, methode: req.method, route: req.routeOptions.url },
          });
          return { erreur: new ErreurHttp(403, "acces_refuse", "Vous n'avez pas la permission nécessaire pour cette action.") };
        }
        if (opts.sensible && !v.confirmee) return { erreur: erreurConfirmation() };
        const ctx: Ctx = {
          c, entrepriseId: ck.entrepriseId, sessionId: v.sessionId, utilisateur: v.utilisateur, permissions: v.permissions, ip, rep,
          confirmee: v.confirmee,
          a: (p) => v.permissions.has(p),
          journaliser: (e) => journaliser(c, { ...ctxAudit, ...e }),
        };
        return { valeur: await traitement(req, ctx) };
      });
      if ("erreur" in sortie) throw sortie.erreur;
      return sortie.valeur as T;
    } catch (e) {
      if (e instanceof ErreurHttp && e.audit) await journaliserIsole(deps.pool, ck.entrepriseId, { ...ctxAudit, ...e.audit });
      throw e;
    }
  };
}

/** Vérifie une permission supplémentaire à l'intérieur d'un traitement (journalisée si refusée). */
export function exiger(ctx: Ctx, permission: string) {
  if (!ctx.a(permission))
    throw new ErreurHttp(403, "acces_refuse", "Vous n'avez pas la permission nécessaire pour cette action.",
      { type: "security", action: "access_denied", resultat: "denied", details: { permission } });
}

const erreurConfirmation = () =>
  new ErreurHttp(403, "confirmation_requise", "Opération sensible : confirmez votre identité en ressaisissant votre mot de passe.");

/** Pour une opération qui ne devient sensible que dans certains cas (ex. création d'un compte AVEC des rôles). */
export function exigerConfirmation(ctx: Ctx) {
  if (!ctx.confirmee) throw erreurConfirmation();
}

/** Pagination commune : page ≥ 1, taille entre 1 et 100. */
export function pagination(q: { page?: unknown; taille?: unknown }) {
  const page = Math.max(1, Number.parseInt(String(q.page ?? "1"), 10) || 1);
  const taille = Math.min(100, Math.max(1, Number.parseInt(String(q.taille ?? "25"), 10) || 25));
  return { page, taille, offset: (page - 1) * taille };
}
