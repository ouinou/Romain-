import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exiger, exigerConfirmation, proteger, type Dependances } from "../contexte.js";
import { genererCodeMaitre, normaliserCodeMaitre } from "../../securite/code-maitre.js";
import { hacherMotDePasse } from "../../securite/motdepasse.js";

const vue = (e: Record<string, any>) => ({
  id: e.id, code: e.company_code, raisonSociale: e.legal_name, statut: e.status, pays: e.country_code, devise: e.currency_code,
  rccm: e.rccm, niu: e.niu, adresse: e.address, telephone: e.phone,
  parametres: { mfaObligatoire: e.settings?.mfaObligatoire ?? true, inactiviteJours: e.settings?.inactiviteJours ?? 90 },
  codeMaitre: { actif: !!e.master_code_hash, creeLe: e.master_code_created_at, bloque: !!e.master_code_locked_until && new Date(e.master_code_locked_until) > new Date() },
});

export function routesEntreprise(app: FastifyInstance, deps: Dependances) {
  app.get("/api/entreprise", proteger(deps, { permission: "company.read" }, async (_req, ctx) => {
    const { rows: [e] } = await ctx.c.query("SELECT * FROM companies WHERE id = $1", [ctx.entrepriseId]);
    return vue(e);
  }));

  app.patch("/api/entreprise", proteger(deps, { permission: "company.update" }, async (req, ctx) => {
    const d = z.object({
      raisonSociale: z.string().trim().min(2).max(200).optional(),
      rccm: z.string().trim().max(60).nullable().optional(),       // Registre du commerce et du crédit mobilier (OHADA)
      niu: z.string().trim().max(30).nullable().optional(),         // Numéro d'identifiant unique (administration fiscale)
      adresse: z.string().trim().max(300).nullable().optional(),
      telephone: z.string().trim().max(40).nullable().optional(),
      parametres: z.object({
        mfaObligatoire: z.boolean().optional(),
        // Comptes désactivés après N jours sans connexion ; 0 = jamais.
        inactiviteJours: z.number().int().min(0).max(3650).optional(),
      }).optional(),
    }).parse(req.body);
    if (d.parametres) { exiger(ctx, "company.admin"); exigerConfirmation(ctx); }   // paramètres de sécurité
    const { rows: [avant] } = await ctx.c.query("SELECT * FROM companies WHERE id = $1 FOR UPDATE", [ctx.entrepriseId]);
    const settings = { ...avant.settings, ...(d.parametres ?? {}) };
    const champ = <T>(v: T | undefined, actuel: T) => (v === undefined ? actuel : v);
    const { rows: [apres] } = await ctx.c.query(
      "UPDATE companies SET legal_name = $2, rccm = $3, niu = $4, address = $5, phone = $6, settings = $7 WHERE id = $1 RETURNING *",
      [ctx.entrepriseId, champ(d.raisonSociale, avant.legal_name), champ(d.rccm, avant.rccm), champ(d.niu, avant.niu),
       champ(d.adresse, avant.address), champ(d.telephone, avant.phone), JSON.stringify(settings)]);
    await ctx.journaliser({ type: d.parametres ? "security" : "company", action: d.parametres ? "security_settings_change" : "update",
      objetType: "company", objetId: ctx.entrepriseId, avant: vue(avant), apres: vue(apres) });
    return vue(apres);
  }));

  // Nouveau code maître : affiché une seule fois, l'ancien cesse immédiatement d'être valable.
  // À imprimer et à remettre sous enveloppe scellée au dirigeant (pas à l'administrateur informatique).
  app.post("/api/entreprise/code-maitre", proteger(deps, { permission: "company.admin", sensible: true }, async (_req, ctx) => {
    const code = genererCodeMaitre();
    const { rows: [e] } = await ctx.c.query("SELECT master_code_hash IS NOT NULL AS existait FROM companies WHERE id = $1 FOR UPDATE", [ctx.entrepriseId]);
    await ctx.c.query(
      `UPDATE companies SET master_code_hash = $2, master_code_created_at = now(), master_code_failed_count = 0, master_code_locked_until = NULL WHERE id = $1`,
      [ctx.entrepriseId, await hacherMotDePasse(normaliserCodeMaitre(code))]);
    await ctx.journaliser({ type: "security", action: "master_code_regenerate", objetType: "company", objetId: ctx.entrepriseId, details: { remplace: e.existait } });
    return { codeMaitre: code, message: "Notez ce code maintenant : il ne sera plus jamais affiché. L'ancien code n'est plus valable." };
  }));
}
