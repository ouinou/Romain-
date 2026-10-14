import Fastify, { type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import { ZodError } from "zod";
import type { Dependances } from "./contexte.js";
import { ErreurHttp } from "./erreurs.js";
import { routesAuth } from "./routes/auth.js";
import { routesUtilisateurs } from "./routes/utilisateurs.js";
import { routesRoles } from "./routes/roles.js";
import { routesAudit } from "./routes/audit.js";
import { routesEntreprise } from "./routes/entreprise.js";
import { routesNotifications } from "./routes/notifications.js";

export function construireApp(deps: Dependances, options: FastifyServerOptions = {}) {
  const app = Fastify({ bodyLimit: 1_048_576, trustProxy: false, ...options });
  app.register(cookie);

  // Protection CSRF en complément de SameSite=Strict : toute requête qui modifie exige un en-tête
  // personnalisé, qu'un formulaire ou un lien d'un autre site ne peut pas envoyer.
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-gc-requete"] !== "1")
      throw new ErreurHttp(403, "en_tete_manquant", "Requête refusée : en-tête X-GC-Requete absent.");
  });

  app.addHook("onSend", async (req, rep) => {
    rep.header("x-content-type-options", "nosniff");
    rep.header("x-frame-options", "DENY");
    rep.header("referrer-policy", "no-referrer");
    rep.header("content-security-policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.url.startsWith("/api/")) rep.header("cache-control", "no-store");
  });

  app.setErrorHandler((err, req, rep) => {
    if (err instanceof ErreurHttp) return rep.status(err.statut).send({ erreur: { code: err.code, message: err.message } });
    if (err instanceof ZodError)
      return rep.status(400).send({ erreur: { code: "donnees_invalides", message: "Certaines données sont invalides.",
        champs: err.issues.map((i) => ({ champ: i.path.join("."), message: i.message })) } });
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return rep.status(e.statusCode).send({ erreur: { code: "requete_invalide", message: e.message } });
    req.log.error(err);
    return rep.status(500).send({ erreur: { code: "erreur_interne", message: "Erreur interne du serveur. L'incident a été consigné." } });
  });

  app.setNotFoundHandler((_req, rep) => rep.status(404).send({ erreur: { code: "introuvable", message: "Adresse inconnue." } }));

  app.get("/api/sante", async () => {
    await deps.pool.query("SELECT 1");
    return { statut: "ok", version: "0.1.0" };
  });

  routesAuth(app, deps);
  routesUtilisateurs(app, deps);
  routesRoles(app, deps);
  routesAudit(app, deps);
  routesEntreprise(app, deps);
  routesNotifications(app, deps);
  return app;
}
