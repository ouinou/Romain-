import PDFDocument from "pdfkit";
import { COULEURS_DEFAUT, FINEXA, NOM_LOGICIEL } from "../marque.js";
import QRCode from "qrcode";
import { montantEnLettres } from "./lettres.js";
import type { Client } from "../../db.js";
import { lignesIdentite, type IdentiteDocument } from "../profil-entreprise.js";

/**
 * Documents PDF (facture, avoir, reçu) générés à partir des données FIGÉES du document : le même numéro produit
 * toujours le même contenu. L'en-tête et le pied viennent de l'identité de l'entreprise figée à l'émission
 * (domaine/profil-entreprise.ts). Polices standard Helvetica (accents français pris en charge) ; aucune ressource externe.
 */
interface DocumentPdf {
  vendeur: IdentiteDocument;
  /** Logo PNG ou JPEG figé à l'émission. */
  logo?: Buffer;
  /** Cachet ou signature scannée figé à l'émission (si l'entreprise a choisi de l'imprimer). */
  cachet?: Buffer;
}
export interface FacturePdf extends DocumentPdf {
  numero: string; date: string; type: string;
  client: { nom: string; niu?: string | null; adresse?: string | null; telephone?: string | null };
  lignes: { designation: string; quantite: string; prixUnitaire: number; montant: number }[];
  totalHt: number; tauxTvaPdm: number; totalTva: number; totalTtc: number; devise: string;
  paiement: string; paye: number; note?: string | null; mentions?: string | null;
  /** Contenu du code QR (code de vérification signé). */
  codeVerification?: string;
  /** Document d'avoir : il cite sa facture et son motif ; « paiement » décrit alors le traitement (imputation ou remboursement). */
  avoir?: { facture: string; dateFacture: string; motif: string };
}

// Couleurs du document : identité FINEXA ERP (domaine/marque.ts) ; le bandeau et les titres prennent celles de l'entreprise.
const GRIS = FINEXA.textMuted, LIGNE = FINEXA.border, ENCRE = FINEXA.text, BLANC = FINEXA.white, FOND = FINEXA.background;
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
export const texteSur = (fond: string) => (contraste(fond, BLANC) >= contraste(fond, ENCRE) ? BLANC : ENCRE);
// Espace fine ordinaire : les polices standard du PDF ne contiennent pas l'espace insécable fine.
const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, " ");
const dateFr = (d: string) => d.split("-").reverse().join("/");
const taux = (pdm: number) => (pdm / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";

/** Images figées d'un document (logo, cachet), lues dans la base de l'entreprise. */
export async function imagesDocument(c: Client, v: { logoId?: string | null; cachetId?: string | null }) {
  const lire = async (id?: string | null) => (id ? (await c.query("SELECT data FROM company_logos WHERE id = $1", [id])).rows[0]?.data as Buffer | undefined : undefined);
  return { logo: await lire(v.logoId), cachet: await lire(v.cachetId) };
}

const L = 48;
function couleurs(v: IdentiteDocument) {
  const PRINC = v.couleurs?.principale ?? COULEURS_DEFAUT.principale, ACCENT = v.couleurs?.accent ?? COULEURS_DEFAUT.accent;
  return { PRINC, ACCENT, NUIT: lisibleSurBlanc(PRINC), ORANGE_TXT: lisibleSurBlanc(ACCENT), SUR_PRINC: texteSur(PRINC) };
}

function nouveauDocument(titre: string, v: IdentiteDocument) {
  const doc = new PDFDocument({ size: v.formatPapier === "LETTER" ? "LETTER" : "A4", margin: L, info: { Title: titre, Author: v.raisonSociale, Producer: NOM_LOGICIEL } });
  const morceaux: Buffer[] = [];
  const fin = new Promise<Buffer>((ok, ko) => {
    doc.on("data", (b: Buffer) => morceaux.push(b));
    doc.on("end", () => ok(Buffer.concat(morceaux)));
    doc.on("error", ko);
  });
  return { doc, fin, R: doc.page.width - L, W: doc.page.width - 2 * L };
}

/**
 * En-tête commun : bandeau, logo et identité de l'entreprise à gauche (une information par ligne : un identifiant
 * n'est jamais coupé en deux), titre du document à droite (écrit par « droite »). Renvoie l'ordonnée sous l'en-tête.
 */
function dessinerEntete(doc: PDFKit.PDFDocument, d: DocumentPdf, W: number, droite: (x: number, w: number) => void) {
  const v = d.vendeur, c = couleurs(v), id = lignesIdentite(v);
  doc.rect(0, 0, doc.page.width, 8).fill(c.ACCENT);
  let xId = L, logo = false;
  if (d.logo) {
    try { doc.image(d.logo, L, 30, { fit: [72, 72] }); xId = L + 84; logo = true; }
    catch { /* image illisible : en-tête sans logo plutôt qu'un document impossible à produire */ }
  }
  const lId = W * 0.58 - (xId - L);
  doc.fillColor(c.NUIT).font("Helvetica-Bold").fontSize(15).text(v.raisonSociale, xId, 32, { width: lId });
  if (id.sousTitre) doc.font("Helvetica-Bold").fontSize(9.5).fillColor(c.ORANGE_TXT).text(id.sousTitre, xId, doc.y + 1, { width: lId });
  if (id.slogan) doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(GRIS).text(id.slogan, xId, doc.y + 1, { width: lId });
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIS);
  for (const l of id.entete) doc.text(l, xId, doc.y + 1, { width: lId });
  const bas = Math.max(doc.y, logo ? 104 : 0);
  droite(L + W * 0.58, W * 0.42);
  return Math.max(doc.y, bas);
}

