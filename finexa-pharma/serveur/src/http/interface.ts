import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { FastifyInstance } from "fastify";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json",
};

/**
 * Sert l'interface compilée (interface/dist).
 * Les fichiers sont listés une fois au démarrage : seule une adresse présente dans cette liste
 * est servie, ce qui exclut toute traversée de répertoire (../, encodages, etc.).
 * Toute autre adresse hors /api renvoie index.html (application monopage).
 */
export function servirInterface(app: FastifyInstance, dossier: string) {
  if (!existsSync(join(dossier, "index.html"))) {
    app.log.warn(`Interface introuvable dans ${dossier} : lancez « npm run build » dans le dossier interface.`);
    return;
  }
  const fichiers = new Map<string, { contenu: Buffer; type: string; immuable: boolean }>();
  const parcourir = (d: string) => {
    for (const nom of readdirSync(d)) {
      const chemin = join(d, nom);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else fichiers.set("/" + relative(dossier, chemin).split(sep).join("/"),
        { contenu: readFileSync(chemin), type: TYPES[extname(nom)] ?? "application/octet-stream", immuable: chemin.includes(`${sep}assets${sep}`) });
    }
  };
  parcourir(dossier);
  const index = fichiers.get("/index.html")!;
  // Certificat PUBLIC de l'autorité locale (installé par le setup) : à télécharger depuis chaque poste client
  // pour que le navigateur fasse confiance au HTTPS du serveur. Ce n'est pas un secret.
  const autorite = process.env.GC_TLS_AUTORITE;
  if (autorite && existsSync(autorite))
    fichiers.set("/certificat-autorite.crt", { contenu: readFileSync(autorite), type: "application/x-x509-ca-cert", immuable: false });

  app.get("/*", async (req, rep) => {
    const chemin = req.url.split("?")[0];
    if (chemin.startsWith("/api/")) return rep.status(404).send({ erreur: { code: "introuvable", message: "Adresse inconnue." } });
    const f = fichiers.get(chemin) ?? index;
    rep.header("content-type", f.type);
    rep.header("cache-control", f.immuable ? "public, max-age=31536000, immutable" : "no-cache");
    return rep.send(f.contenu);
  });
}
