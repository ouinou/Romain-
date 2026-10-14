import { mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { creerPool } from "../db.js";
import { journaliserSysteme } from "../domaine/audit.js";
import { chiffrerFichier, sha256Fichier } from "../securite/fichier-chiffre.js";
import { executable, executer, lancer } from "./outils.js";

/**
 * Sauvegarde complète : pg_dump (format personnalisé) avec le rôle gc_backup (lecture seule, BYPASSRLS),
 * puis chiffrement AES-256-GCM et empreinte SHA-256. Le fichier clair temporaire est supprimé.
 * La clé GC_CLE_SAUVEGARDE doit être conservée HORS du serveur : sans elle, la sauvegarde est inutilisable.
 */
await executer(async () => {
  const base = process.env.GC_BASE_SAUVEGARDE;
  const cle = Buffer.from(process.env.GC_CLE_SAUVEGARDE ?? "", "base64");
  if (!base) throw new Error("GC_BASE_SAUVEGARDE manque (connexion du rôle gc_backup).");
  if (cle.length !== 32) throw new Error("GC_CLE_SAUVEGARDE doit contenir 32 octets encodés en base64.");
  const dossier = process.env.GC_DOSSIER_SAUVEGARDES ?? "sauvegardes";
  mkdirSync(dossier, { recursive: true });
  const nom = `gc-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const temp = join(tmpdir(), `${nom}.dump`), cible = join(dossier, `${nom}.gcsv`);
  const pool = creerPool(base, 1);
  try {
    await lancer(executable("pg_dump"), ["--format=custom", "--no-password", `--file=${temp}`, `--dbname=${base}`]);
    await chiffrerFichier(cle, temp, cible);
    const empreinte = await sha256Fichier(cible);
    writeFileSync(`${cible}.sha256`, `${empreinte}  ${nom}.gcsv\n`);
    const taille = statSync(cible).size;
    await journaliserSysteme(pool, "backup.create", "success", { fichier: `${nom}.gcsv`, taille, sha256: empreinte });
    console.log(`Sauvegarde chiffrée : ${cible} (${(taille / 1024).toFixed(0)} Kio)\nSHA-256 : ${empreinte}`);
    console.log("Copiez ce fichier et son .sha256 sur un support séparé. Testez régulièrement la restauration.");
  } catch (e) {
    await journaliserSysteme(pool, "backup.create", "failure", { erreur: (e as Error).message }).catch(() => {});
    throw e;
  } finally {
    rmSync(temp, { force: true });
    await pool.end();
  }
});
