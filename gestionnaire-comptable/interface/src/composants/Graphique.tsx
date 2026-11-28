/**
 * Graphique en courbes (SVG dessiné ici, aucune bibliothèque externe) : plusieurs séries mensuelles en FCFA.
 * Survol ou clavier : la valeur de chaque série pour le mois s'affiche. Un tableau caché donne les mêmes chiffres
 * aux lecteurs d'écran. Les couleurs suivent la charte de l'entreprise (variables CSS).
 */
import { useEffect, useRef, useState } from "react";
import { formatMontant } from "../pages/comptabilite/commun";

export interface Serie { nom: string; couleur: string; valeurs: number[] }

const MOIS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
export const libelleMois = (aaaamm: string) => MOIS.at(Number(aaaamm.slice(5, 7)) - 1) ?? aaaamm;
/** 1 250 000 → « 1,25 M » ; 85 000 → « 85 k ». */
const court = (v: number) => v >= 1e6 ? `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M` : v >= 1e3 ? `${(v / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k` : String(v);

/** Graduation « ronde » : 1, 2 ou 5 × 10^n, de façon à avoir 4 ou 5 intervalles. */
function graduation(max: number) {
  if (max <= 0) return { haut: 1000, pas: 250 };
  const brut = max / 4, puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) ?? 10 * puissance;
  return { haut: Math.ceil(max / pas) * pas, pas };
}

export function Graphique({ mois, series, titre }: { mois: string[]; series: Serie[]; titre: string }) {
  const boite = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(640);
  const [survol, setSurvol] = useState<number | null>(null);
  useEffect(() => {
    if (!boite.current) return;
    const o = new ResizeObserver(([e]) => setLargeur(Math.max(280, Math.round(e.contentRect.width))));
    o.observe(boite.current);
    return () => o.disconnect();
  }, []);
  const H = 240, G = 58, D = 16, HAUT = 14, BAS = 30;
  const { haut, pas } = graduation(Math.max(0, ...series.flatMap((s) => s.valeurs)));
  const x = (i: number) => G + (mois.length < 2 ? 0 : (i * (largeur - G - D)) / (mois.length - 1));
  const y = (v: number) => HAUT + (1 - v / haut) * (H - HAUT - BAS);
  const graduations = Array.from({ length: Math.round(haut / pas) + 1 }, (_, i) => i * pas);
  const resume = series.map((s) => `${s.nom} : ${s.valeurs.map((v, i) => `${libelleMois(mois[i])} ${formatMontant(v)}`).join(", ")}`).join(". ");
  return (
    <div className="graphique" ref={boite}>
      <svg width={largeur} height={H} viewBox={`0 0 ${largeur} ${H}`} role="img" aria-label={`${titre}. ${resume} (FCFA).`}
        onMouseLeave={() => setSurvol(null)} tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); setSurvol((s) => Math.min((s ?? -1) + 1, mois.length - 1)); }
          if (e.key === "ArrowLeft") { e.preventDefault(); setSurvol((s) => Math.max((s ?? mois.length) - 1, 0)); }
        }}>
        {graduations.map((g) => (
          <g key={g}>
            <line x1={G} x2={largeur - D} y1={y(g)} y2={y(g)} stroke="var(--ligne-2)" />
            <text x={G - 8} y={y(g) + 4} textAnchor="end" fontSize="11.5" fill="var(--discret)">{court(g)}</text>
          </g>
        ))}
        <line x1={G} x2={largeur - D} y1={y(0)} y2={y(0)} stroke="var(--bordure)" />
        {mois.map((m, i) => (
          <text key={m} x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--noir)" fontWeight={survol === i ? 700 : 400}>{libelleMois(m)}</text>
        ))}
        {survol !== null && <line x1={x(survol)} x2={x(survol)} y1={HAUT} y2={y(0)} stroke="var(--bordure)" strokeDasharray="3 3" />}
        {series.map((s) => (
          <g key={s.nom}>
            <polyline points={s.valeurs.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.couleur} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {s.valeurs.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={survol === i ? 5.5 : 4} fill={s.couleur} stroke="var(--blanc)" strokeWidth="1.5" />)}
          </g>
        ))}
        {/* Zones de survol, une par mois. */}
        {mois.map((m, i) => (
          <rect key={m} x={x(i) - (largeur - G - D) / Math.max(1, mois.length - 1) / 2} y={0} width={(largeur - G - D) / Math.max(1, mois.length - 1)} height={H}
            fill="transparent" onMouseEnter={() => setSurvol(i)} />
        ))}
      </svg>
      {survol !== null && (
        <div className="infobulle-graphique" style={{ left: Math.min(Math.max(x(survol) - 120, 0), largeur - 240), top: 6 }} role="status">
          <b>{libelleMois(mois[survol])} {mois[survol].slice(0, 4)}</b>
          {series.map((s) => <div key={s.nom}><span className="puce" style={{ background: s.couleur }} />{s.nom} : <b className="num">{formatMontant(s.valeurs[survol])}</b> FCFA</div>)}
        </div>
      )}
      <div className="legende">
        {series.map((s) => <span key={s.nom}><span className="trait" style={{ background: s.couleur }} />{s.nom}</span>)}
      </div>
      <table className="cache-visuel">
        <caption>{titre} (FCFA)</caption>
        <thead><tr><th>Mois</th>{series.map((s) => <th key={s.nom}>{s.nom}</th>)}</tr></thead>
        <tbody>{mois.map((m, i) => <tr key={m}><td>{libelleMois(m)} {m.slice(0, 4)}</td>{series.map((s) => <td key={s.nom}>{formatMontant(s.valeurs[i])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
