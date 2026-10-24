import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { montantEnLettres } from "./lettres.js";

/**
 * Facture PDF (A4) générée à partir des données FIGÉES de la facture : le même numéro produit toujours le même
 * contenu. Polices standard Helvetica (accents français pris en charge) ; aucune ressource externe.
 */
export interface FacturePdf {
  numero: string; date: string; type: string;
  vendeur: { raisonSociale: string; niu?: string | null; rccm?: string | null; adresse?: string | null; telephone?: string | null;
    email?: string | null; regimeFiscal?: string | null; patente?: string | null; couleurs?: { principale: string; accent: string } };
  client: { nom: string; niu?: string | null; adresse?: string | null; telephone?: string | null };
  lignes: { designation: string; quantite: string; prixUnitaire: number; montant: number }[];
  totalHt: number; tauxTvaPdm: number; totalTva: number; totalTtc: number; devise: string;
  paiement: string; paye: number; note?: string | null; mentions?: string | null;
  /** Contenu du code QR (code de vérification signé). */
  codeVerification?: string;
  /** Logo PNG ou JPEG figé à l'émission. */
  logo?: Buffer;
  /** Document d'avoir : il cite sa facture et son motif ; « paiement » décrit alors le traitement (imputation ou remboursement). */
  avoir?: { facture: string; dateFacture: string; motif: string };
}