/** Cachet ou signature, à droite, sous le corps du document. Renvoie l'ordonnée sous le cachet. */
function dessinerCachet(doc: PDFKit.PDFDocument, d: DocumentPdf, y: number, R: number) {
  if (!d.cachet) return y;
  if (y + 110 > doc.page.height - 90) { doc.addPage(); y = L; }
  doc.font("Helvetica").fontSize(8).fillColor(GRIS).text("Cachet et signature", R - 150, y, { width: 150, align: "center" });
  try { doc.image(d.cachet, R - 140, y + 12, { fit: [130, 90], align: "center" }); }
  catch { /* image illisible : le document reste produit */ }
  return y + 108;
}

/** Pied de page : mentions de l'entreprise (texte libre, banque, moyens de paiement), puis la ligne de référence du document. */
function dessinerPied(doc: PDFKit.PDFDocument, v: IdentiteDocument, reference: string, W: number, R: number) {
  const pied = lignesIdentite(v).pied;
  doc.font("Helvetica").fontSize(7.5);
  const hauteur = pied.reduce((h, l) => h + doc.heightOfString(l, { width: W }) + 1, 0);
  const bas = doc.page.height - 40;
  if (doc.y > bas - 14 - hauteur) doc.addPage();
  let y = bas - 10 - hauteur;
  doc.fillColor(GRIS);
  for (const l of pied) { doc.text(l, L, y, { width: W, align: "center" }); y = doc.y + 1; }
  doc.moveTo(L, bas - 6).lineTo(R, bas - 6).lineWidth(0.5).strokeColor(LIGNE).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(GRIS)
    .text(`${v.raisonSociale}${v.niu ? ` · NIU ${v.niu}` : ""}${v.rccm ? ` · RCCM ${v.rccm}` : ""} · ${reference} · Document émis par ${NOM_LOGICIEL}`,
      L, bas, { width: W, align: "center", lineBreak: false });
}

