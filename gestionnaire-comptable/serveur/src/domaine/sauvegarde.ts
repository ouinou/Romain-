import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { creerPool } from "../db.js";
import { journaliserSysteme } from "./audit.js";
import { chiffrerFichier, dechiffrerFichier, sha256Fichier } from "../securite/fichier-chiffre.js";

/** Outils PostgreSQL (pg_dump, pg_restore) : dans le PATH, ou dans GC_PG_BIN sous Windows. */
export const executable = (nom: string) => (process.env.GC_PG_BIN ? join(process.env.GC_PG_BIN, nom) : nom);

function lancer(cmd: string, args: string[]) {
  return new Promise<void>((ok, ko) => {
    let erreur = "";
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    p.stderr.on("data", (b) => { erreur += b; });
    p.on("error", ko);
    p.on("exit", (code) => (code === 0 ? ok() : ko(new Error(`${basename(cmd)} a échoué (code ${code}) : ${erreur.trim().slice(0, 500)}`))));
  });
}

const temporaire = (nom: string) => join(tmpdir(), `gc-${randomBytes(6).toString("hex")}-${nom}`);

/**
 * Sauvegarde complète : pg_dump (format personnalisé) avec le rôle gc_backup (lecture seule, BYPASSRLS),
 * chiffrement AES-256-GCM, empreinte SHA-256. Le fichier clair temporaire est toujours supprimé.
 */
export async function sauvegarder(o: { base: string; cle: Buffer; dossier: string }) {
  if (o.cle.length !== 32) throw new Error("La clé de sauvegarde doit faire 32 octets.");
  mkdirSync(o.dossier, { recursive: true });
  const nom = `gc-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const temp = temporaire(`${nom}.dump`), fichier = join(o.dossier, `${nom}.gcsv`);
  const pool = creerPool(o.base, 1);
  try {
    await lancer(executable("pg_dump"), ["--format=custom", "--no-password", `--file=${temp}`, `--dbname=${o.base}`]);
    await chiffrerFichier(o.cle, temp, fichier);
    const sha256 = await sha256Fichier(fichier);
    writeFileSync(`${fichier}.sha256`, `${sha256}  ${nom}.gcsv\n`);
    const taille = statSync(fichier).size;
    await journaliserSysteme(pool, "backup.create", "success", { fichier: `${nom}.gcsv`, taille, sha256 });
    return { fichier, sha256, taille };
  } catch (e) {
    await journaliserSysteme(pool, "backup.create", "failure", { erreur: (e as Error).message.slice(0, 300) }).catch(() => {});
    throw e;
  } finally {
    rmSync(temp, { force: true });
    await pool.end();
  }
}

/**
 * Restaure une sauvegarde dans une base VIDE, jamais par-dessus la base en service.
 * Vérifie l'empreinte (si le .sha256 est présent) ; le chiffrement authentifié rejette tout fichier altéré.
 * À exécuter avec un compte superutilisateur PostgreSQL : c'est une opération d'administration technique.
 */
export async function restaurer(o: { fichier: string; baseCible: string; cle: Buffer }) {
  if (existsSync(`${o.fichier}.sha256`)) {
    const attendu = readFileSync(`${o.fichier}.sha256`, "utf8").split(/\s+/)[0];
    if ((await sha256Fichier(o.fichier)) !== attendu) throw new Error("L'empreinte SHA-256 ne correspond pas : fichier altéré ou incomplet.");
  }
  const cible = creerPool(o.baseCible, 1);
  const temp = temporaire(`${basename(o.fichier)}.dump`);
  try {
    const { rows: [{ n }] } = await cible.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
    if (n > 0) throw new Error("La base cible n'est pas vide. Créez une base neuve pour la restauration.");
    await dechiffrerFichier(o.cle, o.fichier, temp);
    await lancer(executable("pg_restore"), ["--exit-on-error", "--no-password", `--dbname=${o.baseCible}`, temp]);
    await cible.query("INSERT INTO system_events (event_type, outcome, details) VALUES ('backup.restore','success',$1)", [JSON.stringify({ fichier: basename(o.fichier) })]);
  } finally {
    rmSync(temp, { force: true });
    await cible.end();
  }
}
