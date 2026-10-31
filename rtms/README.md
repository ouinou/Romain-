# RTMS — RAHA TRANSPORT Management System (v2.0)

Logiciel de gestion de RAHA TRANSPORT : transport, transit, import-export, commerce, parc, personnel, maintenance, facturation, finance, documents.

La v2.0 transforme le prototype (un fichier HTML qui stockait tout dans le navigateur) en application client-serveur sécurisée, **sans changer les écrans**. Le prototype d'origine est conservé dans `prototype/` pour référence.

| Dossier | Contenu |
|---|---|
| `apps/api` | API TypeScript (Fastify, Prisma, PostgreSQL, Redis), migrations, tests |
| `apps/web` | interface web + tests Playwright |
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

## Démarrage rapide (développement)

```bash
cd rtms && cp .env.example .env && docker compose up --build
```

Détails et installation sans Docker : [docs/05-DEPLOIEMENT.md](docs/05-DEPLOIEMENT.md).
