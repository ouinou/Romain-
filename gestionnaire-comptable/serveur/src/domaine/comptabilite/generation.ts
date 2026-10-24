import type { Client } from "../../db.js";
import { ErreurHttp } from "../../http/erreurs.js";

/**
 * Écriture comptable générée par une opération (vente, mouvement de trésorerie).
 * Toujours créée en BROUILLARD : le comptable la valide ensuite (séparation des tâches).
 * Elle reste liée à son opération d'origine et ne se modifie pas depuis la comptabilité.
 */
export interface LigneGeneree { compteId: string; debit: number; credit: number; libelle?: string | null }

export async function exerciceOuvertPour(c: Client, date: string) {
  const { rows: [f] } = await c.query("SELECT id FROM fiscal_years WHERE status = 'open' AND $1::date BETWEEN start_date AND end_date", [date]);
  if (!f) throw new ErreurHttp(409, "exercice_absent", `Aucun exercice comptable ouvert ne contient la date du ${date.split("-").reverse().join("/")}.`);
  return f.id as string;
}

export async function genererEcriture(c: Client, e: {
  journalId: string; date: string; piece: string; libelle: string; auteur: string;
  source: { type: "treasury_movement" | "invoice" | "credit_note"; id: string }; lignes: LigneGeneree[];
}) {
  const lignes = e.lignes.filter((l) => l.debit > 0 || l.credit > 0);
  const exercice = await exerciceOuvertPour(c, e.date);
  const { rows: [x] } = await c.query(
    `INSERT INTO journal_entries (fiscal_year_id, journal_id, entry_date, piece_reference, label, created_by, source_type, source_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [exercice, e.journalId, e.date, e.piece.slice(0, 60), e.libelle.slice(0, 200), e.auteur, e.source.type, e.source.id]);
  for (const [i, l] of lignes.entries())
    await c.query("INSERT INTO entry_lines (entry_id, line_no, account_id, label, debit, credit) VALUES ($1,$2,$3,$4,$5,$6)",
      [x.id, i + 1, l.compteId, l.libelle ?? null, l.debit, l.credit]);
  return x.id as string;
}

/** Identifiant d'un compte imputable et actif, par son numéro (comptes de référence utilisés par les opérations). */
export async function compteParNumero(c: Client, numero: string) {
  const { rows: [a] } = await c.query("SELECT id, postable, active FROM accounts WHERE account_number = $1", [numero]);
  if (!a || !a.postable || !a.active)
    throw new ErreurHttp(409, "compte_manquant", `Le compte ${numero} est absent, archivé ou non imputable dans le plan comptable : l'opération ne peut pas être comptabilisée.`);
  return a.id as string;
}
