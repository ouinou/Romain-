import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { transaction, type Pool } from "../db.js";
import { journaliserSysteme, verifierIntegrite, type Integrite } from "./audit.js";

export interface ResultatControle extends Integrite { code: string; copies: number }

/** Dernière ligne non vide d'un fichier texte, ou null. */
function derniereLigne(chemin: string) {
  if (!existsSync(chemin)) return null;
  const lignes = readFileSync(chemin, "utf8").split("\n").filter(Boolean);
  return lignes.at(-1) ?? null;
}

/**
 * Contrôle des journaux de toutes les entreprises :
 *  1. recalcul de la chaîne d'empreintes ;
 *  2. comparaison avec le dernier ancrage (séquence + empreinte) noté HORS de la base ;
 *  3. si dossierCopie est fourni, copie des nouveaux événements dans <dossier>/<CODE>.jsonl
 *     (support distinct contrôlé par l'entreprise) et contrôle que le dernier événement copié
 *     est toujours identique en base.
 * Un nouvel ancrage n'est ajouté que si tout est conforme.
 */
export async function controlerJournaux(pool: Pool, o: { fichierAncrages: string; dossierCopie?: string }): Promise<ResultatControle[]> {
  const ancres = new Map<string, { seq: number; hash: string }>();
  if (existsSync(o.fichierAncrages))
    for (const l of readFileSync(o.fichierAncrages, "utf8").split("\n").filter(Boolean)) {
      const [, entreprise, seq, hash] = l.split("\t");
      ancres.set(entreprise, { seq: Number(seq), hash });
    }
  mkdirSync(dirname(o.fichierAncrages), { recursive: true });
  if (o.dossierCopie) mkdirSync(o.dossierCopie, { recursive: true });

  const { rows: entreprises } = await pool.query("SELECT id, company_code FROM companies ORDER BY company_code");
  const resultats: ResultatControle[] = [];
  for (const e of entreprises) {
    const r = await transaction(pool, e.id, async (c) => {
      const res: ResultatControle = { ...(await verifierIntegrite(c, e.id)), code: e.company_code, copies: 0 };
      const ancre = ancres.get(e.id);
      if (ancre) {
        const { rows: [x] } = await c.query("SELECT event_hash FROM audit_events WHERE company_id = $1 AND sequence_no = $2", [e.id, ancre.seq]);
        if (!x) res.anomalies.push({ sequence: ancre.seq, probleme: "événement ancré absent : suppression des derniers événements" });
        else if (x.event_hash !== ancre.hash) res.anomalies.push({ sequence: ancre.seq, probleme: "empreinte différente de l'ancrage : chaîne recalculée" });
      }
      if (o.dossierCopie) {
        const fichier = join(o.dossierCopie, `${e.company_code}.jsonl`);
        const derniere = derniereLigne(fichier);
        let depuis = 0;
        if (derniere) {
          const ev = JSON.parse(derniere) as { sequence_no: string; event_hash: string };
          depuis = Number(ev.sequence_no);
          const { rows: [x] } = await c.query("SELECT event_hash FROM audit_events WHERE company_id = $1 AND sequence_no = $2", [e.id, depuis]);
          if (!x || x.event_hash !== ev.event_hash)
            res.anomalies.push({ sequence: depuis, probleme: "le dernier événement copié sur le support externe ne correspond plus à la base" });
        }
        const { rows } = await c.query(
          `SELECT a.*, host(a.ip_address) AS ip_address FROM audit_events a WHERE a.company_id = $1 AND a.sequence_no > $2 ORDER BY a.sequence_no`, [e.id, depuis]);
        if (rows.length) appendFileSync(fichier, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
        res.copies = rows.length;
      }
      res.valide = res.anomalies.length === 0;
      return res;
    });
    if (r.valide && r.derniereEmpreinte)
      appendFileSync(o.fichierAncrages, [new Date().toISOString(), e.id, r.derniereSequence, r.derniereEmpreinte, e.company_code].join("\t") + "\n");
    await journaliserSysteme(pool, "audit.verify", r.valide ? "success" : "failure", { entreprise: e.company_code, anomalies: r.anomalies, copies: r.copies });
    resultats.push(r);
  }
  return resultats;
}
