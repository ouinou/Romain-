import { useEffect, useId, useState } from "react";
import { api, qs } from "../../api";

/* ------------------------------------------------------------------ Types */
export interface Compte { id: string; numero: string; libelle: string; classe: number; imputable: boolean; actif: boolean; source: string; protege: boolean; utilise: boolean; aVerifier: boolean }
export interface JournalCpt { id: string; code: string; libelle: string; type: string; actif: boolean; validees: number; brouillons: number }
export interface Exercice { id: string; code: string; debut: string; fin: string; statut: "ouvert" | "cloture"; clotureLe: string | null; brouillons: number; validees: number }
export interface LigneEcriture { ordre: number; compteId: string; compte: string; compteLibelle: string; libelle: string | null; debit: number; credit: number }
export interface Ecriture {
  id: string; statut: "brouillard" | "validee"; numero: number | null; journal: { id: string; code: string; libelle: string };
  exercice: { id: string; code: string; ouvert: boolean }; date: string; piece: string; datePiece: string | null; libelle: string;
  auteur: { id: string; nom: string }; creeLe: string; modifieLe: string; validateur: { id: string; nom: string } | null; valideeLe: string | null;
  extourneDe: { id: string; numero: number; journal: string; motif: string } | null; extourneePar: { id: string; numero: number } | null;
  lignes: LigneEcriture[]; totalDebit: number; totalCredit: number; equilibree: boolean;
  origine: { type: "facture" | "avoir" | "mouvement"; id: string; reference: string } | null;
}
export interface EcritureResume { id: string; statut: "brouillard" | "validee"; numero: number | null; date: string; journal: string; piece: string; libelle: string; auteur: string; totalDebit: number; totalCredit: number; equilibree: boolean; extourne: boolean; extournee: boolean; origine: "facture" | "avoir" | "tresorerie" | null }

export const TYPES_JOURNAL: Record<string, string> = {
  purchases: "Achats", sales: "Ventes", bank: "Banque", cash: "Caisse", general: "Opérations diverses", opening: "À-nouveaux",
};

/* ------------------------------------------------------------------ Montants (entiers, FCFA) */
const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
export const formatMontant = (n: number) => fmt.format(n).replace(/ | /g, " ");
/** Montant en FCFA : séparateur de milliers ; un montant négatif s'affiche en rouge. */
export const Montant = ({ v, vide = "" }: { v: number; vide?: string }) =>
  v === 0 && vide ? <>{vide}</> : v < 0 ? <span className="negatif">{formatMontant(v)}</span> : <>{formatMontant(v)}</>;

/** Lecture d'une saisie libre (« 1 500 000 », « 1500000 ») ; NaN si invalide (décimales, lettres, négatif). */
export function lireMontant(texte: string): number {
  const t = texte.replace(/[\s  ]/g, "");
  if (t === "") return 0;
  if (!/^\d{1,15}$/.test(t)) return NaN;
  return Number(t);
}

/** Champ montant : chiffres seulement, mis en forme à la sortie du champ. */
export function ChampMontant({ valeur, onChange, label }: { valeur: string; onChange: (v: string) => void; label: string }) {
  const n = lireMontant(valeur);
  return (
    <input className="montant-saisie" inputMode="numeric" aria-label={label} value={valeur} placeholder="0"
      aria-invalid={Number.isNaN(n)} onChange={(e) => onChange(e.target.value.replace(/[^\d\s  ]/g, ""))}
      onBlur={() => { if (!Number.isNaN(n) && n > 0) onChange(formatMontant(n)); }} />
  );
}

/* ------------------------------------------------------------------ Badges */
export function BadgeEcriture({ e }: { e: { statut: string; equilibree: boolean; extourne?: boolean; extournee?: boolean } | Ecriture }) {
  const ext = "extourneDe" in e ? !!e.extourneDe : !!(e as { extourne?: boolean }).extourne;
  const extee = "extourneePar" in e ? !!e.extourneePar : !!(e as { extournee?: boolean }).extournee;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {e.statut === "validee" ? <span className="badge badge-vert">Validée</span>
        : e.equilibree ? <span className="badge badge-orange">Brouillard</span> : <span className="badge badge-rouge">Brouillard déséquilibré</span>}
      {ext && <span className="badge badge-neutre">Extourne</span>}
      {extee && <span className="badge badge-neutre">Extournée</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ Données de référence */
export function useReference() {
  const [exercices, setExercices] = useState<Exercice[]>([]);
  const [journaux, setJournaux] = useState<JournalCpt[]>([]);
  useEffect(() => {
    api.get<Exercice[]>("/api/comptabilite/exercices").then(setExercices).catch(() => {});
    api.get<JournalCpt[]>("/api/comptabilite/journaux").then(setJournaux).catch(() => {});
  }, []);
  return { exercices, journaux };
}

export const comptesImputables = () => api.get<Compte[]>(`/api/comptabilite/comptes${qs({ imputables: "oui" })}`);

/** Filtres communs des états : exercice, période, compte, journal, brouillons. */
export function FiltresEtats(props: {
  f: { exercice: string; du: string; au: string; compte: string; journal: string; brouillons: boolean };
  set: (f: Partial<{ exercice: string; du: string; au: string; compte: string; journal: string; brouillons: boolean }>) => void;
  avecCompte?: boolean;
}) {
  const { exercices, journaux } = useReference();
  const id = useId();
  return (
    <div className="filtres" role="search">
      <label className="cache-visuel" htmlFor={id + "ex"}>Exercice</label>
      <select id={id + "ex"} className="filtre" value={props.f.exercice} onChange={(e) => props.set({ exercice: e.target.value, du: "", au: "" })}>
        <option value="">Exercice en cours</option>
        {exercices.map((x) => <option key={x.id} value={x.id}>Exercice {x.code}{x.statut === "cloture" ? " (clôturé)" : ""}</option>)}
      </select>
      <label className="cache-visuel" htmlFor={id + "du"}>Du</label>
      <input id={id + "du"} className="filtre" type="date" title="Du" value={props.f.du} onChange={(e) => props.set({ du: e.target.value })} />
      <label className="cache-visuel" htmlFor={id + "au"}>Au</label>
      <input id={id + "au"} className="filtre" type="date" title="Au" value={props.f.au} onChange={(e) => props.set({ au: e.target.value })} />
      {props.avecCompte && <>
        <label className="cache-visuel" htmlFor={id + "cp"}>Compte ou début de numéro</label>
        <input id={id + "cp"} className="filtre" inputMode="numeric" placeholder="Compte (ex. 6 ou 605)" value={props.f.compte} onChange={(e) => props.set({ compte: e.target.value.replace(/\D/g, "").slice(0, 12) })} />
      </>}
      <label className="cache-visuel" htmlFor={id + "jn"}>Journal</label>
      <select id={id + "jn"} className="filtre" value={props.f.journal} onChange={(e) => props.set({ journal: e.target.value })}>
        <option value="">Tous les journaux</option>
        {journaux.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.libelle}</option>)}
      </select>
      <label className="case" style={{ alignSelf: "center" }}>
        <input type="checkbox" checked={props.f.brouillons} onChange={(e) => props.set({ brouillons: e.target.checked })} /> Inclure les brouillards
      </label>
    </div>
  );
}

export const paramsEtats = (f: { exercice: string; du: string; au: string; compte: string; journal: string; brouillons: boolean }) =>
  qs({ exercice: f.exercice, du: f.du, au: f.au, compte: f.compte, journal: f.journal, brouillons: f.brouillons ? "oui" : undefined });

export const dateFr = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
