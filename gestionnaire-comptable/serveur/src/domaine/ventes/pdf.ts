import PDFDocument from "pdfkit";
import { montantEnLettres } from "./lettres.js";

/**
 * Facture PDF (A4) générée à partir des données FIGÉES de la facture : le même numéro produit toujours le même
 * contenu. Polices standard Helvetica (accents français pris en charge) ; aucune ressource externe.
 */
export interface FacturePdf {
  numero: string; date: string; type: string;
  vendeur: { raisonSociale: string; niu?: string | null; rccm?: string | null; adresse?: string | null; telephone?: string | null };
  client: { nom: string; niu?: string | null; adresse?: string | null; telephone?: string | null };
  lignes: { designation: string; quantite: string; prixUnitaire: number; montant: number }[];
  totalHt: number; tauxTvaPdm: number; totalTva: number; totalTtc: number; devise: string;
  paiement: string; paye: number; note?: string | null; mentions?: string | null;
}

const NUIT = "#101d35", ORANGE = "#ff6a00", GRIS = "#5d6d80", LIGNE = "#dfe5ec";
// Espace fine ordinaire : les polices standard du PDF ne contiennent pas l'espace insécable fine.
const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, " ");
const dateFr = (d: string) => d.split("-").reverse().join("/");
const taux = (pdm: number) => (pdm / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";

export function genererFacturePdf(f: FacturePdf): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Facture ${f.numero}`, Author: f.vendeur.raisonSociale, Producer: "Gestionnaire Comptable" } });
    const morceaux: Buffer[] = [];
    doc.on("data", (b: Buffer) => morceaux.push(b));
    doc.on("end", () => ok(Buffer.concat(morceaux)));
    doc.on("error", ko);
    const L = 48, R = doc.page.width - 48, W = R - L;

    // En-tête : vendeur à gauche, titre à droite.
    doc.rect(0, 0, doc.page.width, 8).fill(ORANGE);
    doc.fillColor(NUIT).font("Helvetica-Bold").fontSize(15).text(f.vendeur.raisonSociale, L, 36, { width: W * 0.55 });
    doc.font("Helvetica").fontSize(9).fillColor(GRIS);
    for (const l of [f.vendeur.adresse, f.vendeur.telephone && `Tél. : ${f.vendeur.telephone}`, f.vendeur.niu && `NIU : ${f.vendeur.niu}`, f.vendeur.rccm && `RCCM : ${f.vendeur.rccm}`].filter(Boolean))
      doc.text(String(l), { width: W * 0.55 });
    doc.font("Helvetica-Bold").fontSize(22).fillColor(NUIT).text("FACTURE", L + W * 0.55, 36, { width: W * 0.45, align: "right" });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ORANGE).text(`N° ${f.numero}`, { width: W * 0.45, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`Date : ${dateFr(f.date)}`, { width: W * 0.45, align: "right" })
      .text(f.type, { width: W * 0.45, align: "right" });

    // Bloc client.
    let y = Math.max(doc.y, 130) + 14;
    doc.roundedRect(L + W * 0.5, y, W * 0.5, 74, 6).lineWidth(0.8).strokeColor(LIGNE).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GRIS).text("FACTURÉ À", L + W * 0.5 + 12, y + 10);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(NUIT).text(f.client.nom, L + W * 0.5 + 12, y + 22, { width: W * 0.5 - 24 });
    doc.font("Helvetica").fontSize(9).fillColor(GRIS);
    for (const l of [f.client.adresse, f.client.telephone && `Tél. : ${f.client.telephone}`, f.client.niu && `NIU : ${f.client.niu}`].filter(Boolean))
      doc.text(String(l), { width: W * 0.5 - 24 });
    y += 94;

    // Tableau des lignes.
    const col = { des: L + 8, qte: L + W * 0.55, pu: L + W * 0.68, mt: L + W * 0.84 };
    const entete = (yy: number) => {
      doc.rect(L, yy, W, 22).fill(NUIT);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
        .text("Désignation", col.des, yy + 7).text("Quantité", col.qte, yy + 7, { width: W * 0.12, align: "right" })
        .text("Prix unitaire", col.pu, yy + 7, { width: W * 0.15, align: "right" }).text(`Montant (${f.devise})`, col.mt - 4, yy + 7, { width: W * 0.16 - 4, align: "right" });
      return yy + 22;
    };
    y = entete(y);
    doc.font("Helvetica").fontSize(9.5);
    for (const [i, l] of f.lignes.entries()) {
      const h = Math.max(20, doc.heightOfString(l.designation, { width: W * 0.53 - 8 }) + 10);
      if (y + h > doc.page.height - 200) { doc.addPage(); y = entete(48); doc.font("Helvetica").fontSize(9.5); }
      if (i % 2) doc.rect(L, y, W, h).fill("#f7f9fb");
      doc.fillColor(NUIT).text(l.designation, col.des, y + 5, { width: W * 0.53 - 8 })
        .text(l.quantite, col.qte, y + 5, { width: W * 0.12, align: "right" })
        .text(fmt(l.prixUnitaire), col.pu, y + 5, { width: W * 0.15, align: "right" })
        .text(fmt(l.montant), col.mt - 4, y + 5, { width: W * 0.16 - 4, align: "right" });
      y += h;
    }
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).strokeColor(LIGNE).stroke();

    // Totaux.
    y += 10;
    const total = (lib: string, v: string, fort = false) => {
      doc.font(fort ? "Helvetica-Bold" : "Helvetica").fontSize(fort ? 11 : 9.5).fillColor(NUIT)
        .text(lib, L + W * 0.5, y, { width: W * 0.3 }).text(v, L + W * 0.8, y, { width: W * 0.2 - 4, align: "right" });
      y += fort ? 20 : 16;
    };
    total("Total hors taxes", fmt(f.totalHt));
    total(f.tauxTvaPdm ? `TVA (${taux(f.tauxTvaPdm)})` : "TVA", f.tauxTvaPdm ? fmt(f.totalTva) : "Non applicable");
    doc.rect(L + W * 0.5, y - 3, W * 0.5, 24).fill("#fff1e7");
    total(`Net à payer (${f.devise})`, fmt(f.totalTtc), true);

    y += 10;
    doc.font("Helvetica").fontSize(9.5).fillColor(NUIT)
      .text(`Arrêtée la présente facture à la somme de : `, L, y, { continued: true })
      .font("Helvetica-Bold").text(`${montantEnLettres(f.totalTtc)}.`, { width: W });
    y = doc.y + 8;
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`Règlement : ${f.paiement}${f.paye > 0 && f.paye < f.totalTtc ? ` (déjà réglé : ${fmt(f.paye)} ${f.devise})` : ""}`, L, y);
    if (f.note) doc.text(`Observation : ${f.note}`, L, doc.y + 2, { width: W });
    if (f.mentions) doc.text(f.mentions, L, doc.y + 6, { width: W });

    // Pied de page.
    const bas = doc.page.height - 40;
    doc.moveTo(L, bas - 8).lineTo(R, bas - 8).lineWidth(0.5).strokeColor(LIGNE).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIS)
      .text(`${f.vendeur.raisonSociale}${f.vendeur.niu ? ` · NIU ${f.vendeur.niu}` : ""}${f.vendeur.rccm ? ` · RCCM ${f.vendeur.rccm}` : ""} · Facture ${f.numero} · Document émis par Gestionnaire Comptable`,
        L, bas, { width: W, align: "center", lineBreak: false });
    doc.end();
  });
}
