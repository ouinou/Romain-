import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Dependances } from "../contexte.js";
import { ErreurHttp } from "../erreurs.js";
import { creerEntreprise } from "../../domaine/entreprises.js";
import { journaliserSysteme } from "../../domaine/audit.js";

/**
 * Assistant de première installation : crée la PREMIÈRE entreprise et son administrateur depuis le navigateur,
 * juste après le setup Windows, sans ligne de commande.
 *
 * Garde-fous (ce n'est pas une porte d'entrée permanente) :
 *  - actif seulement tant qu'AUCUNE entreprise n'existe ; dès la première créée, il se ferme définitivement ;
 *  - seulement depuis le serveur lui-même (adresse de bouclage), jamais depuis un autre poste du réseau ;
 *  - il ne donne aucun accès aux données : il remet un code d'invitation et le code maître, comme l'outil
 *    en ligne de commande `entreprise:creer`.
 */
const LOCAL = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const estLocal = (req: FastifyRequest) => LOCAL.has(req.socket.remoteAddress ?? req.ip);

export function routesInstallation(app: FastifyInstance, deps: Dependances) {
  const aucuneEntreprise = async () => {
    if (!deps.poolProprietaire) return false;
    const { rows: [r] } = await deps.poolProprietaire.query("SELECT NOT EXISTS (SELECT 1 FROM companies) AS vide");
    return r.vide as boolean;
  };

  app.get("/api/installation", async (req) => ({ disponible: estLocal(req) && (await aucuneEntreprise()) }));

  app.post("/api/installation/entreprise", async (req) => {
    if (!deps.poolProprietaire) throw new ErreurHttp(404, "introuvable", "Adresse inconnue.");
    if (!estLocal(req)) {
      await journaliserSysteme(deps.pool, "installation_refusee", "denied", { raison: "poste_distant" }, req.ip);
      throw new ErreurHttp(403, "acces_refuse", "La première installation se fait uniquement sur le serveur lui-même.");
    }
    const d = z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{3,31}$/, "Code entreprise : 4 à 32 caractères, lettres, chiffres et tirets."),
      raisonSociale: z.string().trim().min(2, "Raison sociale obligatoire.").max(200),
      adminEmail: z.string().trim().toLowerCase().email("Adresse e-mail invalide.").max(254),
      adminNom: z.string().trim().min(2, "Nom de l'administrateur obligatoire.").max(120),
      niu: z.string().trim().max(30).optional(), rccm: z.string().trim().max(60).optional(),
    }).parse(req.body);
    // Verrou : deux envois simultanés ne peuvent pas créer deux « premières » entreprises.
    const c = await deps.poolProprietaire.connect();
    try {
      await c.query("SELECT pg_advisory_lock(hashtextextended('gc-premiere-installation', 0))");
      const { rows: [r] } = await c.query("SELECT NOT EXISTS (SELECT 1 FROM companies) AS vide");
      if (!r.vide) throw new ErreurHttp(409, "deja_installe", "Une entreprise existe déjà : l'assistant de première installation est fermé.");
      const res = await creerEntreprise(deps.poolProprietaire, { code: d.code, raisonSociale: d.raisonSociale, adminEmail: d.adminEmail, adminNom: d.adminNom, niu: d.niu || undefined, rccm: d.rccm || undefined });
      return { code: d.code, codeMaitre: res.codeMaitre, invitation: res.jetonInvitation, adminEmail: d.adminEmail };
    } finally {
      await c.query("SELECT pg_advisory_unlock(hashtextextended('gc-premiere-installation', 0))").catch(() => {});
      c.release();
    }
  });
}
