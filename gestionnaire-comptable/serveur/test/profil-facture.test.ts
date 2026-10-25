import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { PNG } from "pngjs";
import jsQRModule from "jsqr";
// jsqr est publié en CommonJS : selon le chargeur, la fonction est l'export par défaut ou sa propriété « default ».
const jsQR = ((jsQRModule as unknown as { default?: unknown }).default ?? jsQRModule) as unknown as typeof import("jsqr").default;
import { Agent, entrepriseActive, journal, preparer, utilisateurAvecRole, type Env } from "./aide.js";

/** Profil d'entreprise (logo, couleurs, régime fiscal, patente), en-tête des factures et code QR de vérification. */
const AUJ = new Date().toISOString().slice(0, 10);
let env: Env;
let e: Awaited<ReturnType<typeof entrepriseActive>>;
let daf: Agent, caissier: Agent, dg: Agent;
let caisse: string;
let logo1: string;
let facture: { id: string; numero: string; totalTtc: number; codeVerification: string; vendeur: Record<string, any> };

const image = async (texte: string) => (await QRCode.toBuffer(texte, { width: 120 })).toString("base64");   // un PNG valide quelconque
const vente = (agent: Agent, compte?: string) => agent.post("/api/ventes/factures", {
  date: AUJ, client: { nom: "Client fictif QR" }, lignes: [{ designation: "Prestation de conseil", quantite: 1, prixUnitaire: 20000, nature: "service" }],
  paiement: compte ? { mode: "comptant", compteTresorerieId: compte } : { mode: "credit" },
});

before(async () => {
  env = await preparer();
  e = await entrepriseActive(env, "PROFIL-01", { mfa: false });
  daf = (await utilisateurAvecRole(env, e, "finance_director", "daf@profil-01.cm")).agent;
  const c = await utilisateurAvecRole(env, e, "cashier", "caisse@profil-01.cm");
  caissier = c.agent;
  dg = (await utilisateurAvecRole(env, e, "general_manager", "dg@profil-01.cm")).agent;
  await daf.patch("/api/ventes/parametres", { tvaApplicable: true, tauxTvaPdm: 1925, mentionsFacture: "" });
  caisse = (await daf.post("/api/tresorerie/comptes", { type: "caisse", nom: "Caisse boutique" })).corps.id;
  await daf.patch(`/api/tresorerie/comptes/${caisse}`, { caissiers: [c.id] });
});
after(async () => { await env?.fermer(); });

describe("Profil d'entreprise", () => {
  test("Coordonnées, régime fiscal, patente et couleurs ; couleur invalide refusée", async () => {
    const r = await e.admin.patch("/api/entreprise", { raisonSociale: "Profil Démo SARL", adresse: "Bonapriso, Douala", telephone: "+237 600 11 22 33",
      email: "contact@profil-demo.cm", niu: "M000000000002X", rccm: "RC/DLA/2026/B/0002", regimeFiscal: "Régime du réel", patente: "PAT-2026-0042",
      couleurs: { principale: "#0b5d3b", accent: "#f2c200" } });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.deepEqual([r.corps.regimeFiscal, r.corps.patente, r.corps.email, r.corps.couleurs], ["Régime du réel", "PAT-2026-0042", "contact@profil-demo.cm", { principale: "#0b5d3b", accent: "#f2c200" }]);
    assert.equal(r.corps.code, "PROFIL-01");
    assert.equal((await e.admin.patch("/api/entreprise", { couleurs: { principale: "vert", accent: "#f2c200" } })).statut, 400);
    assert.equal((await caissier.patch("/api/entreprise", { couleurs: { principale: "#000000", accent: "#ffffff" } })).statut, 403);
    // Tout utilisateur connecté reçoit l'apparence (pour afficher l'interface aux couleurs de l'entreprise).
    const a = await caissier.get("/api/entreprise/apparence");
    assert.deepEqual([a.statut, a.corps.raisonSociale, a.corps.couleurs.principale], [200, "Profil Démo SARL", "#0b5d3b"]);
  });

  test("Logo : PNG accepté, SVG ou faux fichier refusés, taille limitée, versions conservées", async () => {
    assert.equal((await caissier.post("/api/entreprise/logo", { image: await image("x") })).statut, 403);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    assert.equal((await e.admin.post("/api/entreprise/logo", { image: svg })).corps.erreur.code, "logo_format");
    assert.equal((await e.admin.post("/api/entreprise/logo", { image: Buffer.from("pas une image du tout").toString("base64") })).statut, 400);
    const lourd = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600 * 1024)]).toString("base64");
    assert.equal((await e.admin.post("/api/entreprise/logo", { image: lourd })).statut, 400);
    const r = await e.admin.post("/api/entreprise/logo", { image: "data:image/png;base64," + await image("logo 1") });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    logo1 = r.corps.logoId;
    const img = await caissier.req("GET", `/api/entreprise/logos/${logo1}`);
    assert.deepEqual([img.statut, img.brut.headers["content-type"]], [200, "image/png"]);
    assert.equal((await caissier.get("/api/entreprise/apparence")).corps.logoId, logo1);
    await assert.rejects(env.pool.query("UPDATE company_logos SET data = 'x'"), /interdit|not allowed|forbid|permission/i);
    assert.ok((await journal(env, e.entrepriseId)).some((x) => x.action === "logo_change"));
  });
});

