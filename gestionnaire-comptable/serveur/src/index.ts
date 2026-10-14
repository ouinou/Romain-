import { chargerConfig } from "./config.js";
import { creerPool } from "./db.js";
import { construireApp } from "./http/app.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const cfg = chargerConfig();
const pool = creerPool(cfg.baseDeDonnees);
// Par défaut : ../interface/dist par rapport au dossier serveur (dist/src/index.js → remonter de 3 niveaux).
const dossierInterface = process.env.GC_DOSSIER_INTERFACE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "interface", "dist");
const app = construireApp({ pool, cfg }, {
  logger: { level: process.env.GC_JOURNAL_NIVEAU ?? "info", redact: ["req.headers.cookie", "req.headers.authorization"] },
  ...(cfg.tls ? { https: cfg.tls } : {}),
}, dossierInterface);

await app.listen({ port: cfg.port, host: cfg.hote });
if (!cfg.tls) app.log.warn("HTTPS non configuré : les mots de passe circulent en clair sur le réseau. Renseignez GC_TLS_CERTIFICAT et GC_TLS_CLE.");

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
