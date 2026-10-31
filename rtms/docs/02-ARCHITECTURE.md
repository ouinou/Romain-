# Architecture technique — RTMS 2.0

## Vue d'ensemble

```
 Postes Windows / macOS (navigateur)
            │ HTTPS
            ▼
   Cloudflare  ── WAF géré + OWASP, limitation de débit, anti-DDoS, TLS strict
            │ mTLS (Authenticated Origin Pulls : seul Cloudflare joint l'origine)
            ▼
   Caddy (TLS 1.2/1.3, HSTS, /metrics bloqué)
            │
            ▼
   API RTMS × 2 (Node.js 22, Fastify 5, TypeScript)       ◄── sert aussi l'interface web
     ├─ sessions, limites de débit, cache ──► Redis 7
     ├─ données ─────────────────────────────► PostgreSQL 16 (RLS, audit chaîné)
     ├─ secrets au démarrage ────────────────► Vault (AppRole) ou fichiers *_FILE
     ├─ licence (clé publique seule) ────────► Serveur de licences de l'éditeur
     └─ erreurs / traces / métriques ────────► Sentry / OpenTelemetry / Prometheus
                                                         │
                                         Grafana ◄── Loki ◄── Promtail (journaux)
   Wazuh (agent sur l'hôte) : journaux, intégrité des fichiers, vulnérabilités système
   Sauvegardes : pgBackRest (physique + WAL) et Restic (logique chiffrée, hors site)
```

Les postes ne parlent jamais directement à PostgreSQL (exigence §9 du CdC).

## Arborescence

```
rtms/
├── apps/api/            API (TypeScript)
│   ├── prisma/          schéma + migrations versionnées (0001 → 0003)
│   ├── src/
│   │   ├── auth/        connexion, MFA, mot de passe
│   │   ├── security/    sessions, RBAC, garde d'accès, mots de passe
│   │   ├── modules/     définitions des 11 modules, CRUD, tableau de bord
│   │   ├── admin/       paramètres, utilisateurs, permissions, audit, licence, import
│   │   ├── audit/       écriture du journal
│   │   ├── licensing/   jetons Ed25519, garde côté installation, serveur éditeur
│   │   ├── observability/ métriques, Sentry, OpenTelemetry
│   │   └── scripts/     initialisation, génération de clés, rétention, test de charge
│   └── test/            unit/ et integration/ (Vitest)
├── apps/web/            interface (HTML/CSS/JS du prototype, branchée sur l'API) + e2e Playwright
├── infra/               Compose prod, Caddy, PostgreSQL, sauvegardes, supervision, Vault, Cloudflare, Wazuh, déploiement
├── tests/               charge (k6) et règles ZAP
└── docs/                ce dossier
```

## Choix et justifications

**Un modèle « enregistrement générique » plutôt que 11 tables.** Le prototype stocke chaque module comme une liste d'objets aux champs libellés en français. J'ai gardé ce format (table `records`, colonne `data` en JSONB) pour trois raisons : aucune fonctionnalité du prototype n'est perdue, les données déjà saisies dans les navigateurs s'importent telles quelles, et la validation reste stricte puisqu'elle est faite côté serveur par un schéma par module (champs autorisés, types, listes fermées, longueurs). Limite assumée : les relations métier (mission → facture → règlement, mouvements de stock) demanderont des tables dédiées. Ce sera une migration à part entière, pas une retouche.

**Fastify plutôt qu'Express.** Validation et sérialisation rapides, hooks clairs pour la sécurité, maintenu activement.

**Sessions serveur opaques plutôt que JWT.** Une session doit pouvoir être révoquée immédiatement (mot de passe changé, compte désactivé). Avec Redis, c'est une suppression de clé. Le cookie ne contient qu'un jeton aléatoire de 256 bits ; Redis n'en stocke que l'empreinte.

**RLS PostgreSQL en plus des filtres applicatifs.** L'API pose la société courante dans la transaction (`SET LOCAL app.company_id`). Même si un développeur oublie un `WHERE company_id = …`, la base ne renvoie rien d'une autre société. Le rôle applicatif `rtms_app` n'a pas `BYPASSRLS`, pas de `DELETE` sur les données métier et pas d'`UPDATE` sur l'audit.

**Pas de suppression physique.** « Supprimer » dans l'interface devient une annulation datée, motivée et tracée. Un trigger refuse tout `DELETE` sur `records`, même s'il venait d'ailleurs que l'API.

**Cache.** Les indicateurs du tableau de bord sont calculés en une requête SQL agrégée et mis en cache dans Redis. L'invalidation est faite par « génération » : chaque écriture incrémente un compteur par société, ce qui rend l'ancienne entrée de cache inutilisable sans avoir à la chercher.

**Connexions.** Pool Prisma limité (`connection_limit` dans `DATABASE_URL`, 10 par instance conseillé). Timeouts imposés au rôle `rtms_app` : 15 s par requête, 30 s en transaction inactive, 5 s d'attente de verrou. Compatible PgBouncer en mode transaction si le nombre d'instances augmente.

**Transactions.** Toute écriture métier et sa ligne d'audit sont dans la même transaction : pas d'opération sans trace, pas de trace sans opération. L'import du prototype est en isolation `SERIALIZABLE`.

**Concurrence multi-postes.** Verrou optimiste : chaque enregistrement porte une `version`. Une modification basée sur une version périmée renvoie 409 au lieu d'écraser le travail d'un collègue (critère de recette « Multi-utilisateur » du CdC).

## API REST (résumé)

| Méthode | Route | Droit requis |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/mfa/verify` | — |
| POST | `/api/auth/mfa/setup`, `/api/auth/mfa/enable`, `/api/auth/password`, `/api/auth/logout` | session |
| GET | `/api/auth/me` | session |
| GET | `/api/modules` | `dashboard:read` |
| GET | `/api/records/:module?q=&limit=&offset=` | `<module>:read` |
| POST | `/api/records/:module` | `<module>:create` (+ `validate` pour un statut validé) |
| PATCH | `/api/records/:module/:id` (`version` obligatoire) | `<module>:update` (+ `validate` si validé) |
| POST | `/api/records/:module/:id/cancel` | `<module>:cancel` |
| GET | `/api/records/:module/export.csv` | `<module>:export` |
| GET | `/api/dashboard`, `/api/reports/summary` | `dashboard:read`, `reports:read` |
| GET/PUT | `/api/admin/settings` | `settings:read` / `settings:admin` |
| GET/POST/PATCH | `/api/admin/users` | `users:read` / `users:admin` |
| GET/PUT | `/api/admin/permissions[/:role]` | `users:read` / `users:admin` |
| GET | `/api/admin/audit`, `/api/admin/audit/verify` | `audit:read` |
| GET/POST | `/api/admin/license`, `/api/admin/license/activate` | `license:read` / `license:admin` |
| POST | `/api/admin/import-legacy` | `settings:admin` |
| GET | `/healthz`, `/readyz`, `/metrics` (jeton) | — |

Les erreurs ont toujours la forme `{ code, message, details? }`, sans trace technique. Une erreur 500 renvoie seulement une référence de requête, retrouvable dans les journaux.
