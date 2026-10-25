/**
 * FINEXA ERP : configuration après installation (lancée par le setup Windows, avec le Node.js fourni).
 *
 *   node configurer.mjs --app <dossier du programme> --donnees <dossier des données>          installation ou mise à jour
 *   node configurer.mjs --app … --donnees … --demo                                              + entreprise fictive d'évaluation
 *   node configurer.mjs --app … --donnees … --desinstaller [--supprimer-donnees]              désinstallation
 *
 * Installation : base PostgreSQL privée (port local dédié), rôles et mots de passe aléatoires, clés de chiffrement,
 * certificat HTTPS signé par une autorité locale, schéma (migrations), services Windows, pare-feu (réseau privé),
 * sauvegarde et contrôle du journal planifiés chaque soir.
 * Mise à jour (fichier de configuration déjà présent) : arrêt du service, migrations, redémarrage. Les données restent.
 *
 * Aucun secret n'est affiché ni écrit ailleurs que dans le fichier de configuration, protégé par les droits Windows.
 * Hors Windows (tests), les étapes propres à Windows sont sautées et PostgreSQL est lancé directement.
 */
import { spawnSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: o } = parseArgs({ options: {
  app: { type: "string" }, donnees: { type: "string" }, "pg-bin": { type: "string" }, "port-pg": { type: "string" },
  desinstaller: { type: "boolean" }, "supprimer-donnees": { type: "boolean" }, demo: { type: "boolean" },
} });
if (!o.app || !o.donnees) { console.error("Usage : node configurer.mjs --app <dossier> --donnees <dossier>"); process.exit(2); }

const WIN = process.platform === "win32";
const APP = o.app, DONNEES = o.donnees;
const SERVEUR = join(APP, "serveur");
const NODE = process.execPath;
const PG_BIN = o["pg-bin"] ?? join(APP, "runtime", "pgsql", "bin");
const exe = (n) => join(PG_BIN, WIN ? `${n}.exe` : n);
const D = {
  pgdata: join(DONNEES, "base"), config: join(DONNEES, "config"), env: join(DONNEES, "config", "serveur.env"),
  certs: join(DONNEES, "certificats"), sauvegardes: join(DONNEES, "sauvegardes"), journaux: join(DONNEES, "journaux"),
  copie: join(DONNEES, "copie-journal"), services: join(DONNEES, "services"),
};
// Identifiants techniques (services, règle de pare-feu, tâches planifiées, autorité de certification) : ils gardent
// l'ancien nom du produit pour que les installations existantes se mettent à jour et se désinstallent sans reste.
// Le nom affiché du produit est FINEXA ERP.
const SERVICE_PG = "GestionnaireComptable-Base", SERVICE_APP = "GestionnaireComptable-Serveur";
const JOURNAL = join(DONNEES, "journaux", "installation.log");

// La fenêtre du setup (NSIS) affiche la sortie en page de code ANSI : sous Windows, la console reçoit un texte sans
// accents pour rester lisible ; le journal d'installation garde le texte complet (UTF-8).
const lisible = (t) => (WIN ? String(t).replace(/»/g, ">").replace(/[\u2013\u2014]/g, "-").replace(/[«]/g, "\"").replace(/[\u2019]/g, "'").normalize("NFD").replace(/[\u0300-\u036f]/g, "") : String(t));
process.on("uncaughtException", (e) => {
  console.error(lisible(`ERREUR : ${e?.message ?? e}`));
  try { appendFileSync(JOURNAL, `${new Date().toISOString()} ERREUR : ${e?.stack ?? e}\n`); } catch { /* journal indisponible */ }
  process.exit(1);
});
process.on("unhandledRejection", (e) => { throw e; });
const etape = (t) => { console.log(lisible(`» ${t}`)); try { appendFileSync(JOURNAL, `${new Date().toISOString()} ${t}\n`); } catch { /* dossier pas encore créé */ } };
function lancer(cmd, args, { ignorer = false, env, cwd } = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: env ?? process.env, cwd, windowsHide: true });
  if (r.status !== 0 && !ignorer) {
    // On n'affiche pas la ligne de commande complète : elle peut contenir un chemin de fichier de mot de passe.
    throw new Error(`Échec de ${cmd.split(/[\\/]/).pop()} (code ${r.status}) : ${(r.stderr || r.stdout || r.error?.message || "").trim().slice(0, 800)}`);
  }
  return r;
}
const secret = (n = 32) => randomBytes(n).toString("base64url");
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const portLibre = (port) => new Promise((ok) => { const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true))).listen(port, "0.0.0.0"); });
async function premierPortLibre(depart) { for (let p = depart; p < depart + 20; p++) if (await portLibre(p)) return p; throw new Error(`Aucun port libre à partir de ${depart}.`); }
const lireEnv = (f) => Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

