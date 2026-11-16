# Exemples de code

Exemples courts, à adapter au projet. Node/Express et Next.js en priorité (ce que les IA génèrent le plus), avec Python quand c'est utile. Avant de copier, vérifier les versions des paquets déjà installés : les API changent entre versions majeures.

---

## E1 — Garder une clé secrète côté serveur (Next.js, App Router)

```ts
// app/api/resume/route.ts — tourne sur le serveur, la clé ne part jamais au navigateur
import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({ texte: z.string().min(1).max(5000) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });

  const r = await fetch("https://api.exemple-ia.com/v1/...", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.IA_API_KEY}` }, // pas de NEXT_PUBLIC_
    body: JSON.stringify({ input: parsed.data.texte }),
  });
  return NextResponse.json(await r.json());
}
```

Côté navigateur : `fetch("/api/resume", { method: "POST", body: ... })`. Ajouter une limite de requêtes (E10) et une vérification de session sur cette route, sinon n'importe qui consomme ton crédit à travers elle.

## E2 — RLS Supabase

```sql
alter table public.notes enable row level security;

create policy "lecture de ses notes" on public.notes
  for select using (auth.uid() = user_id);

create policy "création de ses notes" on public.notes
  for insert with check (auth.uid() = user_id);

create policy "modification de ses notes" on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "suppression de ses notes" on public.notes
  for delete using (auth.uid() = user_id);

-- Trouver les tables sans RLS :
select tablename from pg_tables
where schemaname = 'public' and rowsecurity = false;
```

Le rôle admin ne doit pas venir de `user_metadata` (modifiable par l'utilisateur) : utiliser `app_metadata` ou une table `roles` protégée.

## E3 — Hacher un mot de passe

```js
// Node — npm i argon2
import argon2 from "argon2";
const hash = await argon2.hash(motDePasse, { type: argon2.argon2id });
const ok = await argon2.verify(hash, motDePasseSaisi);
```

```python
# Python — pip install argon2-cffi
from argon2 import PasswordHasher
ph = PasswordHasher()
h = ph.hash(mot_de_passe)
ph.verify(h, saisi)          # lève une exception si faux
if ph.check_needs_rehash(h): # paramètres obsolètes → re-hacher
    h = ph.hash(saisi)
```

bcrypt reste acceptable (`bcrypt.hash(mdp, 12)`), mais il tronque à 72 octets.

```sql
-- Postgres / Supabase (extension pgcrypto) : bcrypt plutôt que digest(..., 'sha256')
update ma_table set password_hash = extensions.crypt('nouveau', extensions.gen_salt('bf', 12));
-- vérification
select password_hash = extensions.crypt(p_password, password_hash) from ma_table where id = 1;
```

## E4 — Validation serveur (Express + Zod)

```js
import { z } from "zod";

const Inscription = z.object({
  email: z.string().email().max(254),
  nom: z.string().trim().min(1).max(100),
  motDePasse: z.string().min(12).max(200),
}).strict(); // refuse les champs en plus (ex. role: "admin")

app.post("/api/inscription", async (req, res) => {
  const r = Inscription.safeParse(req.body);
  if (!r.success) return res.status(400).json({ erreur: "Données invalides" });
  const { email, nom, motDePasse } = r.data; // n'utiliser que r.data
  // ...
});
```

Python : modèles Pydantic avec `model_config = ConfigDict(extra="forbid")`.

## E5 — Afficher du HTML utilisateur sans XSS

```js
// npm i dompurify
import DOMPurify from "dompurify";
el.innerHTML = DOMPurify.sanitize(htmlUtilisateur);

// Texte simple : pas besoin d'assainir, juste ne pas interpréter
el.textContent = texteUtilisateur;

// Lien fourni par l'utilisateur
function lienSur(url) {
  try { const u = new URL(url); return ["http:", "https:"].includes(u.protocol) ? u.href : "#"; }
  catch { return "#"; }
}
```

## E6 — Journal de sécurité minimal

```js
// npm i pino
import pino from "pino";
const log = pino({ redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"] });

function evenementSecurite(req, action, details = {}) {
  log.warn({ type: "securite", action, ip: req.ip, userId: req.user?.id ?? null, ...details });
}

// usage
evenementSecurite(req, "connexion_echec", { email });
evenementSecurite(req, "acces_admin_refuse", { route: req.originalUrl });
```

## E7 — Middleware admin (Express)

```js
async function exigerAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).end();
  const user = await db.user.findUnique({ where: { id: req.session.userId } }); // rôle relu en base
  if (user?.role !== "admin") {
    evenementSecurite(req, "acces_admin_refuse");
    return res.status(403).end();
  }
  req.user = user;
  next();
}
app.use("/api/admin", exigerAdmin);

