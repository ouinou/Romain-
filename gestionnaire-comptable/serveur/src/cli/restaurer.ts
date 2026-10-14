import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { creerPool } from "../db.js";
import { dechiffrerFichier, sha256Fichier } from "../securite/fichier-chiffre.js";
import { executable, executer, lancer, options } from "./outils.js";

/**
 * Restaure une sauvegarde chiffrée dans une base VIDE (jamais par-dessus la base en service).
 * Se fait avec un compte superutilisateur PostgreSQL : opération d'administration technique.
 */
const o = options({ fichier: { type: "string" }, "base-cible": { type: "string" }, confirmer: { type: "boolean" } });

await executer(async () => {
  if (!o.fichier || !o["base-cible"]) throw new Error("Usage : npm run restaurer -- --fichier sauvegardes/gc-....gcsv --base-cible postgres://postgres@localhost/gc_restauration --confirmer");
  if (!o.confirmer) throw new Error("Ajoutez --confirmer pour lancer la restauration.");
  const cle = Buffer.from(process.env.GC_CLE_SAUVEGARDE ?? "", "base64");
  if (cle.length !== 32) throw new Error("GC_CLE_SAUVEGARDE doit contenir 32 octets encodés en base64.");
  if (existsSync(`${o.fichier}.sha256`)) {
    const attendu = readFileSync(`${o.fichier}.sha256`, "utf8").split(/\s+/)[0];
    if ((await sha256Fichier(o.fichier)) !== attendu) throw new Error("L'empreinte SHA-256 ne correspond pas : fichier altéré ou incomplet.");
  }
  const cible = creerPool(o["base-cible"], 1);
  const temp = join(tmpdir(), `${basename(o.fichier)}.dump`);
  try {
    const { rows: [{ n }] } = await cible.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
    if (n > 0) throw new Error("La base cible n'est pas vide. Créez une base neuve pour la restauration.");
    await dechiffrerFichier(cle, o.fichier, temp);
    await lancer(executable("pg_restore"), ["--exit-on-error", "--no-password", `--dbname=${o["base-cible"]}`, temp]);
    await cible.query("INSERT INTO system_events (event_type, outcome, details) VALUES ('backup.restore','success',$1)", [JSON.stringify({ fichier: basename(o.fichier) })]);
    console.log("Restauration terminée. Lancez maintenant journal:verifier sur la base restaurée avant de la mettre en service.");
  } finally {
    rmSync(temp, { force: true });
    await cible.end();
  }
});
