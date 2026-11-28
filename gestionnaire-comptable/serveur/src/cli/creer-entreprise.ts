import { creerEntreprise } from "../domaine/entreprises.js";
import { executer, options, poolProprietaire } from "./outils.js";

const o = options({
  code: { type: "string" }, "raison-sociale": { type: "string" },
  "admin-email": { type: "string" }, "admin-nom": { type: "string" },
  rccm: { type: "string" }, niu: { type: "string" }, pays: { type: "string" }, devise: { type: "string" },
});

await executer(async () => {
  if (!o.code || !o["raison-sociale"] || !o["admin-email"] || !o["admin-nom"])
    throw new Error('Usage : npm run entreprise:creer -- --code GC-ENTREPRISE-01 --raison-sociale "Nom SARL" --admin-email admin@exemple.cm --admin-nom "Prénom Nom" [--rccm ...] [--niu ...]');
  const pool = poolProprietaire();
  try {
    const r = await creerEntreprise(pool, {
      code: o.code, raisonSociale: o["raison-sociale"], adminEmail: o["admin-email"], adminNom: o["admin-nom"],
      rccm: o.rccm, niu: o.niu, pays: o.pays, devise: o.devise,
    });
    console.log(`Entreprise créée : ${r.code} (${r.entrepriseId})`);
    console.log(`Administrateur invité : ${o["admin-email"]}`);
    console.log(`\nCode maître de l'entreprise (récupération d'accès ; à imprimer et remettre sous enveloppe scellée au dirigeant, affiché une seule fois) :\n\n  ${r.codeMaitre}\n`);
    console.log(`Code d'invitation (à remettre en main propre, affiché une seule fois, valable jusqu'au ${r.expireLe.toLocaleString("fr-FR")}) :\n\n  ${r.jetonInvitation}\n`);
  } finally { await pool.end(); }
});
