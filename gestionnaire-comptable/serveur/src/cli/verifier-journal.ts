import { controlerJournaux } from "../domaine/controle-journal.js";
import { executer, poolProprietaire } from "./outils.js";

/**
 * À planifier chaque soir. GC_FICHIER_ANCRAGES et GC_DOSSIER_COPIE_JOURNAL doivent idéalement pointer
 * vers un support que l'administrateur technique du serveur ne contrôle pas seul (disque externe, partage
 * d'un autre poste, NAS), sinon la même personne pourrait effacer à la fois la base et la copie.
 */
await executer(async () => {
  const pool = poolProprietaire();
  try {
    const res = await controlerJournaux(pool, {
      fichierAncrages: process.env.GC_FICHIER_ANCRAGES ?? "ancrages/ancrages-journal.tsv",
      dossierCopie: process.env.GC_DOSSIER_COPIE_JOURNAL || undefined,
    });
    for (const r of res) {
      console.log(`${r.valide ? "OK      " : "ANOMALIE"} ${r.code} : ${r.total} événement(s), dernière séquence ${r.derniereSequence}${r.copies ? `, ${r.copies} copié(s)` : ""}`);
      for (const a of r.anomalies) console.log(`         séquence ${a.sequence} : ${a.probleme}`);
    }
    const ko = res.filter((r) => !r.valide).length;
    if (ko) { console.log(`\n${ko} entreprise(s) avec anomalies. Conservez la base en l'état et prévenez le responsable sécurité.`); process.exitCode = 2; }
    else console.log("\nJournaux intègres.");
  } finally { await pool.end(); }
});
