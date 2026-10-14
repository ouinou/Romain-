import { chargerConfig } from "./config.js";
import { creerPool } from "./db.js";
import { construireApp } from "./http/app.js";

const cfg = chargerConfig();
const pool = creerPool(cfg.baseDeDonnees);
const app = construireApp({ pool, cfg }, {
  logger: { level: process.env.GC_JOURNAL_NIVEAU ?? "info", redact: ["req.headers.cookie", "req.headers.authorization"] },
  ...(cfg.tls ? { https: cfg.tls } : {}),
});

await app.listen({ port: cfg.port, host: cfg.hote });
if (!cfg.tls) app.log.warn("HTTPS non configuré : les mots de passe circulent en clair sur le réseau. Renseignez GC_TLS_CERTIFICAT et GC_TLS_CLE.");

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