export async function genererFacturePdf(f: FacturePdf): Promise<Buffer> {
  const qr = f.codeVerification ? await QRCode.toBuffer(f.codeVerification, { errorCorrectionLevel: "M", margin: 1, width: 300 }) : null;
  const { PRINC, NUIT, ORANGE_TXT, SUR_PRINC } = couleurs(f.vendeur);
  const nom = f.avoir ? "Avoir" : "Facture";
  const { doc, fin, R, W } = nouveauDocument(`${nom} ${f.numero}`, f.vendeur);

  // En-tête : identité de l'entreprise à gauche, titre à droite.
  const basEntete = dessinerEntete(doc, f, W, (x, w) => {
    doc.font("Helvetica-Bold").fontSize(22).fillColor(NUIT).text(nom.toUpperCase(), x, 32, { width: w, align: "right" });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ORANGE_TXT).text(`N° ${f.numero}`, { width: w, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`Date : ${dateFr(f.date)}`, { width: w, align: "right" })
      .text(f.type, { width: w, align: "right" });
    if (f.avoir) doc.font("Helvetica-Bold").fillColor(NUIT).text(`Sur la facture ${f.avoir.facture} du ${dateFr(f.avoir.dateFacture)}`, { width: w, align: "right" });
  });

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
    if (i % 2) doc.rect(L, y, W, h).fill(FOND);
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
  doc.rect(L + W * 0.5, y - 3, W * 0.5, 24).fill(FOND);
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

  doc.y = dessinerCachet(doc, f, doc.y + 12, R);
  dessinerPied(doc, f.vendeur, `${nom} ${f.numero}`, W, R);
  doc.end();
  return fin;
}

/** Reçu d'encaissement ou bon de décaissement d'un mouvement de trésorerie. */
export interface RecuPdf extends DocumentPdf {
  numero: string; date: string; sens: "in" | "out"; montant: number; devise: string; libelle: string;
  compte: string; facture?: string | null; emisPar: string; annulation?: string | null;
}

export async function genererRecuPdf(r: RecuPdf): Promise<Buffer> {
  const { NUIT, ORANGE_TXT } = couleurs(r.vendeur);
  const titre = r.sens === "in" ? "Reçu" : "Bon de décaissement";
  const { doc, fin, R, W } = nouveauDocument(`${titre} ${r.numero}`, r.vendeur);
  const basEntete = dessinerEntete(doc, r, W, (x, w) => {
    doc.font("Helvetica-Bold").fontSize(r.sens === "in" ? 22 : 16).fillColor(NUIT).text(titre.toUpperCase(), x, 32, { width: w, align: "right" });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ORANGE_TXT).text(`N° ${r.numero}`, { width: w, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`Date : ${dateFr(r.date)}`, { width: w, align: "right" });
  });
  let y = Math.max(doc.y, basEntete, 120) + 18;
  // Montant en évidence, puis les rubriques une par ligne.
  doc.rect(L, y, W, 34).fill(FOND);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NUIT).text("Montant", L + 12, y + 12)
    .fontSize(15).text(`${fmt(r.montant)} ${r.devise}`, L + W * 0.4, y + 9, { width: W * 0.6 - 12, align: "right" });
  y += 46;
  const rubrique = (lib: string, val: string) => {
    doc.font("Helvetica").fontSize(9.5).fillColor(GRIS).text(lib, L, y, { width: W * 0.28 });
    doc.font("Helvetica-Bold").fillColor(NUIT).text(val, L + W * 0.3, y, { width: W * 0.7 });
    y = Math.max(doc.y, y + 14) + 6;
  };
  rubrique("Somme en lettres", `${montantEnLettres(r.montant)}.`);
  rubrique("Objet", r.libelle);
  if (r.facture) rubrique(r.sens === "in" ? "Règlement de la facture" : "Remboursement sur", r.facture);
  rubrique(r.sens === "in" ? "Encaissé sur" : "Payé depuis", r.compte);
  rubrique("Enregistré par", r.emisPar);
  if (r.annulation) rubrique("Annulation", r.annulation);
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).strokeColor(LIGNE).stroke();
  doc.y = dessinerCachet(doc, r, y + 14, R);
  dessinerPied(doc, r.vendeur, `${titre} ${r.numero}`, W, R);
  doc.end();
  return fin;
}