const require = createRequire(join(SERVEUR, "package.json"));
const pg = require("pg");

/* ---------------------------------------------------------------- Désinstallation */
if (o.desinstaller) {
  etape("Arrêt et suppression des services");
  if (WIN) {
    lancer(join(D.services, `${SERVICE_APP}.exe`), ["stop"], { ignorer: true });
    lancer(join(D.services, `${SERVICE_APP}.exe`), ["uninstall"], { ignorer: true });
    lancer("sc.exe", ["stop", SERVICE_PG], { ignorer: true });
    await attendre(3000);
    lancer(exe("pg_ctl"), ["unregister", "-N", SERVICE_PG], { ignorer: true });
    lancer("netsh", ["advfirewall", "firewall", "delete", "rule", "name=Gestionnaire Comptable"], { ignorer: true });
    for (const t of ["Sauvegarde", "Controle du journal"]) lancer("schtasks", ["/Delete", "/F", "/TN", `Gestionnaire Comptable\\${t}`], { ignorer: true });
    lancer("certutil", ["-delstore", "Root", "Gestionnaire Comptable - autorite locale"], { ignorer: true });
  } else lancer(exe("pg_ctl"), ["stop", "-D", D.pgdata, "-m", "fast"], { ignorer: true });
  if (o["supprimer-donnees"]) { etape("Suppression des données (base, sauvegardes, configuration)"); rmSync(DONNEES, { recursive: true, force: true }); }
  else etape(`Données conservées dans ${DONNEES} (base, sauvegardes, configuration).`);
  process.exit(0);
}

/* ---------------------------------------------------------------- Installation / mise à jour */
for (const d of Object.values(D)) if (!d.endsWith(".env")) mkdirSync(d, { recursive: true });
const miseAJour = existsSync(D.env);
etape(miseAJour ? "Mise à jour d'une installation existante" : "Nouvelle installation");