describe("Facture : en-tête, logo et code QR", () => {
  test("La facture fige l'identité complète du vendeur, logo et couleurs compris", async () => {
    const r = await vente(caissier, caisse);
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    facture = r.corps;
    assert.deepEqual(
      [facture.vendeur.raisonSociale, facture.vendeur.email, facture.vendeur.regimeFiscal, facture.vendeur.patente, facture.vendeur.logoId, facture.vendeur.couleurs.principale],
      ["Profil Démo SARL", "contact@profil-demo.cm", "Régime du réel", "PAT-2026-0042", logo1, "#0b5d3b"]);
    assert.match(facture.codeVerification, new RegExp(`^GC1;PROFIL-01;${facture.numero};${AUJ};${facture.totalTtc};XAF;[A-Za-z0-9_-]{86}$`));
    // Un nouveau logo ne change pas les factures déjà émises.
    await e.admin.post("/api/entreprise/logo", { image: await image("logo 2") });
    const relue = (await dg.get(`/api/ventes/factures/${facture.id}`)).corps;
    assert.equal(relue.vendeur.logoId, logo1);
    assert.equal(relue.codeVerification, facture.codeVerification, "code identique à chaque lecture (signature déterministe)");
  });

  test("PDF : en-tête complet, logo et QR imprimés ; le QR lu sur le PDF est le code de vérification", async () => {
    const r = await caissier.req("GET", `/api/ventes/factures/${facture.id}/pdf`);
    assert.equal(r.statut, 200);
    const dossier = mkdtempSync(join(tmpdir(), "gc-qr-"));
    try {
      writeFileSync(join(dossier, "f.pdf"), r.brut.rawPayload);
      const texte = execFileSync("pdftotext", ["-layout", join(dossier, "f.pdf"), "-"]).toString();
      for (const attendu of ["Profil Démo SARL", "Bonapriso, Douala", "+237 600 11 22 33", "contact@profil-demo.cm", "NIU : M000000000002X",
        "RCCM : RC/DLA/2026/B/0002", "Régime fiscal : Régime du réel", "Patente : PAT-2026-0042", "Vérifier une facture"])
        assert.ok(texte.includes(attendu), `« ${attendu} » absent du PDF :\n${texte}`);
      execFileSync("pdfimages", ["-png", join(dossier, "f.pdf"), join(dossier, "img")]);
      const images = readdirSync(dossier).filter((f) => f.startsWith("img")).sort();
      assert.ok(images.length >= 2, "logo et QR présents : " + images.join(", "));
      const lus = images.map((f) => { const p = PNG.sync.read(readFileSync(join(dossier, f))); return jsQR(new Uint8ClampedArray(p.data), p.width, p.height)?.data; });
      assert.ok(lus.includes(facture.codeVerification), "QR du PDF lisible et identique au code : " + JSON.stringify(lus));
    } finally { rmSync(dossier, { recursive: true, force: true }); }
  });

  test("Vérification : authentique ; montant, numéro ou signature modifiés refusés ; tracée", async () => {
    const ok = await dg.post("/api/ventes/verification", { contenu: facture.codeVerification });
    assert.equal(ok.statut, 200);
    assert.equal(ok.corps.authentique, true, JSON.stringify(ok.corps));
    assert.deepEqual([ok.corps.facture.numero, ok.corps.facture.totalTtc, ok.corps.facture.client], [facture.numero, facture.totalTtc, "Client fictif QR"]);
    const p = facture.codeVerification.split(";");
    const altere = (i: number, v: string) => { const q = [...p]; q[i] = v; return q.join(";"); };
    for (const faux of [altere(4, String(facture.totalTtc + 1000)), altere(2, facture.numero.replace(/\d$/, "9")), altere(6, p[6].slice(0, -2) + (p[6].endsWith("AA") ? "BB" : "AA")), "n'importe quoi"]) {
      const r = await dg.post("/api/ventes/verification", { contenu: faux });
      assert.equal(r.corps.authentique, false, faux);
      assert.ok(r.corps.raison.length > 10);
    }
    const ev = await journal(env, e.entrepriseId);
    assert.ok(ev.filter((x) => x.action === "invoice_verify").length >= 5);
    assert.equal((await daf.post("/api/ventes/verification", { contenu: "" })).statut, 400);
  });

  test("Clé de signature chiffrée et intangible ; une autre entreprise ne valide pas ce code", async () => {
    const { rows: [k] } = await env.superu.query("SELECT private_key_enc FROM company_signing_keys WHERE company_id = $1", [e.entrepriseId]);
    assert.ok(!/PRIVATE KEY/.test(k.private_key_enc));
    await assert.rejects(env.pool.query("DELETE FROM company_signing_keys"), /interdit|not allowed|forbid|permission/i);
    const autre = await entrepriseActive(env, "PROFIL-02", { mfa: false });
    const dafB = (await utilisateurAvecRole(env, autre, "finance_director", "daf@profil-02.cm")).agent;
    const r = await dafB.post("/api/ventes/verification", { contenu: facture.codeVerification });
    assert.equal(r.corps.authentique, false);
    assert.match(r.corps.raison, /autre entreprise/);
    // Même en se faisant passer pour l'entreprise d'origine, la clé de PROFIL-02 ne valide pas la signature.
    await dafB.patch("/api/ventes/parametres", { tvaApplicable: false, tauxTvaPdm: 0, mentionsFacture: "" });
    const fB = (await vente(dafB)).corps;
    const forge = fB.codeVerification.replace("PROFIL-02", "PROFIL-01");
    assert.equal((await dg.post("/api/ventes/verification", { contenu: forge })).corps.authentique, false);
  });
});

