import { sauvegarder } from "../domaine/sauvegarde.js";
import { executer } from "./outils.js";

/**
 * Sauvegarde complète chiffrée. La clé GC_CLE_SAUVEGARDE doit être conservée HORS du serveur :
 * sans elle, la sauvegarde est inutilisable ; avec elle et le fichier, les données sont lisibles.
 */
await executer(async () => {
  const base = process.env.GC_BASE_SAUVEGARDE;
  if (!base) throw new Error("GC_BASE_SAUVEGARDE manque (connexion du rôle gc_backup).");
  const r = await sauvegarder({
    base, cle: Buffer.from(process.env.GC_CLE_SAUVEGARDE ?? "", "base64"), dossier: process.env.GC_DOSSIER_SAUVEGARDES ?? "sauvegardes",
  });
  console.log(`Sauvegarde chiffrée : ${r.fichier} (${(r.taille / 1024).toFixed(0)} Kio)\nSHA-256 : ${r.sha256}`);
  console.log("Copiez ce fichier et son .sha256 sur un support séparé. Testez régulièrement la restauration.");
});
