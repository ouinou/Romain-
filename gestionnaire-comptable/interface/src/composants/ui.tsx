import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ApiErreur } from "../api";

/* ------------------------------------------------------------------ Notifications éphémères */

interface Toast { id: number; texte: string; erreur?: boolean }
const ToastCtx = createContext<(texte: string, erreur?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function FournisseurToasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const afficher = useCallback((texte: string, erreur = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, texte, erreur }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), erreur ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={afficher}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={"toast" + (t.erreur ? " erreur" : "")}>{t.texte}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** Message d'erreur lisible à partir de n'importe quelle exception. */
export const messageErreur = (e: unknown) =>
  e instanceof ApiErreur ? e.message : "Une erreur inattendue s'est produite. Réessayez, puis prévenez votre administrateur si elle persiste.";

/* ------------------------------------------------------------------ Champs */

export function Champ(props: {
  label: string; valeur: string; onChange: (v: string) => void; type?: string; requis?: boolean; aide?: string;
  erreur?: string; autoComplete?: string; placeholder?: string; lectureSeule?: boolean; autoFocus?: boolean; min?: number; max?: number;
  inputMode?: "numeric" | "text" | "email";
}) {
  const id = useId();
  return (
    <div className="champ">
      <label htmlFor={id}>{props.label}{props.requis ? " *" : ""}</label>
      <input id={id} type={props.type ?? "text"} value={props.valeur} onChange={(e) => props.onChange(e.target.value)}
        required={props.requis} autoComplete={props.autoComplete ?? "off"} placeholder={props.placeholder} readOnly={props.lectureSeule}
        autoFocus={props.autoFocus} min={props.min} max={props.max} inputMode={props.inputMode}
        aria-invalid={!!props.erreur} aria-describedby={props.aide || props.erreur ? id + "-aide" : undefined} />
      {props.erreur ? <span id={id + "-aide"} className="erreur-champ">{props.erreur}</span>
        : props.aide ? <span id={id + "-aide"} className="aide">{props.aide}</span> : null}
    </div>
  );
}

export function Selection(props: { label: string; valeur: string; onChange: (v: string) => void; options: [string, string][]; aide?: string }) {
  const id = useId();
  return (
    <div className="champ">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.valeur} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {props.aide ? <span className="aide">{props.aide}</span> : null}
    </div>
  );
}

export function ZoneTexte(props: { label: string; valeur: string; onChange: (v: string) => void; requis?: boolean; aide?: string }) {
  const id = useId();
  return (
    <div className="champ">
      <label htmlFor={id}>{props.label}{props.requis ? " *" : ""}</label>
      <textarea id={id} rows={3} value={props.valeur} onChange={(e) => props.onChange(e.target.value)} required={props.requis} />
      {props.aide ? <span className="aide">{props.aide}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Fenêtre modale accessible */

export function Modale(props: { titre: string; onFermer?: () => void; children: ReactNode; large?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titreId = useId();
  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    const premier = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.btn-fermer)");
    premier?.focus();
    const clavier = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.onFermer) props.onFermer();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("a, button, input, select, textarea")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", clavier);
    return () => { document.removeEventListener("keydown", clavier); precedent?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="voile" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onFermer?.(); }}>
      <div className={"modale" + (props.large ? " large" : "")} role="dialog" aria-modal="true" aria-labelledby={titreId} ref={ref}>
        <h2 id={titreId}>{props.titre}</h2>
        {props.children}
      </div>
    </div>
  );
}

/** Affiche un secret une seule fois, avec un bouton de copie. */
export function SecretUnique({ valeur, explication }: { valeur: string; explication: ReactNode }) {
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const copier = async () => {
    try { await navigator.clipboard.writeText(valeur); toast("Copié dans le presse-papiers."); }
    catch {
      const r = document.createRange(); if (ref.current) { r.selectNodeContents(ref.current); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); }
      toast("Copie automatique impossible : le code est sélectionné, utilisez Ctrl+C.");
    }
  };
  return (
    <>
      <div className="alerte alerte-attention">{explication}</div>
      <div className="secret" ref={ref}>{valeur}</div>
      <div><button className="btn btn-petit" type="button" onClick={copier}>Copier</button></div>
    </>
  );
}

/* ------------------------------------------------------------------ Divers */

export function Pagination({ page, taille, total, onPage }: { page: number; taille: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / taille));
  const debut = total === 0 ? 0 : (page - 1) * taille + 1;
  return (
    <div className="pagination">
      <span className="num">{debut}–{Math.min(page * taille, total)} sur {total}</span>
      <div className="boutons">
        <button className="btn btn-petit" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Précédent</button>
        <span className="num" style={{ alignSelf: "center" }}>Page {page} / {pages}</span>
        <button className="btn btn-petit" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant →</button>
      </div>
    </div>
  );
}

export const Chargement = ({ texte = "Chargement…" }: { texte?: string }) => <div className="chargement" role="status">{texte}</div>;

export function initiales(nom: string) {
  return nom.trim().split(/\s+/).map((m) => m[0] ?? "").slice(0, 2).join("").toUpperCase();
}

export const dateHeure = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const date = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

/** Charge des données et expose un rechargement ; l'erreur est affichée par l'appelant. */
export function useDonnees<T>(charger: () => Promise<T>, deps: unknown[]) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let actif = true;
    setErreur(null);
    charger().then((d) => { if (actif) setDonnees(d); }).catch((e) => { if (actif) setErreur(messageErreur(e)); });
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { donnees, erreur, recharger: () => setVersion((v) => v + 1) };
}

/** Valeur retardée (recherche au fil de la frappe sans saturer le serveur). */
export function useRetarde<T>(valeur: T, ms = 300) {
  const [v, setV] = useState(valeur);
  useEffect(() => { const t = setTimeout(() => setV(valeur), ms); return () => clearTimeout(t); }, [valeur, ms]);
  return v;
}
