import { restaurer } from "../domaine/sauvegarde.js";
import { executer, options } from "./outils.js";

const o = options({ fichier: { type: "string" }, "base-cible": { type: "string" }, confirmer: { type: "boolean" } });

await executer(async () => {
  if (!o.fichier || !o["base-cible"]) throw new Error("Usage : npm run restaurer -- --fichier=sauvegardes/gc-....gcsv --base-cible postgres://postgres@localhost/gc_restauration --confirmer");
  if (!o.confirmer) throw new Error("Ajoutez --confirmer pour lancer la restauration.");
  await restaurer({ fichier: o.fichier, baseCible: o["base-cible"], cle: Buffer.from(process.env.GC_CLE_SAUVEGARDE ?? "", "base64") });
  console.log("Restauration terminée. Lancez maintenant journal:verifier sur la base restaurée avant de la mettre en service.");
});