if (WIN) {
  // Droits : configuration et certificats lisibles seulement par le système, les administrateurs et le compte des services.
  for (const d of [D.config, D.certs])
    lancer("icacls", [d, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-20:(OI)(CI)R"]);
  for (const d of [D.pgdata, D.journaux, D.sauvegardes, D.copie]) lancer("icacls", [d, "/grant", "*S-1-5-20:(OI)(CI)M"]);
}

let env;
if (!miseAJour) {
  const portPg = o["port-pg"] ? Number(o["port-pg"]) : await premierPortLibre(5442);
  const portApp = await premierPortLibre(8443);
  const mdp = { postgres: secret(), owner: secret(), app: secret(), backup: secret() };

  etape("Création de la base PostgreSQL privée");
  if (existsSync(join(D.pgdata, "PG_VERSION")))
    throw new Error(`Une base existe déjà dans ${D.pgdata} mais sa configuration (${D.env}) est absente. Rien n'a été modifié : restaurez le fichier de configuration, ou déplacez ce dossier si la base n'est plus utile.`);
  // Sous Windows, initdb lancé par un administrateur se relance avec des droits réduits (le groupe Administrateurs
  // ne compte plus). Il ne garde que les droits du compte lui-même : le fichier du mot de passe est donc écrit dans le
  // dossier temporaire de ce compte (privé), et le dossier de la base est ouvert explicitement à ce compte.
  if (WIN) {
    const sid = lancer("whoami", ["/user", "/fo", "csv", "/nh"]).stdout.trim().split(",").pop().replace(/"/g, "");
    if (/^S-1-/.test(sid)) lancer("icacls", [D.pgdata, "/grant", `*${sid}:(OI)(CI)F`]);
  }
  const dossierPw = mkdtempSync(join(tmpdir(), "gc-installation-"));
  const pw = join(dossierPw, "pw.tmp");
  writeFileSync(pw, mdp.postgres, { mode: 0o600 });
  try { lancer(exe("initdb"), ["-D", D.pgdata, "-U", "postgres", "-A", "scram-sha-256", `--pwfile=${pw}`, "-E", "UTF8", "--no-locale"]); }
  finally { rmSync(dossierPw, { recursive: true, force: true }); }
  appendFileSync(join(D.pgdata, "postgresql.conf"), [
    "", "# Gestionnaire Comptable", `port = ${portPg}`, "listen_addresses = 'localhost'",
    "log_min_error_statement = error", "logging_collector = on", "log_directory = 'log'", "log_rotation_age = 7d", "",
  ].join("\n"));

  etape("Démarrage de PostgreSQL");
  demarrerPg();
  const superu = await connexion(`postgres://postgres:${encodeURIComponent(mdp.postgres)}@localhost:${portPg}/postgres`);

  etape("Rôles et base de données (mots de passe aléatoires)");
  // Mêmes rôles que sql/00-roles-postgresql.sql. Mots de passe passés par format() : jamais concaténés au SQL.
  for (const [role, opts, m] of [["gc_owner", "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS", mdp.owner], ["gc_app", "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT", mdp.app], ["gc_backup", "NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS", mdp.backup]]) {
    const { rows: [{ sql }] } = await superu.query(`SELECT format('CREATE ROLE %I LOGIN PASSWORD %L ${opts}', $1::text, $2::text) AS sql`, [role, m]);
    await superu.query(sql);
  }
  await superu.query("CREATE DATABASE gestionnaire_comptable OWNER gc_owner ENCODING 'UTF8' TEMPLATE template0");
  await superu.end();
  const base = await connexion(`postgres://postgres:${encodeURIComponent(mdp.postgres)}@localhost:${portPg}/gestionnaire_comptable`);
  for (const q of ["ALTER SCHEMA public OWNER TO gc_owner", "REVOKE CREATE ON SCHEMA public FROM PUBLIC", "REVOKE ALL ON DATABASE gestionnaire_comptable FROM PUBLIC",
    "GRANT CONNECT ON DATABASE gestionnaire_comptable TO gc_owner, gc_app, gc_backup"]) await base.query(q);
  await base.end();

  etape("Certificat HTTPS (autorité locale propre à ce serveur)");
  const { creerCertificats } = await import("./certificats.mjs");
  const noms = ["localhost", hostname(), `${hostname()}.local`];
  const ips = ["127.0.0.1", ...Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address)];
  const c = creerCertificats({ noms, ips, nomAutorite: "Gestionnaire Comptable - autorite locale" });
  writeFileSync(join(D.certs, "autorite-gestionnaire-comptable.crt"), c.autorite);
  writeFileSync(join(D.certs, "serveur.crt"), c.certificat + c.autorite);
  writeFileSync(join(D.certs, "serveur.key"), c.cle, { mode: 0o600 });

  const url = (role, m) => `postgres://${role}:${encodeURIComponent(m)}@localhost:${portPg}/gestionnaire_comptable`;
  env = {
    GC_BASE_DE_DONNEES: url("gc_app", mdp.app), GC_BASE_PROPRIETAIRE: url("gc_owner", mdp.owner), GC_BASE_SAUVEGARDE: url("gc_backup", mdp.backup),
    GC_CLE_CHIFFREMENT: randomBytes(32).toString("base64"), GC_CLE_SAUVEGARDE: randomBytes(32).toString("base64"),
    GC_HOTE: "0.0.0.0", GC_PORT: String(portApp),
    GC_TLS_CERTIFICAT: join(D.certs, "serveur.crt"), GC_TLS_CLE: join(D.certs, "serveur.key"), GC_TLS_AUTORITE: join(D.certs, "autorite-gestionnaire-comptable.crt"),
    GC_DOSSIER_INTERFACE: join(APP, "interface", "dist"), GC_PG_BIN: PG_BIN,
    GC_DOSSIER_SAUVEGARDES: D.sauvegardes, GC_FICHIER_ANCRAGES: join(D.sauvegardes, "ancrages-journal.tsv"), GC_DOSSIER_COPIE_JOURNAL: D.copie,
    GC_JOURNAL_NIVEAU: "info", GC_PG_PORT: String(portPg),
  };
  writeFileSync(D.env, [
    "# FINEXA ERP : configuration générée à l'installation. NE PAS DIFFUSER.",
    "# GC_CLE_SAUVEGARDE : sans elle, les sauvegardes sont illisibles. Copiez-la HORS de ce serveur (papier sous scellé, coffre).",
    "# GC_CLE_CHIFFREMENT : protège la double authentification et la signature des factures. À sauvegarder de la même façon.",
    "# GC_DOSSIER_COPIE_JOURNAL : à déplacer vers un support que l'administrateur technique ne contrôle pas seul (NAS, autre poste).",
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`), "",
  ].join("\n"), { mode: 0o600 });
} else {
  env = lireEnv(D.env);
  etape("Arrêt du serveur applicatif pour la mise à jour");
  if (WIN) lancer(join(D.services, `${SERVICE_APP}.exe`), ["stop"], { ignorer: true });
  env.GC_DOSSIER_INTERFACE = join(APP, "interface", "dist"); env.GC_PG_BIN = PG_BIN;
  demarrerPg();
  await connexion(env.GC_BASE_PROPRIETAIRE).then((c) => c.end());
  // Sauvegarde chiffrée AVANT de toucher au schéma : en cas de problème, la base d'avant la mise à jour est restaurable.
  // Si elle échoue, la mise à jour s'arrête ici (lancer lève une erreur) et la base reste telle quelle.
  etape("Sauvegarde chiffrée de la base avant la mise à jour");
  lancer(NODE, [join(SERVEUR, "dist", "src", "cli", "sauvegarder.js")], { env: { ...process.env, ...env }, cwd: SERVEUR });
}

etape("Schéma de la base (migrations)");
lancer(NODE, [join(SERVEUR, "dist", "src", "cli", "migrer.js")], { env: { ...process.env, ...env }, cwd: SERVEUR });

if (o.demo) {
  // Entreprise FICTIVE pour évaluer le logiciel (option du setup, décochée par défaut). Mot de passe connu de tous :
  // jamais sur une installation qui recevra de vraies données.
  const c = await connexion(env.GC_BASE_PROPRIETAIRE);
  const { rows: [r] } = await c.query("SELECT EXISTS (SELECT 1 FROM companies WHERE company_code = 'GC-DEMO-2026') AS existe");
  await c.end();
  if (r.existe) etape("Entreprise de démonstration déjà présente");
  else {
    etape("Entreprise de démonstration (données fictives, pour évaluation)");
    lancer(NODE, [join(SERVEUR, "dist", "src", "cli", "demo-initialiser.js")], { env: { ...process.env, ...env, GC_MODE_DEMO: "oui", GC_DEMO_HISTORIQUE: "oui" }, cwd: SERVEUR });
    writeFileSync(join(DONNEES, "DEMONSTRATION.txt"), [
      "Installation d'ÉVALUATION : elle contient une entreprise fictive dont le mot de passe est connu.",
      "Ne saisissez pas de vraies données ici. Avant un usage réel : désinstallez en supprimant les données, puis réinstallez sans l'option de démonstration.",
      "", "Code entreprise : GC-DEMO-2026", "Mot de passe de tous les comptes : Demonstration-2026!",
      "Comptes : mariam.saleh@demo.cm (administratrice), ousmane.djibrine@demo.cm (DAF), paul.ngaro@demo.cm (comptable),",
      "          amina.mahamat@demo.cm (caissière), joseph.atangana@demo.cm (DG)", "",
    ].join("\r\n"));
  }
}

if (WIN) {
  etape("Service Windows du serveur applicatif");
  const xml = `<service>
  <id>${SERVICE_APP}</id>
  <name>FINEXA ERP - serveur</name>
  <description>Serveur applicatif de FINEXA ERP (réseau local).</description>
  <executable>${NODE}</executable>
  <arguments>--env-file="${D.env}" "${join(SERVEUR, "dist", "src", "index.js")}"</arguments>
  <workingdirectory>${SERVEUR}</workingdirectory>
  <depend>${SERVICE_PG}</depend>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <resetfailure>1 hour</resetfailure>
  <serviceaccount><username>NT AUTHORITY\\NetworkService</username></serviceaccount>
  <logpath>${D.journaux}</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
</service>
`;
  writeFileSync(join(D.services, `${SERVICE_APP}.xml`), xml);
  const winsw = join(D.services, `${SERVICE_APP}.exe`);
  writeFileSync(winsw, readFileSync(join(APP, "runtime", "WinSW-x64.exe")));
  if (!miseAJour) lancer(winsw, ["install"]);
  lancer(winsw, ["start"]);

  if (!miseAJour) {
    etape("Pare-feu : port ouvert pour le réseau privé uniquement");
    lancer("netsh", ["advfirewall", "firewall", "add", "rule", "name=Gestionnaire Comptable", "dir=in", "action=allow", "protocol=TCP", `localport=${env.GC_PORT}`, "profile=private,domain"]);
    etape("Certificat de l'autorité locale ajouté aux certificats de confiance de ce poste");
    lancer("certutil", ["-addstore", "-f", "Root", env.GC_TLS_AUTORITE], { ignorer: true });
    etape("Sauvegarde (20 h) et contrôle du journal (20 h 30) planifiés chaque soir");
    const tache = (nom, script, heure) => lancer("schtasks", ["/Create", "/F", "/RU", "SYSTEM", "/SC", "DAILY", "/ST", heure, "/TN", `Gestionnaire Comptable\\${nom}`,
      "/TR", `"${NODE}" --env-file="${D.env}" "${join(SERVEUR, "dist", "src", "cli", script)}"`]);
    tache("Sauvegarde", "sauvegarder.js", "20:00");
    tache("Controle du journal", "verifier-journal.js", "20:30");
  }
}

writeFileSync(join(DONNEES, "adresse.txt"), `https://localhost:${env.GC_PORT}/\n`);
etape(`Terminé. Adresse sur ce poste : https://localhost:${env.GC_PORT}/  — depuis les autres postes : https://${hostname()}:${env.GC_PORT}/`);
process.exit(0);

/* ---------------------------------------------------------------- Outils */
function demarrerPg() {
  if (WIN) {
    const existe = spawnSync("sc.exe", ["query", SERVICE_PG], { windowsHide: true }).status === 0;
    if (!existe) {
      lancer("icacls", [D.pgdata, "/grant", "*S-1-5-20:(OI)(CI)F", "/T", "/Q"]);
      lancer(exe("pg_ctl"), ["register", "-N", SERVICE_PG, "-U", "NT AUTHORITY\\NetworkService", "-D", D.pgdata, "-S", "auto", "-w"]);
    }
    lancer("sc.exe", ["start", SERVICE_PG], { ignorer: true });
  } else {
    const r = spawnSync(exe("pg_ctl"), ["status", "-D", D.pgdata]);
    if (r.status !== 0) {
      // Hors Windows (tests) : lancement direct, détaché.
      const p = spawn(exe("pg_ctl"), ["start", "-D", D.pgdata, "-l", join(D.journaux, "postgresql.log"), "-o", "-k /tmp"], { detached: true, stdio: "ignore" });
      p.unref();
    }
  }
}

async function connexion(chaine) {
  let derniere;
  for (let i = 0; i < 60; i++) {
    const c = new pg.Client({ connectionString: chaine });
    try { await c.connect(); return c; } catch (e) { derniere = e; await attendre(1000); }
  }
  throw new Error(`PostgreSQL ne répond pas : ${derniere?.message}`);
}