// Contrôle de propriété (IDOR)
app.get("/api/commandes/:id", exigerConnexion, async (req, res) => {
  const c = await db.commande.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!c) return res.status(404).end(); // 404 plutôt que 403 : ne confirme pas l'existence
  res.json(c);
});
```

Next.js : vérifier dans chaque Route Handler / Server Action, pas seulement dans `middleware.ts` (qui ne doit pas être la seule barrière).

## E8 — Requêtes paramétrées

```js
// pg
await pool.query("SELECT * FROM users WHERE email = $1", [email]);
// mysql2
await conn.execute("SELECT * FROM users WHERE email = ?", [email]);
// Prisma : $queryRaw en template tag est paramétré
await prisma.$queryRaw`SELECT * FROM users WHERE email = ${email}`;
// Tri dynamique : liste blanche
const colonnes = { date: "created_at", nom: "name" };
const tri = colonnes[req.query.tri] ?? "created_at";
```

```python
cur.execute("SELECT * FROM users WHERE email = %s", (email,))   # psycopg
cur.execute("SELECT * FROM users WHERE email = ?", (email,))    # sqlite3
```

## E9 — Valider l'environnement au démarrage

```js
// env.js
import { z } from "zod";
export const env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
}).parse(process.env); // plante au démarrage si une variable manque
```

Générer un secret : `openssl rand -base64 48`.

## E10 — Limite de requêtes

```js
// Serveur Node classique — npm i express-rate-limit
import rateLimit from "express-rate-limit";
app.set("trust proxy", 1); // derrière Render, Railway, Nginx…
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 100 }));
app.use("/api/auth/", rateLimit({ windowMs: 15 * 60_000, limit: 5 }));
```

```ts
// Serverless (Vercel, Netlify) — npm i @upstash/ratelimit @upstash/redis
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
const rl = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(10, "1 m") });
const { success } = await rl.limit(ip);
if (!success) return new Response("Trop de requêtes", { status: 429 });
```

## E11 — CORS restreint

```js
import cors from "cors";
const autorisees = (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || autorisees.includes(origin)),
  credentials: true,
}));
```

`!origin` laisse passer les appels serveur-à-serveur et les outils (pas de navigateur). Si l'API ne doit servir qu'au front, on peut le refuser.

## E12 — En-têtes de sécurité

```js
// Express — npm i helmet
import helmet from "helmet";
app.disable("x-powered-by");
app.use(helmet()); // CSP, HSTS, nosniff, frameguard… à ajuster selon le site
```

```js
// next.config.js
const headers = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: "default-src 'self'; img-src 'self' data: https:; object-src 'none'; frame-ancestors 'none'" },
];
module.exports = { poweredByHeader: false, async headers() { return [{ source: "/(.*)", headers }]; } };
```

```toml
# netlify.toml
[[headers]]
  for = "/*"
  [headers.values]
    Strict-Transport-Security = "max-age=63072000; includeSubDomains"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    X-Frame-Options = "DENY"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
```

Passer la CSP de `-Report-Only` à la version active une fois qu'aucune ressource légitime n'est bloquée (regarder la console du navigateur).

## E13 — Cookie de session

```js
import session from "express-session";
app.use(session({
  name: "__Host-sid",
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 1000 * 60 * 60 * 8 },
  // store: un store persistant (Redis, Postgres) — le store mémoire par défaut n'est pas fait pour la prod
}));

// À la connexion : nouvel identifiant
req.session.regenerate(err => { req.session.userId = user.id; res.end(); });
// À la déconnexion
req.session.destroy(() => res.clearCookie("__Host-sid").end());
```

## E14 — CSRF (Express, double-submit)

```js
// npm i csrf-csrf cookie-parser
import { doubleCsrf } from "csrf-csrf";
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => env.CSRF_SECRET,
  getSessionIdentifier: (req) => req.session.id,
  cookieName: "__Host-csrf",
  cookieOptions: { sameSite: "lax", secure: true, httpOnly: true },
});
app.get("/api/csrf", (req, res) => res.json({ token: generateCsrfToken(req, res) }));
app.use(doubleCsrfProtection); // le front renvoie le jeton dans l'en-tête x-csrf-token
```

Le nom des options varie selon la version de `csrf-csrf` : vérifier la doc de la version installée.

## E15 — Lien de réinitialisation

```js
import crypto from "node:crypto";

