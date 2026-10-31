# RTMS — RAHA TRANSPORT Management System (v2.2)

Logiciel de gestion de RAHA TRANSPORT : transport, transit, import-export, commerce, parc, personnel, maintenance, facturation, finance, documents.

La v2.0 a transformé le prototype (un fichier HTML qui stockait tout dans le navigateur) en application client-serveur sécurisée. La v2.1 réorganise l'interface en espace de travail de logiciel de bureau (menus, outils, onglets, panneaux) en gardant l'identité visuelle RAHA TRANSPORT. Le prototype d'origine est conservé dans `prototype/` pour référence.

| Dossier | Contenu |
|---|---|
| `apps/api` | API TypeScript (Fastify, Prisma, PostgreSQL, Redis), migrations, tests |
| `apps/web` | interface (modules ES natifs, sans compilation) + tests Playwright |
| `infra` | Docker Compose de production, Caddy/TLS, PostgreSQL, sauvegardes, supervision, Vault, Cloudflare, Wazuh, déploiement |
| `tests` | test de charge k6, règles OWASP ZAP |
| `docs` | rapport d'audit et documentation |

## Documentation

1. [Rapport d'audit](docs/01-RAPPORT-AUDIT.md) — anomalies, vulnérabilités, plan d'intervention
2. [Architecture](docs/02-ARCHITECTURE.md)
3. [Sécurité](docs/03-SECURITE.md) — vulnérabilités corrigées, ce qui est vérifié et ce qui ne l'est pas
4. [Tests et performance](docs/04-TESTS-ET-PERFORMANCE.md)
5. [Déploiement](docs/05-DEPLOIEMENT.md)
6. [Sauvegarde et restauration](docs/06-SAUVEGARDE-RESTAURATION.md)
7. [Licences](docs/07-LICENCES.md)
8. [Maintenance](docs/08-MAINTENANCE.md)
9. [Interface 2.1 — espace de travail](docs/09-INTERFACE.md)

## Démarrage rapide (développement)

```bash
cd rtms && cp .env.example .env && docker compose up --build
```

Détails et installation sans Docker : [docs/05-DEPLOIEMENT.md](docs/05-DEPLOIEMENT.md).

## Lancer l'application (sans Docker)

Prérequis : Node.js 22, PostgreSQL 16, Redis 7. Détails dans [docs/05-DEPLOIEMENT.md](docs/05-DEPLOIEMENT.md).

```bash
cd rtms/apps/api && npm ci && npm run build
```

```bash
DATABASE_URL=postgresql://rtms_owner:MOT_DE_PASSE@localhost/rtms npx prisma migrate deploy
```

```bash
DATABASE_URL=postgresql://rtms_app:MOT_DE_PASSE@localhost/rtms DATA_ENCRYPTION_KEYS=v1:$(openssl rand -base64 32) COOKIE_SECURE=false WEB_ROOT=../web npm start
```

Puis ouvrir http://localhost:3000.

## Tests

```bash
cd rtms/apps/api && npx vitest run
```

```bash
cd rtms/apps/web && npm ci && MIGRATION_DATABASE_URL=postgresql://rtms_owner:MOT_DE_PASSE@localhost/rtms npx playwright test
```
