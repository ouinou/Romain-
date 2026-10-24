/**
 * SERVEUR SIMULÉ — uniquement pour la version de démonstration (vite build --mode demo).
 * Il imite l'API dans le navigateur, avec des données fictives en mémoire (perdues au rechargement),
 * pour valider l'ergonomie sans installer le serveur. Il n'offre AUCUNE sécurité réelle :
 * le vrai contrôle se fait dans serveur/ (PostgreSQL, Argon2id, RLS, journal chaîné).
 */
import { definirTransport } from "../api";
import { traiterComptabilite, initialiserComptabilite } from "./comptabilite-simulee";
import { traiterTresorerie, initialiserTresorerie } from "./tresorerie-simulee";

const MDP_DEMO = "Demonstration-2026!";
const CODE = "GC-DEMO-2026";
type Statut = "invited" | "active" | "disabled";

const p = (m: string, ...a: string[]) => a.map((x) => `${m}.${x}`);
const METIER = ["accounting", "treasury", "cash", "sales", "purchases", "stock", "reports"];
const MODULES: [string, string][] = [["users", "Utilisateurs"], ["roles", "Rôles et permissions"], ["audit", "Journal d'audit"], ["company", "Paramètres de l'entreprise"], ["backups", "Sauvegardes"], ["accounting", "Comptabilité générale"], ["treasury", "Trésorerie et banques"], ["cash", "Caisse"], ["sales", "Ventes et clients"], ["purchases", "Achats et fournisseurs"], ["stock", "Stocks"], ["hr", "Ressources humaines"], ["payroll", "Paie"], ["reports", "Rapports et états financiers"]];
const ACTIONS: [string, string][] = [["read", "Consulter"], ["create", "Créer"], ["update", "Modifier"], ["submit", "Soumettre"], ["approve", "Valider"], ["cancel", "Annuler"], ["archive", "Archiver"], ["print", "Imprimer"], ["export", "Exporter"], ["admin", "Administrer"]];

