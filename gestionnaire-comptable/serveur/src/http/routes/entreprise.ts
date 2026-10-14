import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exiger, proteger, type Dependances } from "../contexte.js";

const vue = (e: Record<string, any>) => ({
  id: e.id, code: e.company_code, raisonSociale: e.legal_name, statut: e.status, pays: e.country_code, devise: e.currency_code,
  rccm: e.rccm, niu: e.niu, adresse: e.address, telephone: e.phone,
  parametres: { mfaObligatoire: e.settings?.mfaObligatoire ?? true },
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
      parametres: z.object({ mfaObligatoire: z.boolean().optional() }).optional(),
    }).parse(req.body);
    if (d.parametres) exiger(ctx, "company.admin");   // paramètre de sécurité : droit renforcé
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
}