// Demande
const jeton = crypto.randomBytes(32).toString("base64url");
const empreinte = crypto.createHash("sha256").update(jeton).digest("hex");
await db.reset.deleteMany({ where: { userId: user.id } });            // invalide les anciens
await db.reset.create({ data: { userId: user.id, empreinte, expireLe: new Date(Date.now() + 30 * 60_000) } });
// e-mail : https://site/reinitialiser?jeton=...  — et toujours la même réponse au client

// Utilisation
const e = crypto.createHash("sha256").update(jetonRecu).digest("hex");
const r = await db.reset.findFirst({ where: { empreinte: e, expireLe: { gt: new Date() } } });
if (!r) return res.status(400).json({ erreur: "Lien invalide ou expiré" });
await db.$transaction([
  db.user.update({ where: { id: r.userId }, data: { hash: await argon2.hash(nouveau) } }),
  db.reset.deleteMany({ where: { userId: r.userId } }),
  db.session.deleteMany({ where: { userId: r.userId } }),
]);
```

Ici un SHA-256 suffit pour stocker le jeton : il est long et aléatoire, contrairement à un mot de passe.

## E16 — Upload contrôlé

```js
// npm i multer file-type
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import crypto from "node:crypto";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

app.post("/api/upload", exigerConnexion, upload.single("fichier"), async (req, res) => {
  const type = req.file && await fileTypeFromBuffer(req.file.buffer); // signature réelle
  if (!type || !TYPES.has(type.mime)) return res.status(415).json({ erreur: "Type non autorisé" });
  const nom = `${crypto.randomUUID()}.${type.ext}`;
  // envoyer vers S3 / Supabase Storage sous `${req.user.id}/${nom}`
});
```

Supabase Storage : limiter taille et types MIME dans les réglages du bucket, et politique d'écriture `(storage.foldername(name))[1] = auth.uid()::text`.

## E17 — Paiement Stripe : prix serveur + webhook vérifié

```js
// Création de la session : le prix vient de la base
app.post("/api/checkout", exigerConnexion, async (req, res) => {
  const { produitId, quantite } = Panier.parse(req.body); // quantite: z.number().int().min(1).max(20)
  const p = await db.produit.findUnique({ where: { id: produitId } });
  if (!p) return res.status(404).end();
  const s = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: p.stripePriceId, quantity: quantite }],
    metadata: { userId: req.user.id, produitId },
    success_url: `${env.SITE_URL}/merci`, cancel_url: `${env.SITE_URL}/panier`,
  });
  res.json({ url: s.url });
});

// Webhook : corps brut, signature vérifiée, idempotent
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let evt;
  try { evt = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], env.STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).end(); }
  if (await db.evenementTraite.findUnique({ where: { id: evt.id } })) return res.json({ ok: true });
  if (evt.type === "checkout.session.completed" && evt.data.object.payment_status === "paid") {
    // marquer la commande payée ici, et seulement ici
  }
  await db.evenementTraite.create({ data: { id: evt.id } });
  res.json({ ok: true });
});
```

Même principe pour PayPal, Paystack, CinetPay, Flutterwave, mobile money : vérifier la signature ou rappeler l'API du fournisseur pour confirmer le statut et le montant, ne jamais croire la redirection.

## E18 — Erreurs sans fuite en production

```js
app.use((err, req, res, next) => {
  log.error({ err, route: req.originalUrl });
  res.status(err.status ?? 500).json({ erreur: process.env.NODE_ENV === "production" ? "Erreur interne" : err.message });
});
```

```python
# Django settings.py
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"   # faux par défaut
ALLOWED_HOSTS = os.environ["ALLOWED_HOSTS"].split(",")
SECURE_SSL_REDIRECT = not DEBUG
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = not DEBUG
```

`python manage.py check --deploy` liste ce qui manque.

## E19 — Tester les fichiers exposés en ligne

```bash
SITE=https://ton-site.com
for p in .env .env.local .env.production .git/config .git/HEAD backup.zip dump.sql database.sqlite \
         config.php.bak phpinfo.php .DS_Store docker-compose.yml serviceAccountKey.json; do
  printf "%-28s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/$p")"
done
```

Tout autre code que 404 (ou 403) mérite qu'on regarde. Attention aux SPA qui renvoient 200 + `index.html` pour tout : vérifier le contenu dans ce cas.

## E20 — Empêcher les secrets d'entrer dans Git

```gitignore
.env
.env.*
!.env.example
*.pem
*.key
serviceAccountKey.json
```

```yaml
# .pre-commit-config.yaml — pip install pre-commit && pre-commit install
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.2   # mettre la dernière version stable
    hooks:
      - id: gitleaks
```

Nettoyer l'historique (seulement après révocation et avec accord) :

```bash
pip install git-filter-repo
git filter-repo --invert-paths --path .env
git push --force --all && git push --force --tags
```
