import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { transaction } from "../db.js";
import { journaliserSysteme, verifierIntegrite } from "../domaine/audit.js";
import { executer, poolProprietaire } from "./outils.js";

/**
 * Vérifie la chaîne d'empreintes de chaque entreprise, puis compare avec les ancrages précédents.
 * Un ancrage est la dernière (séquence, empreinte) relevée, écrit dans un fichier HORS de la base :
 * si des événements récents sont supprimés, ou si toute la chaîne est recalculée, l'ancrage ne correspond plus.
 * Conserver ce fichier sur un autre support (clé USB, autre machine, impression) renforce la détection.
 */
const fichier = process.env.GC_FICHIER_ANCRAGES ?? "ancrages/ancrages-journal.tsv";

await executer(async () => {
  const pool = poolProprietaire();
  let problemes = 0;
  try {
    const anciens = new Map<string, { seq: number; hash: string }>();
    if (existsSync(fichier))
      for (const l of readFileSync(fichier, "utf8").split("\n").filter(Boolean)) {
        const [, entreprise, seq, hash] = l.split("\t");
        anciens.set(entreprise, { seq: Number(seq), hash });
      }
    const { rows: entreprises } = await pool.query("SELECT id, company_code FROM companies ORDER BY company_code");
    mkdirSync(dirname(fichier), { recursive: true });
    for (const e of entreprises) {
      const res = await transaction(pool, e.id, async (c) => {
        const r = await verifierIntegrite(c, e.id);
        const ancre = anciens.get(e.id);
        if (ancre) {
          const { rows: [x] } = await c.query("SELECT event_hash FROM audit_events WHERE company_id = $1 AND sequence_no = $2", [e.id, ancre.seq]);
          if (!x) r.anomalies.push({ sequence: ancre.seq, probleme: "événement ancré absent : suppression des derniers événements" });
          else if (x.event_hash !== ancre.hash) r.anomalies.push({ sequence: ancre.seq, probleme: "empreinte différente de l'ancrage : chaîne recalculée" });
        }
        return r;
      });
      const ok = res.anomalies.length === 0;
      if (!ok) problemes++;
      console.log(`${ok ? "OK      " : "ANOMALIE"} ${e.company_code} : ${res.total} événement(s), dernière séquence ${res.derniereSequence}`);
      for (const a of res.anomalies) console.log(`         séquence ${a.sequence} : ${a.probleme}`);
      if (ok && res.derniereEmpreinte)
        appendFileSync(fichier, [new Date().toISOString(), e.id, res.derniereSequence, res.derniereEmpreinte, e.company_code].join("\t") + "\n");
      await journaliserSysteme(pool, "audit.verify", ok ? "success" : "failure", { entreprise: e.company_code, anomalies: res.anomalies });
    }
    if (problemes) { console.log(`\n${problemes} entreprise(s) avec anomalies. Conservez la base en l'état et prévenez le responsable sécurité.`); process.exitCode = 2; }
    else console.log(`\nJournaux intègres. Ancrages ajoutés à ${fichier}.`);
  } finally { await pool.end(); }
});
