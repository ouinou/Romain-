import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exiger, exigerConfirmation, proteger, type Dependances } from "../contexte.js";
import { genererCodeMaitre, normaliserCodeMaitre } from "../../securite/code-maitre.js";
import { hacherMotDePasse } from "../../securite/motdepasse.js";
import { createHash } from "node:crypto";
import { UUID } from "../../db.js";
import { ErreurHttp } from "../erreurs.js";

/** Couleurs par défaut du logiciel (bleu nuit, orange vif) ; chaque entreprise peut choisir les siennes. */
export const COULEURS_DEFAUT = { principale: "#062b68", accent: "#0647a9" };   // FINEXA ERP : bleu marine, bleu
const COULEUR = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur au format #RRGGBB.");
export const profilDe = (settings: any) => {
  const p = settings?.profil ?? {};
  return {
    email: (p.email as string) ?? null, regimeFiscal: (p.regimeFiscal as string) ?? null, patente: (p.patente as string) ?? null,
    couleurs: { principale: p.couleurs?.principale ?? COULEURS_DEFAUT.principale, accent: p.couleurs?.accent ?? COULEURS_DEFAUT.accent },
    logoId: (p.logoId as string) ?? null,
    logoUrl: p.logoId ? `/api/entreprise/logos/${p.logoId}` : null,
  };
};
const LOGO_MAX = 512 * 1024;
/** Type réel d'après les premiers octets (on ne fait pas confiance à l'extension ni au type déclaré). SVG refusé (script possible). */
function typeImage(b: Buffer): "image/png" | "image/jpeg" | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

const vue = (e: Record<string, any>) => ({
  id: e.id, code: e.company_code, raisonSociale: e.legal_name, statut: e.status, pays: e.country_code, devise: e.currency_code,
  rccm: e.rccm, niu: e.niu, adresse: e.address, telephone: e.phone, ...profilDe(e.settings),
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
      email: z.string().trim().email("Adresse e-mail invalide.").max(254).nullable().optional().or(z.literal("").transform(() => null)),
      regimeFiscal: z.string().trim().max(80).nullable().optional(),
      patente: z.string().trim().max(60).nullable().optional(),        // Numéro de la patente (contribution des patentes)
      couleurs: z.object({ principale: COULEUR, accent: COULEUR }).optional(),
      parametres: z.object({
        mfaObligatoire: z.boolean().optional(),
        // Comptes désactivés après N jours sans connexion ; 0 = jamais.
        inactiviteJours: z.number().int().min(0).max(3650).optional(),
      }).optional(),
    }).parse(req.body);
    if (d.parametres) { exiger(ctx, "company.admin"); exigerConfirmation(ctx); }   // paramètres de sécurité
    const { rows: [avant] } = await ctx.c.query("SELECT * FROM companies WHERE id = $1 FOR UPDATE", [ctx.entrepriseId]);
    const profil = { ...(avant.settings?.profil ?? {}) };
    for (const k of ["email", "regimeFiscal", "patente", "couleurs"] as const) if (d[k] !== undefined) profil[k] = d[k] || null;
    const settings = { ...avant.settings, ...(d.parametres ?? {}), profil };
    const champ = <T>(v: T | undefined, actuel: T) => (v === undefined ? actuel : v);
    const { rows: [apres] } = await ctx.c.query(
      "UPDATE companies SET legal_name = $2, rccm = $3, niu = $4, address = $5, phone = $6, settings = $7 WHERE id = $1 RETURNING *",
      [ctx.entrepriseId, champ(d.raisonSociale, avant.legal_name), champ(d.rccm, avant.rccm), champ(d.niu, avant.niu),
       champ(d.adresse, avant.address), champ(d.telephone, avant.phone), JSON.stringify(settings)]);
    await ctx.journaliser({ type: d.parametres ? "security" : "company", action: d.parametres ? "security_settings_change" : "update",
      objetType: "company", objetId: ctx.entrepriseId, avant: vue(avant), apres: vue(apres) });
    return vue(apres);
  }));

  // Apparence (nom, couleurs, logo) : nécessaire à tout utilisateur connecté pour afficher l'interface aux couleurs de l'entreprise.
  app.get("/api/entreprise/apparence", proteger(deps, { permission: null }, async (_req, ctx) => {
    const { rows: [e] } = await ctx.c.query("SELECT legal_name, settings FROM companies WHERE id = $1", [ctx.entrepriseId]);
    const p = profilDe(e.settings);
    return { raisonSociale: e.legal_name, couleurs: p.couleurs, logoId: p.logoId, logoUrl: p.logoUrl };
  }));

  // Image d'un logo (version figée : mise en cache sans limite par le navigateur).
  app.get("/api/entreprise/logos/:id", proteger(deps, { permission: null }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw new ErreurHttp(404, "introuvable", "Logo introuvable.");
    const { rows: [l] } = await ctx.c.query("SELECT mime, data FROM company_logos WHERE id = $1", [id]);
    if (!l) throw new ErreurHttp(404, "introuvable", "Logo introuvable.");
    ctx.rep.header("content-type", l.mime).header("cache-control", "private, max-age=31536000, immutable");
    return l.data as Buffer;
  }));

  // Nouveau logo : PNG ou JPEG, 512 Kio au plus, envoyé en base64. L'ancien reste conservé (factures déjà émises).
  app.post("/api/entreprise/logo", proteger(deps, { permission: "company.update" }, async (req, ctx) => {
    const d = z.object({ image: z.string().max(Math.ceil(LOGO_MAX * 4 / 3) + 100) }).parse(req.body);
    const data = Buffer.from(d.image.replace(/^data:image\/[a-z]+;base64,/, ""), "base64");
    if (data.length > LOGO_MAX) throw new ErreurHttp(400, "logo_trop_lourd", "Le logo dépasse 512 Kio. Réduisez sa taille (300 × 300 pixels suffisent).");
    const mime = typeImage(data);
    if (!mime) throw new ErreurHttp(400, "logo_format", "Format refusé : envoyez une image PNG ou JPEG.");
    const { rows: [l] } = await ctx.c.query("INSERT INTO company_logos (mime, data, sha256, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
      [mime, data, createHash("sha256").update(data).digest(), ctx.utilisateur.id]);
    await ctx.c.query("UPDATE companies SET settings = jsonb_set(settings, '{profil}', coalesce(settings->'profil', '{}'::jsonb) || jsonb_build_object('logoId', $2::text)) WHERE id = $1", [ctx.entrepriseId, l.id]);
    await ctx.journaliser({ type: "company", action: "logo_change", objetType: "company", objetId: ctx.entrepriseId, details: { logo: l.id, octets: data.length, type: mime } });
    return { logoId: l.id };
  }));

  app.delete("/api/entreprise/logo", proteger(deps, { permission: "company.update" }, async (_req, ctx) => {
    await ctx.c.query("UPDATE companies SET settings = jsonb_set(settings, '{profil}', coalesce(settings->'profil', '{}'::jsonb) - 'logoId') WHERE id = $1", [ctx.entrepriseId]);
    await ctx.journaliser({ type: "company", action: "logo_remove", objetType: "company", objetId: ctx.entrepriseId });
    return { ok: true };
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