let seq = 0;
const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${++seq}-${Math.random().toString(16).slice(2)}`);
const jeton = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
const ilYa = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

interface Role { id: string; cle: string; libelle: string; description: string | null; systeme: boolean; mfaRequise: boolean; archiveLe: string | null; permissions: string[] }
interface Util { id: string; email: string; nom: string; statut: Statut; verrouille: boolean; accesExpireLe: string | null; derniereConnexion: string | null; creeLe: string; mfaActive: boolean; roles: string[]; jeton?: string }
interface Evt { sequence: number; id: string; date: string; type: string; action: string; resultat: "success" | "denied" | "failure"; objetType: string | null; objetId: string | null; avant: unknown; apres: unknown; motif: string | null; details: Record<string, unknown>; ip: string | null; acteurId: string | null; empreinte: string }

const role = (cle: string, libelle: string, description: string, mfa: boolean, perms: string[]): Role =>
  ({ id: id(), cle, libelle, description, systeme: true, mfaRequise: mfa, archiveLe: null, permissions: perms.sort() });
const roles: Role[] = [
  role("company_admin", "Administrateur de l'entreprise", "Gère les comptes, les rôles et les paramètres. Aucun accès financier par défaut.", true,
    [...p("users", "read", "create", "update", "archive", "admin"), ...p("roles", "read", "create", "update", "archive", "admin"), ...p("company", "read", "update", "admin"), ...p("audit", "read", "export"), ...p("backups", "read", "create")]),
  role("general_manager", "Directeur général", "Vue d'ensemble, rapports de direction et validation selon le circuit défini.", true,
    [...METIER.flatMap((m) => p(m, "read")), ...p("reports", "print", "export"), ...p("accounting", "approve"), ...p("treasury", "approve"), ...p("purchases", "approve"), ...p("audit", "read"), ...p("users", "read"), ...p("company", "read")]),
  role("finance_director", "Directeur financier", "Finances, trésorerie et rapports détaillés ; validation selon délégation.", true,
    [...p("accounting", "read", "create", "update", "submit", "approve", "cancel", "print", "export", "admin"), ...p("treasury", "read", "create", "update", "submit", "approve", "cancel", "print", "export", "admin"),
     ...p("cash", "read", "approve", "print"), ...p("sales", "read", "create", "print"), ...p("purchases", "read", "approve", "print"), ...p("payroll", "read", "approve"), ...p("reports", "read", "print", "export")]),
  role("accountant", "Comptable", "Écritures et pièces. Banques, paie et résultats globaux sur autorisation explicite.", false,
    [...p("accounting", "read", "create", "update", "submit", "cancel", "print", "export"), ...p("sales", "read"), ...p("purchases", "read")]),
  role("cashier", "Caissier", "Mouvements de caisse et solde de sa caisse uniquement.", false, [...p("cash", "read", "create", "submit", "print"), ...p("sales", "read", "create", "print")]),
  role("stock_manager", "Gestionnaire de stocks", "Articles, inventaires et mouvements de stock.", false, [...p("stock", "read", "create", "update", "submit", "print", "export"), ...p("purchases", "read")]),
  role("purchasing_manager", "Responsable des achats", "Demandes d'achat, commandes et fournisseurs.", false, [...p("purchases", "read", "create", "update", "submit", "cancel", "print"), ...p("stock", "read")]),
  role("auditor", "Auditeur", "Lecture seule dans le périmètre de mission, journal compris.", true, [...METIER.flatMap((m) => p(m, "read", "print")), ...p("audit", "read", "export")]),
  role("hr_manager", "Responsable des ressources humaines", "Dossiers du personnel et préparation de la paie.", true, [...p("hr", "read", "create", "update", "submit", "archive", "print", "export"), ...p("payroll", "read", "create", "update", "submit", "print")]),
  role("employee", "Employé", "Aucun accès par défaut en dehors de son propre compte.", false, []),
];
const R = (cle: string) => roles.find((r) => r.cle === cle)!.id;

const util = (nom: string, email: string, cle: string, statut: Statut, derniere: number | null): Util =>
  ({ id: id(), email, nom, statut, verrouille: false, accesExpireLe: null, derniereConnexion: derniere === null ? null : ilYa(derniere), creeLe: ilYa(60 * 24 * 40), mfaActive: false, roles: [R(cle)] });
const utilisateurs: Util[] = [
  util("Mariam Saleh", "mariam.saleh@demo.cm", "company_admin", "active", 60 * 20),
  util("Paul Ngaro", "paul.ngaro@demo.cm", "accountant", "active", 95),
  util("Amina Mahamat", "amina.mahamat@demo.cm", "cashier", "active", 130),
  util("Jean Bemba", "jean.bemba@demo.cm", "stock_manager", "active", 60 * 26),
  util("Nadia Koyom", "nadia.koyom@demo.cm", "purchasing_manager", "active", 60 * 30),
  util("Ousmane Djibrine", "ousmane.djibrine@demo.cm", "finance_director", "active", 60 * 3),
  util("Joseph Atangana", "joseph.atangana@demo.cm", "general_manager", "active", 60 * 24 * 2),
  util("Rachel Ewane", "rachel.ewane@demo.cm", "hr_manager", "invited", null),
  util("Auditeur externe", "audit@demo.cm", "auditor", "disabled", 60 * 24 * 12),
];
const entreprise = { id: id(), code: CODE, raisonSociale: "ITI Démonstration SARL", statut: "active", pays: "CM", devise: "XAF", rccm: "RC/DLA/2026/B/0000 (fictif)", niu: "M000000000000X (fictif)", adresse: "Douala (adresse fictive)", telephone: "+237 600 00 00 00 (fictif)" as string | null,
  email: "contact@demo.cm" as string | null, regimeFiscal: "Régime du réel (à vérifier)" as string | null, patente: "PAT-DEMO-0000 (fictif)" as string | null,
  couleurs: { principale: "#101d35", accent: "#ff6a00" }, logoId: null as string | null, logoUrl: null as string | null,
  parametres: { mfaObligatoire: false, inactiviteJours: 90 }, codeMaitre: { actif: true, creeLe: ilYa(60 * 24 * 40), bloque: false } };
const journal: Evt[] = [];
const notifications: { id: string; type: "info" | "warning" | "security"; titre: string; texte: string; date: string; lus: Set<string>; pour: string | null; permission: string | null }[] = [];

let session: { utilisateurId: string; id: string; confirmeJusqua: number; creeLe: string } | null = null;

function empreinte(e: Omit<Evt, "empreinte">, prec: string) {
  // Empreinte simulée (non cryptographique) : le vrai serveur utilise SHA-256 calculé par PostgreSQL.
  let h = 2166136261; const s = prec + JSON.stringify(e);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
}
function tracer(e: Partial<Evt> & { type: string; action: string }, quand = new Date().toISOString()) {
  const base = { sequence: journal.length + 1, id: id(), date: quand, resultat: "success" as const, objetType: null, objetId: null, avant: null, apres: null, motif: null, details: {}, ip: "192.168.1.24", acteurId: session?.utilisateurId ?? null, ...e };
  journal.push({ ...base, empreinte: empreinte(base, journal.at(-1)?.empreinte ?? "") });
}
// Historique de départ
[["company", "create", null], ["users", "invite", null], ...utilisateurs.slice(1).map(() => ["users", "create", null])].forEach(([t, a], i) => tracer({ type: t as string, action: a as string, acteurId: null, ip: null }, ilYa(60 * 24 * 40 - i)));
tracer({ type: "auth", action: "login", acteurId: utilisateurs[1].id }, ilYa(95));
tracer({ type: "security", action: "access_denied", resultat: "denied", acteurId: utilisateurs[2].id, details: { permission: "users.read" } }, ilYa(125));
tracer({ type: "auth", action: "login", resultat: "failure", acteurId: utilisateurs[3].id, details: { raison: "mot_de_passe" } }, ilYa(70));
notifications.push({ id: id(), type: "security", titre: "Accès refusé", texte: "Amina Mahamat a tenté d'ouvrir la liste des utilisateurs (droit non accordé).", date: ilYa(125), lus: new Set(), pour: null, permission: "users.admin" });

/* ------------------------------------------------------------------ outils */
class E { constructor(public s: number, public code: string, public message: string) {} }
const moi = () => utilisateurs.find((u) => u.id === session?.utilisateurId)!;
const permsDe = (u: Util) => new Set(u.roles.flatMap((r) => roles.find((x) => x.id === r && !x.archiveLe)?.permissions ?? []));
function exiger(perm: string | null, sensible = false) {
  if (!session) throw new E(401, "non_authentifie", "Connexion requise.");
  if (perm && !permsDe(moi()).has(perm)) {
    tracer({ type: "security", action: "access_denied", resultat: "denied", details: { permission: perm } });
    throw new E(403, "acces_refuse", "Vous n'avez pas la permission nécessaire pour cette action.");
  }
  if (sensible && Date.now() > session.confirmeJusqua) throw new E(403, "confirmation_requise", "Opération sensible : confirmez votre identité en ressaisissant votre mot de passe.");
}
const motif = (c: any) => { if (!c?.motif || String(c.motif).trim().length < 3) throw new E(400, "donnees_invalides", "Indiquez un motif (3 caractères minimum)."); return String(c.motif).trim(); };
const vueU = (u: Util) => ({ ...u, jeton: undefined, roles: u.roles.map((r) => roles.find((x) => x.id === r)!).filter(Boolean).map((r) => ({ id: r.id, cle: r.cle, libelle: r.libelle })) });
const vueR = (r: Role) => ({ ...r, utilisateurs: utilisateurs.filter((u) => u.roles.includes(r.id)).length });
const nomDe = (idU: string | null) => (idU ? utilisateurs.find((u) => u.id === idU)?.nom ?? null : null);
const page = <T,>(l: T[], q: URLSearchParams) => {
  const pg = Math.max(1, Number(q.get("page") ?? 1)), t = Math.min(100, Math.max(1, Number(q.get("taille") ?? 25)));
  return { elements: l.slice((pg - 1) * t, pg * t), total: l.length, page: pg, taille: t };
};
const nbAdmins = (sauf?: string) => utilisateurs.filter((u) => u.id !== sauf && u.statut === "active" && permsDe(u).has("users.admin")).length;
const pasSoi = (idU: string) => { if (idU === session?.utilisateurId) throw new E(403, "action_sur_soi_interdite", "Vous ne pouvez pas faire cette action sur votre propre compte. Demandez à un autre administrateur."); };

/* ------------------------------------------------------------------ routes */
function traiter(m: string, chemin: string, q: URLSearchParams, c: any): unknown {
  const [, , mod, a1, a2] = chemin.split("/");   // /api/<mod>/<a1>/<a2>
  if (chemin === "/api/sante") return { statut: "ok", version: "démo" };

  if (mod === "auth") {
    if (a1 === "connexion") {
      const u = utilisateurs.find((x) => x.email === String(c.email).toLowerCase());
      if (String(c.codeEntreprise).toUpperCase() !== CODE || !u || c.motDePasse !== MDP_DEMO) {
        tracer({ type: "auth", action: "login", resultat: "failure", acteurId: u?.id ?? null, details: { raison: u ? "mot_de_passe" : "compte_inconnu" } });
        throw new E(401, "identifiants_invalides", "Code entreprise, adresse e-mail ou mot de passe incorrect.");
      }
      if (u.statut !== "active") throw new E(403, "compte_inactif", "Ce compte n'est pas actif. Contactez votre administrateur.");
      if (u.mfaActive && !/^\d{6}$/.test(c.codeMfa ?? "")) throw new E(401, "mfa_requis", "Saisissez le code à 6 chiffres de votre application d'authentification.");
      session = { utilisateurId: u.id, id: id(), confirmeJusqua: 0, creeLe: new Date().toISOString() };
      u.derniereConnexion = new Date().toISOString();
      tracer({ type: "auth", action: "login" });
      return { utilisateur: { id: u.id, email: u.email, nom: u.nom }, mfaAConfigurer: false };
    }
    if (a1 === "invitation" || a1 === "reinitialisation") {
      const u = utilisateurs.find((x) => x.jeton && x.jeton === String(c.jeton).trim());
      if (!u || String(c.codeEntreprise).toUpperCase() !== CODE) throw new E(400, "jeton_invalide", "Ce lien n'est pas valide ou a expiré. Demandez-en un nouveau à votre administrateur.");
      if (String(c.motDePasse ?? "").length < 12) throw new E(400, "mot_de_passe_faible", "Le mot de passe doit contenir au moins 12 caractères.");
      u.jeton = undefined; if (u.statut === "invited") u.statut = "active";
      tracer({ type: "auth", action: a1 === "invitation" ? "invitation_accept" : "password_reset", acteurId: u.id });
      return { ok: true };
    }
    if (a1 === "recuperation") throw new E(400, "recuperation_refusee", "La récupération par code maître n'est pas simulée dans la démonstration.");
    exiger(null);
    const u = moi();
    if (a1 === "moi") {
      const ps = permsDe(u);
      const requise = entreprise.parametres.mfaObligatoire && u.roles.some((r) => roles.find((x) => x.id === r)?.mfaRequise);
      return { utilisateur: { id: u.id, email: u.email, nom: u.nom, mfaActive: u.mfaActive }, entreprise: { id: entreprise.id, code: CODE, raisonSociale: entreprise.raisonSociale, pays: "CM", devise: "XAF" },
        roles: vueU(u).roles, permissions: [...ps].sort(), mfa: { active: u.mfaActive, requise: requise }, session: { id: session!.id, inactiviteMinutes: 15 } };
    }
    if (a1 === "deconnexion") { tracer({ type: "auth", action: "logout" }); session = null; return { ok: true }; }
    if (a1 === "confirmation") {
      if (c.motDePasse !== MDP_DEMO) { tracer({ type: "auth", action: "step_up", resultat: "failure" }); throw new E(401, "confirmation_refusee", "Mot de passe ou code incorrect."); }
      session!.confirmeJusqua = Date.now() + 5 * 60_000; tracer({ type: "auth", action: "step_up" }); return { ok: true, valableMinutes: 5 };
    }
    if (a1 === "mot-de-passe") { if (c.ancien !== MDP_DEMO) throw new E(400, "mot_de_passe_incorrect", "Le mot de passe actuel est incorrect."); throw new E(400, "demo", "Démonstration : le mot de passe des comptes fictifs ne peut pas être changé."); }
    if (a1 === "mfa" && a2 === "initialisation") {
      const s = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[b % 32]).join("");
      return { secret: s, uri: `otpauth://totp/Gestionnaire%20Comptable:${encodeURIComponent(u.email)}?secret=${s}&issuer=Gestionnaire%20Comptable` };
    }
    if (a1 === "mfa" && a2 === "activation") { if (!/^\d{6}$/.test(c.code)) throw new E(400, "mfa_invalide", "Code incorrect."); u.mfaActive = true; tracer({ type: "security", action: "mfa_enable" }); return { ok: true }; }
    if (a1 === "sessions") {
      if (m === "DELETE") throw new E(404, "introuvable", "Session introuvable.");
      return [{ id: session!.id, creeLe: session!.creeLe, derniereActivite: new Date().toISOString(), expireLe: new Date(Date.now() + 36e6).toISOString(), ip: "192.168.1.24", agent: navigator.userAgent, courante: true }];
    }
  }

  if (mod === "utilisateurs") {
    if (!a1 && m === "GET") {
      exiger("users.read");
      const r = (q.get("recherche") ?? "").toLowerCase(), st = q.get("statut"), ro = q.get("role");
      const l = utilisateurs.filter((u) => (!r || (u.nom + " " + u.email).toLowerCase().includes(r)) && (!st || u.statut === st) && (!ro || u.roles.includes(ro)))
        .sort((x, y) => x.nom.localeCompare(y.nom)).map(vueU);
      return page(l, q);
    }
    if (!a1 && m === "POST") {
      exiger("users.create");
      if (c.roles?.length) exiger("users.admin", true);
      if (!c.nom || String(c.nom).trim().length < 3 || !/^\S+@\S+\.\S+$/.test(c.email ?? "")) throw new E(400, "donnees_invalides", "Nom (3 caractères minimum) et adresse e-mail valide obligatoires.");
      if (utilisateurs.some((u) => u.email === String(c.email).toLowerCase())) throw new E(409, "email_existant", "Un compte utilise déjà cette adresse e-mail dans cette entreprise.");
      const u: Util = { id: id(), email: String(c.email).toLowerCase(), nom: String(c.nom).trim(), statut: "invited", verrouille: false, accesExpireLe: c.accesExpireLe ?? null, derniereConnexion: null, creeLe: new Date().toISOString(), mfaActive: false, roles: c.roles ?? [], jeton: jeton() };
      utilisateurs.push(u);
      tracer({ type: "users", action: "create", objetType: "user", objetId: u.id, apres: { email: u.email, nom: u.nom, roles: u.roles.map((r) => roles.find((x) => x.id === r)?.cle) } });
      return { utilisateur: vueU(u), invitation: { jeton: u.jeton, expireLe: new Date(Date.now() + 72 * 36e5).toISOString() } };
    }
    const u = utilisateurs.find((x) => x.id === a1);
    if (!u) throw new E(404, "introuvable", "Utilisateur introuvable.");
    if (!a2 && m === "GET") { exiger("users.read"); return vueU(u); }
    if (!a2 && m === "PATCH") {
      exiger("users.update");
      const avant = { nom: u.nom, accesExpireLe: u.accesExpireLe };
      if (c.nom) u.nom = String(c.nom).trim();
      if ("accesExpireLe" in c) { pasSoi(u.id); u.accesExpireLe = c.accesExpireLe; }
      tracer({ type: "users", action: "update", objetType: "user", objetId: u.id, avant, apres: { nom: u.nom, accesExpireLe: u.accesExpireLe } });
      return vueU(u);
    }
    if (a2 === "connexions") {
      exiger("users.read");
      const l = journal.filter((e) => e.acteurId === u.id && ["auth", "security"].includes(e.type)).reverse().map((e) => ({ date: e.date, type: e.type, action: e.action, resultat: e.resultat, ip: e.ip, raison: (e.details.raison as string) ?? null }));
      return page(l, q);
    }
    if (a2 === "invitation") { exiger("users.create"); u.jeton = jeton(); tracer({ type: "users", action: "invite_renew", objetType: "user", objetId: u.id }); return { invitation: { jeton: u.jeton, expireLe: new Date(Date.now() + 72 * 36e5).toISOString() } }; }
    exiger("users.admin", true);
    if (a2 === "desactivation") {
      const mo = motif(c); pasSoi(u.id);
      if (permsDe(u).has("users.admin") && nbAdmins(u.id) === 0) throw new E(409, "dernier_administrateur", "Impossible : ce compte est le dernier administrateur actif de l'entreprise.");
      const avant = u.statut; u.statut = "disabled";
      tracer({ type: "users", action: "disable", objetType: "user", objetId: u.id, motif: mo, avant: { statut: avant }, apres: { statut: "disabled" } });
      return vueU(u);
    }
    if (a2 === "reactivation") { const mo = motif(c); u.statut = "active"; u.verrouille = false; tracer({ type: "users", action: "enable", objetType: "user", objetId: u.id, motif: mo, avant: { statut: "disabled" }, apres: { statut: "active" } }); return vueU(u); }
    if (a2 === "deverrouillage") { u.verrouille = false; tracer({ type: "security", action: "account_unlock", objetType: "user", objetId: u.id }); return vueU(u); }
    if (a2 === "roles") {
      const mo = motif(c); pasSoi(u.id);
      const avant = u.roles.map((r) => roles.find((x) => x.id === r)?.cle);
      u.roles = [...new Set<string>(c.roles)];
      tracer({ type: "roles", action: "assign", objetType: "user", objetId: u.id, motif: mo, avant, apres: u.roles.map((r) => roles.find((x) => x.id === r)?.cle) });
      return vueU(u);
    }
    if (a2 === "reinitialisation-mot-de-passe") { const mo = motif(c); pasSoi(u.id); u.jeton = jeton(); tracer({ type: "users", action: "password_reset_issue", objetType: "user", objetId: u.id, motif: mo }); return { reinitialisation: { jeton: u.jeton, expireLe: new Date(Date.now() + 30 * 6e4).toISOString() } }; }
    if (a2 === "revocation-sessions") { const mo = motif(c); tracer({ type: "security", action: "sessions_revoke", objetType: "user", objetId: u.id, motif: mo }); return { sessionsFermees: u.id === session!.utilisateurId ? 0 : 1 }; }
  }

  if (mod === "permissions") { exiger("roles.read"); return { modules: MODULES.map(([cle, libelle]) => ({ cle, libelle })), actions: ACTIONS.map(([cle, libelle]) => ({ cle, libelle })) }; }
  if (mod === "roles") {
    if (!a1 && m === "GET") { exiger("roles.read"); return roles.filter((r) => q.get("archives") === "oui" || !r.archiveLe).sort((x, y) => Number(y.systeme) - Number(x.systeme) || x.libelle.localeCompare(y.libelle)).map(vueR); }
    if (!a1 && m === "POST") {
      exiger("roles.create");
      let perms: string[] = c.permissions ?? [];
      if (c.copierDe) perms = [...new Set([...perms, ...(roles.find((r) => r.id === c.copierDe)?.permissions ?? [])])];
      if (perms.length) exiger("roles.admin", true);
      if (!c.libelle || String(c.libelle).trim().length < 3) throw new E(400, "donnees_invalides", "Nom du rôle obligatoire (3 caractères minimum).");
      if (!/^[a-z][a-z0-9_]{2,40}$/.test(c.cle ?? "")) throw new E(400, "donnees_invalides", "Identifiant technique : lettres minuscules, chiffres et _ (3 à 41 caractères).");
      if (roles.some((r) => r.cle === c.cle)) throw new E(409, "cle_existante", "Un rôle utilise déjà cette clé.");
      const r: Role = { id: id(), cle: c.cle, libelle: String(c.libelle).trim(), description: c.description ?? null, systeme: false, mfaRequise: !!c.mfaRequise, archiveLe: null, permissions: perms.sort() };
      roles.push(r); tracer({ type: "roles", action: "create", objetType: "role", objetId: r.id, apres: { cle: r.cle, libelle: r.libelle, permissions: perms } });
      return vueR(r);
    }
    const r = roles.find((x) => x.id === a1);
    if (!r) throw new E(404, "introuvable", "Rôle introuvable.");
    if (!a2 && m === "GET") { exiger("roles.read"); return vueR(r); }
    if (a2 === "permissions") {
      exiger("roles.admin", true); const mo = motif(c);
      if (r.systeme) throw new E(409, "role_systeme", "Les permissions d'un rôle système ne sont pas modifiables.");
      if (moi().roles.includes(r.id)) throw new E(403, "auto_attribution_interdite", "Vous ne pouvez pas modifier les permissions d'un rôle que vous détenez.");
      const avant = r.permissions; r.permissions = [...new Set<string>(c.permissions)].sort();
      tracer({ type: "roles", action: "permissions_change", objetType: "role", objetId: r.id, motif: mo, avant, apres: r.permissions, details: { ajoutees: r.permissions.filter((x) => !avant.includes(x)), retirees: avant.filter((x) => !r.permissions.includes(x)) } });
      return vueR(r);
    }
    if (a2 === "archivage") {
      exiger("roles.archive"); const mo = motif(c);
      if (r.systeme) throw new E(409, "role_systeme", "Un rôle système ne peut pas être archivé.");
      if (vueR(r).utilisateurs) throw new E(409, "role_utilise", "Ce rôle est encore attribué. Retirez-le d'abord des utilisateurs.");
      r.archiveLe = new Date().toISOString(); tracer({ type: "roles", action: "archive", objetType: "role", objetId: r.id, motif: mo }); return vueR(r);
    }
  }

  if (mod === "audit") {
    if (m !== "GET") { exiger(null); tracer({ type: "security", action: "audit_tamper_attempt", resultat: "denied" }); throw new E(403, "journal_non_modifiable", "Le journal d'audit ne peut être ni modifié ni supprimé."); }
    if (a1 === "integrite") { exiger("audit.read"); tracer({ type: "audit", action: "verify" }); return { valide: true, anomalies: [], derniereSequence: journal.length, total: journal.length }; }
    if (a1 === "export") { exiger("audit.export", true); tracer({ type: "audit", action: "export" }); return "﻿démonstration"; }
    exiger("audit.read");
    const t = q.get("type"), re = q.get("resultat"), du = q.get("du"), au = q.get("au"), rech = (q.get("recherche") ?? "").toLowerCase();
    const l = [...journal].reverse().filter((e) => (!t || e.type === t) && (!re || e.resultat === re) && (!du || e.date >= du) && (!au || e.date.slice(0, 10) <= au)
      && (!rech || JSON.stringify([e.action, e.motif, e.details]).toLowerCase().includes(rech))).map((e) => ({ ...e, acteur: nomDe(e.acteurId) }));
    return page(l, q);
  }

  if (mod === "entreprise") {
    if (a1 === "code-maitre") { exiger("company.admin", true); tracer({ type: "security", action: "master_code_regenerate" }); entreprise.codeMaitre = { actif: true, creeLe: new Date().toISOString(), bloque: false }; return { codeMaitre: "GCM-DEMO-FICT-IF00-0000-0000-0000" }; }
    if (a1 === "apparence") { exiger(null); return { raisonSociale: entreprise.raisonSociale, couleurs: entreprise.couleurs, logoId: entreprise.logoId, logoUrl: entreprise.logoUrl }; }
    if (a1 === "logo") {
      exiger("company.update");
      if (m === "DELETE") { entreprise.logoId = null; entreprise.logoUrl = null; tracer({ type: "company", action: "logo_remove" }); return { ok: true }; }
      const b64 = String(c.image ?? "").replace(/^data:image\/[a-z]+;base64,/, "");
      if (!/^iVBORw0KGgo|^\/9j\//.test(b64)) throw new E(400, "logo_format", "Format refusé : envoyez une image PNG ou JPEG.");
      if (b64.length * 0.75 > 512 * 1024) throw new E(400, "logo_trop_lourd", "Le logo dépasse 512 Kio.");
      // Démonstration : le logo reste dans la page (adresse data:), le vrai serveur le conserve en base.
      entreprise.logoId = id(); entreprise.logoUrl = `data:image/${b64.startsWith("/9j/") ? "jpeg" : "png"};base64,${b64}`;
      tracer({ type: "company", action: "logo_change" }); return { logoId: entreprise.logoId };
    }
    if (m === "GET") { exiger("company.read"); return entreprise; }
    exiger("company.update");
    if (c.couleurs && !(/^#[0-9a-f]{6}$/i.test(c.couleurs.principale) && /^#[0-9a-f]{6}$/i.test(c.couleurs.accent))) throw new E(400, "donnees_invalides", "Couleur au format #RRGGBB.");
    if (c.parametres) { exiger("company.admin", true); entreprise.parametres = { ...entreprise.parametres, ...c.parametres }; tracer({ type: "security", action: "security_settings_change", apres: entreprise.parametres }); return entreprise; }
    const avant = { ...entreprise };
    for (const k of ["raisonSociale", "rccm", "niu", "adresse", "telephone", "email", "regimeFiscal", "patente", "couleurs"] as const)
      if (k in c) (entreprise as Record<string, unknown>)[k] = k === "raisonSociale" ? c[k] || entreprise.raisonSociale : c[k] ?? null;
    tracer({ type: "company", action: "update", avant: { raisonSociale: avant.raisonSociale }, apres: { raisonSociale: entreprise.raisonSociale } });
    return entreprise;
  }

  if (mod === "notifications") {
    exiger(null);
    const u = moi(), ps = permsDe(u);
    const vis = notifications.filter((n) => n.pour === u.id || (n.permission && ps.has(n.permission)));
    if (a2 === "lecture") { notifications.find((n) => n.id === a1)?.lus.add(u.id); return { ok: true }; }
    return { elements: vis.map((n) => ({ id: n.id, type: n.type, titre: n.titre, texte: n.texte, date: n.date, lue: n.lus.has(u.id) })), nonLues: vis.filter((n) => !n.lus.has(u.id)).length, page: 1, taille: 20 };
  }
  if (mod === "comptabilite") return traiterComptabilite(m, chemin, q, c, {
    exiger, tracer, motif, permissions: () => permsDe(moi()), moi: () => ({ id: moi().id, nom: moi().nom }), nomDe, page,
    erreur: (s: number, code: string, message: string) => new E(s, code, message),
  });
  if (mod === "tresorerie" || mod === "ventes" || mod === "tableau-de-bord") return traiterTresorerie(m, chemin, q, c, {
    exiger, tracer, motif, permissions: () => permsDe(moi()), moi: () => ({ id: moi().id, nom: moi().nom }), nomDe, page,
    erreur: (s: number, code: string, message: string) => new E(s, code, message),
    utilisateurs: () => utilisateurs.map((u) => ({ id: u.id, nom: u.nom, actif: u.statut === "active", permissions: permsDe(u) })),
    entreprise: () => ({ raisonSociale: entreprise.raisonSociale, niu: entreprise.niu, rccm: entreprise.rccm, adresse: entreprise.adresse, telephone: entreprise.telephone, devise: entreprise.devise,
      email: entreprise.email, regimeFiscal: entreprise.regimeFiscal, patente: entreprise.patente, couleurs: { ...entreprise.couleurs }, logoId: entreprise.logoId, logoUrl: entreprise.logoUrl, code: entreprise.code }),
  });
  throw new E(404, "introuvable", "Adresse inconnue.");
}

export function installer() {
  const ids = Object.fromEntries(utilisateurs.map((u) => [u.email, u.id]));
  initialiserComptabilite(ids);
  initialiserTresorerie(ids, { raisonSociale: entreprise.raisonSociale, niu: entreprise.niu, rccm: entreprise.rccm, adresse: entreprise.adresse, telephone: entreprise.telephone,
    devise: entreprise.devise, email: entreprise.email, regimeFiscal: entreprise.regimeFiscal, patente: entreprise.patente, couleurs: { ...entreprise.couleurs },
    logoId: null, logoUrl: null, code: entreprise.code });
  definirTransport(async (methode, url, corps) => {
    await new Promise((r) => setTimeout(r, 120));   // petite latence réaliste
    const u = new URL(url, location.href);
    try {
      const r = traiter(methode, u.pathname, u.searchParams, corps ?? {});
      return typeof r === "string"
        ? new Response(r, { status: 200, headers: { "content-type": "text/csv" } })
        : new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      const err = e instanceof E ? e : new E(500, "erreur_interne", "Erreur de la démonstration.");
      return new Response(JSON.stringify({ erreur: { code: err.code, message: err.message } }), { status: err.s, headers: { "content-type": "application/json" } });
    }
  });
}