describe("Ventes en direct", () => {
  test("Le DG et la caisse voient les factures du jour ; un rafraîchissement automatique ne prolonge pas la session", async () => {
    const l = (await dg.get(`/api/ventes/factures?du=${AUJ}&au=${AUJ}&taille=100`)).corps;
    assert.ok(l.elements.some((x: { numero: string; creeLe: string }) => x.numero === facture.numero && !!x.creeLe));
    assert.ok((await caissier.get(`/api/ventes/factures?du=${AUJ}&au=${AUJ}`)).corps.total >= 1);
    // Session inactive depuis 14 minutes : la requête automatique est servie mais ne remet pas le compteur à zéro.
    const sid = async () => (await env.superu.query("SELECT s.id FROM user_sessions s JOIN app_users u ON u.id = s.user_id WHERE u.email = 'dg@profil-01.cm' AND s.revoked_at IS NULL")).rows[0].id;
    const id = await sid();
    await env.superu.query("UPDATE user_sessions SET last_seen_at = now() - interval '14 minutes' WHERE id = $1", [id]);
    assert.equal((await dg.req("GET", "/api/ventes/factures", undefined, { "x-gc-automatique": "1" })).statut, 200);
    const { rows: [s] } = await env.superu.query("SELECT now() - last_seen_at > interval '13 minutes' AS ancien FROM user_sessions WHERE id = $1", [id]);
    assert.equal(s.ancien, true, "last_seen_at inchangé");
    await env.superu.query("UPDATE user_sessions SET last_seen_at = now() - interval '16 minutes' WHERE id = $1", [id]);
    const r = await dg.req("GET", "/api/notifications", undefined, { "x-gc-automatique": "1" });
    assert.deepEqual([r.statut, r.corps.erreur.code], [401, "session_invalide"]);
  });
});
