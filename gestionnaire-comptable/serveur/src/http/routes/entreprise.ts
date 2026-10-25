import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CHAMPS_JSON, PAYS_OHADA, SCHEMA_PROFIL, enteteEtat, identiteDocument, incoherence, memoriserIdentite, profilDe } from "../../domaine/profil-entreprise.js";
import { exiger, exigerConfirmation, proteger, type Dependances } from "../contexte.js";
import { genererCodeMaitre, normaliserCodeMaitre } from "../../securite/code-maitre.js";
import { hacherMotDePasse } from "../../securite/motdepasse.js";
import { createHash } from "node:crypto";
import { UUID, type Client } from "../../db.js";
import { ErreurHttp } from "../erreurs.js";

const IMAGE_MAX = 512 * 1024;
/** Type réel d'après les premiers octets (on ne fait pas confiance à l'extension ni au type déclaré). SVG refusé (script possible). */
function typeImage(b: Buffer): "image/png" | "image/jpeg" | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** Exercice comptable en cours (affiché dans le profil ; il se gère dans Comptabilité, Exercices et paramètres). */
async function exerciceEnCours(c: Client) {
  const { rows: [x] } = await c.query(
    "SELECT code, start_date::text AS du, end_date::text AS au FROM fiscal_years WHERE status = 'open' ORDER BY start_date DESC LIMIT 1");
  return x ? { code: x.code as string, du: x.du as string, au: x.au as string } : null;
}

const vue = async (c: Client, e: Record<string, any>) => {
  const f = e.settings?.fiscal ?? {};
  return {
    id: e.id, code: e.company_code, raisonSociale: e.legal_name, statut: e.status, pays: e.country_code, paysNom: PAYS_OHADA[e.country_code] ?? e.country_code,
    devise: e.currency_code, rccm: e.rccm, niu: e.niu, adresse: e.address, telephone: e.phone, ...profilDe(e.settings),
    fiscal: { tvaApplicable: !!f.tvaApplicable, tauxTvaPdm: f.tvaApplicable ? Number(f.tauxTvaPdm ?? 0) : 0 },
    exercice: await exerciceEnCours(c),
    identiteDocument: identiteDocument(e),
    parametres: { mfaObligatoire: e.settings?.mfaObligatoire ?? true, inactiviteJours: e.settings?.inactiviteJours ?? 90 },
    codeMaitre: { actif: !!e.master_code_hash, creeLe: e.master_code_created_at, bloque: !!e.master_code_locked_until && new Date(e.master_code_locked_until) > new Date() },
  };
};
/** Vue courte pour le journal d'audit (sans le code maître ni l'identité calculée). */
const pourJournal = (e: Record<string, any>) => ({ raisonSociale: e.legal_name, rccm: e.rccm, niu: e.niu, adresse: e.address, telephone: e.phone, ...profilDe(e.settings) });