const GRIS = "#5d6d80", LIGNE = "#dfe5ec", ENCRE = "#17263b";
/** Luminance relative (WCAG) d'une couleur #RRGGBB. */
export function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** Couleur lisible sur fond blanc (contraste 4,5:1 au moins) : la couleur choisie, assombrie si besoin. */
export function lisibleSurBlanc(hex: string) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let k = 0; k < 40 && contraste(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`, "#ffffff") < 4.5; k++) [r, g, b] = [r, g, b].map((v) => Math.floor(v * 0.92));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
/** Texte blanc ou foncé, selon ce qui se lit le mieux sur le fond donné. */
export const texteSur = (fond: string) => (contraste(fond, "#ffffff") >= contraste(fond, ENCRE) ? "#ffffff" : ENCRE);
// Espace fine ordinaire : les polices standard du PDF ne contiennent pas l'espace insécable fine.
const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, " ");
const dateFr = (d: string) => d.split("-").reverse().join("/");
const taux = (pdm: number) => (pdm / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";

export async function genererFacturePdf(f: FacturePdf): Promise<Buffer> {
  const qr = f.codeVerification ? await QRCode.toBuffer(f.codeVerification, { errorCorrectionLevel: "M", margin: 1, width: 300 }) : null;
  const PRINC = f.vendeur.couleurs?.principale ?? "#062b68", ACCENT = f.vendeur.couleurs?.accent ?? "#0647a9";
  const NUIT = lisibleSurBlanc(PRINC), ORANGE_TXT = lisibleSurBlanc(ACCENT), SUR_PRINC = texteSur(PRINC);
  return new Promise((ok, ko) => {
    const nom = f.avoir ? "Avoir" : "Facture";
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${nom} ${f.numero}`, Author: f.vendeur.raisonSociale, Producer: "FINEXA ERP" } });
    const morceaux: Buffer[] = [];
    doc.on("data", (b: Buffer) => morceaux.push(b));
    doc.on("end", () => ok(Buffer.concat(morceaux)));
    doc.on("error", ko);
    const L = 48, R = doc.page.width - 48, W = R - L;

    // En-tête : logo et identité complète du vendeur à gauche, titre à droite.
    doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
    let xId = L;
    if (f.logo) {
      try { doc.image(f.logo, L, 30, { fit: [72, 72] }); xId = L + 84; }
      catch { /* image illisible : en-tête sans logo plutôt qu'une facture impossible à produire */ }
    }
    const lId = W * 0.58 - (xId - L);
    doc.fillColor(NUIT).font("Helvetica-Bold").fontSize(15).text(f.vendeur.raisonSociale, xId, 32, { width: lId });
    doc.font("Helvetica").fontSize(8.5).fillColor(GRIS);
    const v = f.vendeur;
    // Une information par ligne : un identifiant (RCCM, patente…) n'est jamais coupé en deux.
    for (const l of [v.adresse, v.telephone && `Tél. : ${v.telephone}`, v.email, v.niu && `NIU : ${v.niu}`, v.rccm && `RCCM : ${v.rccm}`,
      v.regimeFiscal && `Régime fiscal : ${v.regimeFiscal}`, v.patente && `Patente : ${v.patente}`].filter(Boolean))
      doc.text(String(l), xId, doc.y + 1, { width: lId });
    const basEntete = Math.max(doc.y, f.logo ? 104 : 0);
    doc.font("Helvetica-Bold").fontSize(22).fillColor(NUIT).text(nom.toUpperCase(), L + W * 0.58, 32, { width: W * 0.42, align: "right" });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ORANGE_TXT).text(`N° ${f.numero}`, { width: W * 0.42, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`Date : ${dateFr(f.date)}`, { width: W * 0.45, align: "right" })
      .text(f.type, { width: W * 0.45, align: "right" });
    if (f.avoir) doc.font("Helvetica-Bold").fillColor(NUIT).text(`Sur la facture ${f.avoir.facture} du ${dateFr(f.avoir.dateFacture)}`, { width: W * 0.45, align: "right" });

    // Bloc client.
    let y = Math.max(doc.y, basEntete, 130) + 14;
    doc.roundedRect(L + W * 0.5, y, W * 0.5, 74, 6).lineWidth(0.8).strokeColor(LIGNE).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GRIS).text(f.avoir ? "CLIENT" : "FACTURÉ À", L + W * 0.5 + 12, y + 10);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(NUIT).text(f.client.nom, L + W * 0.5 + 12, y + 22, { width: W * 0.5 - 24 });
    doc.font("Helvetica").fontSize(9).fillColor(GRIS);
    for (const l of [f.client.adresse, f.client.telephone && `Tél. : ${f.client.telephone}`, f.client.niu && `NIU : ${f.client.niu}`].filter(Boolean))
      doc.text(String(l), { width: W * 0.5 - 24 });
    y += 94;

    // Tableau des lignes.
    const col = { des: L + 8, qte: L + W * 0.55, pu: L + W * 0.68, mt: L + W * 0.84 };
    const entete = (yy: number) => {
      doc.rect(L, yy, W, 22).fill(PRINC);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(SUR_PRINC)
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

    // Totaux, et à gauche le code QR de vérification.
    y += 10;
    if (y + 120 > doc.page.height - 60) { doc.addPage(); y = 48; }
    if (qr) {
      doc.image(qr, L, y, { width: 92 });
      doc.font("Helvetica").fontSize(7).fillColor(GRIS).text("Code de vérification.\nÀ scanner dans FINEXA ERP,\nécran « Vérifier une facture »,\npour contrôler l'authenticité\nde ce document.",
        L + 98, y + 6, { width: W * 0.5 - 110 });
    }
    const yQr = y + (qr ? 96 : 0);
    const total = (lib: string, v: string, fort = false) => {
      doc.font(fort ? "Helvetica-Bold" : "Helvetica").fontSize(fort ? 11 : 9.5).fillColor(NUIT)
        .text(lib, L + W * 0.5, y, { width: W * 0.3 }).text(v, L + W * 0.8, y, { width: W * 0.2 - 4, align: "right" });
      y += fort ? 20 : 16;
    };
    total("Total hors taxes", fmt(f.totalHt));
    total(f.tauxTvaPdm ? `TVA (${taux(f.tauxTvaPdm)})` : "TVA", f.tauxTvaPdm ? fmt(f.totalTva) : "Non applicable");
    doc.rect(L + W * 0.5, y - 3, W * 0.5, 24).fill("#f3f5f8");
    total(f.avoir ? `Montant de l'avoir (${f.devise})` : `Net à payer (${f.devise})`, fmt(f.totalTtc), true);

    y = Math.max(y, yQr) + 10;
    doc.font("Helvetica").fontSize(9.5).fillColor(NUIT)
      .text(f.avoir ? "Arrêté le présent avoir à la somme de : " : "Arrêtée la présente facture à la somme de : ", L, y, { continued: true })
      .font("Helvetica-Bold").text(`${montantEnLettres(f.totalTtc)}.`, { width: W });
    y = doc.y + 8;
    if (f.avoir) {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NUIT).text(`Motif : ${f.avoir.motif}`, L, y, { width: W });
      y = doc.y + 4;
    }
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`${f.avoir ? "Traitement" : "Règlement"} : ${f.paiement}${f.paye > 0 && f.paye < f.totalTtc ? ` (déjà réglé : ${fmt(f.paye)} ${f.devise})` : ""}`, L, y);
    if (f.note) doc.text(`Observation : ${f.note}`, L, doc.y + 2, { width: W });
    if (f.mentions) doc.text(f.mentions, L, doc.y + 6, { width: W });

    // Pied de page.
    const bas = doc.page.height - 40;
    doc.moveTo(L, bas - 8).lineTo(R, bas - 8).lineWidth(0.5).strokeColor(LIGNE).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIS)
      .text(`${f.vendeur.raisonSociale}${f.vendeur.niu ? ` · NIU ${f.vendeur.niu}` : ""}${f.vendeur.rccm ? ` · RCCM ${f.vendeur.rccm}` : ""} · ${nom} ${f.numero} · Document émis par FINEXA ERP`,
        L, bas, { width: W, align: "center", lineBreak: false });
    doc.end();
  });
}