export function routesEntreprise(app: FastifyInstance, deps: Dependances) {
  app.get("/api/entreprise", proteger(deps, { permission: "company.read" }, async (_req, ctx) => {
    const { rows: [e] } = await ctx.c.query("SELECT * FROM companies WHERE id = $1", [ctx.entrepriseId]);
    return vue(ctx.c, e);
  }));

  app.patch("/api/entreprise", proteger(deps, { permission: "company.update" }, async (req, ctx) => {
    const { rows: [avant] } = await ctx.c.query("SELECT * FROM companies WHERE id = $1 FOR UPDATE", [ctx.entrepriseId]);
    // Un champ renvoyé tel quel n'est pas revalidé : une valeur saisie avant les contrôles actuels (téléphone avec du texte,
    // par exemple) ne bloque pas l'enregistrement des autres rubriques. Elle sera contrôlée le jour où on la modifie.
    const actuel: Record<string, unknown> = { ...pourJournal(avant) };
    const corps = Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).filter(([k, v]) => {
      if (!(k in actuel) || k === "affichage" || k === "couleurs" || k === "banque") return true;
      const norm = (x: unknown) => (typeof x === "string" ? x.trim() || null : x ?? null);
      return JSON.stringify(norm(v)) !== JSON.stringify(norm(actuel[k]));
    }));
    const d = SCHEMA_PROFIL.extend({
      parametres: z.object({
        mfaObligatoire: z.boolean().optional(),
        // Comptes désactivés après N jours sans connexion ; 0 = jamais.
        inactiviteJours: z.number().int().min(0).max(3650).optional(),
      }).optional(),
    }).parse(corps);
    if (d.parametres) { exiger(ctx, "company.admin"); exigerConfirmation(ctx); }   // paramètres de sécurité
    const profil: Record<string, unknown> = { ...(avant.settings?.profil ?? {}) };
    for (const k of CHAMPS_JSON) {
      const v = d[k];
      if (v === undefined) continue;
      if (k === "affichage") profil.affichage = { ...(profil.affichage as object ?? {}), ...(v as object) };
      else if (k === "banque") profil.banque = v && Object.values(v as object).some(Boolean) ? v : null;
      else profil[k] = Array.isArray(v) ? v : v ?? null;
    }
    const settings = { ...avant.settings, ...(d.parametres ?? {}), profil };
    const probleme = incoherence(profilDe(settings), settings.fiscal);
    if (probleme) throw new ErreurHttp(400, "profil_incoherent", probleme);
    const champ = <T>(v: T | undefined, actuel: T) => (v === undefined ? actuel : v);
    const { rows: [apres] } = await ctx.c.query(
      "UPDATE companies SET legal_name = $2, rccm = $3, niu = $4, address = $5, phone = $6, settings = $7 WHERE id = $1 RETURNING *",
      [ctx.entrepriseId, champ(d.raisonSociale, avant.legal_name), champ(d.rccm, avant.rccm), champ(d.niu, avant.niu),
       champ(d.adresse, avant.address), champ(d.telephone, avant.phone), JSON.stringify(settings)]);
    await memoriserIdentite(ctx.c, ctx.entrepriseId);
    await ctx.journaliser({ type: d.parametres ? "security" : "company", action: d.parametres ? "security_settings_change" : "update",
      objetType: "company", objetId: ctx.entrepriseId, avant: pourJournal(avant), apres: pourJournal(apres) });
    const { rows: [relu] } = await ctx.c.query("SELECT * FROM companies WHERE id = $1", [ctx.entrepriseId]);
    return vue(ctx.c, relu);
  }));

  // Apparence et identité courte : nécessaires à tout utilisateur connecté (couleurs de l'écran, en-tête des états imprimés).
  app.get("/api/entreprise/apparence", proteger(deps, { permission: null }, async (_req, ctx) => {
    const { rows: [e] } = await ctx.c.query("SELECT legal_name, address, phone, niu, rccm, country_code, currency_code, settings FROM companies WHERE id = $1", [ctx.entrepriseId]);
    const p = profilDe(e.settings);
    return { raisonSociale: e.legal_name, nomCommercial: p.nomCommercial, sigle: p.sigle, couleurs: p.couleurs, logoId: p.logoId, logoUrl: p.logoUrl,
      etat: enteteEtat(identiteDocument(e)) };
  }));

  // Image (logo ou cachet), version figée : mise en cache sans limite par le navigateur.
  app.get("/api/entreprise/logos/:id", proteger(deps, { permission: null }, async (req, ctx) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw new ErreurHttp(404, "introuvable", "Image introuvable.");
    const { rows: [l] } = await ctx.c.query("SELECT mime, data FROM company_logos WHERE id = $1", [id]);
    if (!l) throw new ErreurHttp(404, "introuvable", "Image introuvable.");
    ctx.rep.header("content-type", l.mime).header("cache-control", "private, max-age=31536000, immutable");
    return l.data as Buffer;
  }));

  // Logo et cachet (ou signature scannée) : PNG ou JPEG, 512 Kio au plus, envoyés en base64.
  // Chaque envoi crée une version ; l'ancienne reste conservée pour les documents déjà émis.
  for (const [chemin, cle, nom] of [["logo", "logoId", "logo"], ["cachet", "cachetId", "cachet"]] as const) {
    app.post(`/api/entreprise/${chemin}`, proteger(deps, { permission: "company.update" }, async (req, ctx) => {
      const d = z.object({ image: z.string().max(Math.ceil(IMAGE_MAX * 4 / 3) + 100) }).parse(req.body);
      const data = Buffer.from(d.image.replace(/^data:image\/[a-z]+;base64,/, ""), "base64");
      if (data.length > IMAGE_MAX) throw new ErreurHttp(400, `${nom}_trop_lourd`, `Le ${nom} dépasse 512 Kio. Réduisez sa taille (300 × 300 pixels suffisent).`);
      const mime = typeImage(data);
      if (!mime) throw new ErreurHttp(400, `${nom}_format`, "Format refusé : envoyez une image PNG ou JPEG.");
      const { rows: [l] } = await ctx.c.query("INSERT INTO company_logos (mime, data, sha256, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [mime, data, createHash("sha256").update(data).digest(), ctx.utilisateur.id]);
      await ctx.c.query("UPDATE companies SET settings = jsonb_set(settings, '{profil}', coalesce(settings->'profil', '{}'::jsonb) || jsonb_build_object($3::text, $2::text)) WHERE id = $1",
        [ctx.entrepriseId, l.id, cle]);
      await memoriserIdentite(ctx.c, ctx.entrepriseId);
      await ctx.journaliser({ type: "company", action: `${nom}_change`, objetType: "company", objetId: ctx.entrepriseId, details: { image: l.id, octets: data.length, type: mime } });
      return { [cle]: l.id };
    }));

    app.delete(`/api/entreprise/${chemin}`, proteger(deps, { permission: "company.update" }, async (_req, ctx) => {
      await ctx.c.query("UPDATE companies SET settings = jsonb_set(settings, '{profil}', coalesce(settings->'profil', '{}'::jsonb) - $2::text) WHERE id = $1", [ctx.entrepriseId, cle]);
      await memoriserIdentite(ctx.c, ctx.entrepriseId);
      await ctx.journaliser({ type: "company", action: `${nom}_remove`, objetType: "company", objetId: ctx.entrepriseId });
      return { ok: true };
    }));
  }

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
