# Déploiement

Trois environnements : **développement** (poste du développeur), **test** (serveur de recette, données fictives) et **production**. Ils utilisent la même image Docker ; seuls les secrets et `NODE_ENV` changent.

## Développement

Prérequis : Node.js 22, PostgreSQL 16, Redis 7 (ou Docker).

```bash
cp rtms/.env.example rtms/.env   # puis remplir DATA_ENCRYPTION_KEYS
```

```bash
cd rtms && docker compose up --build
```

Sans Docker : créer le rôle `rtms_owner` et la base `rtms`, puis :

```bash
cd rtms/apps/api && npm ci && DATABASE_URL=postgresql://rtms_owner:...@localhost/rtms npx prisma migrate deploy
```

```bash
MIGRATION_DATABASE_URL=postgresql://rtms_owner:...@localhost/rtms RTMS_ADMIN_EMAIL=vous@exemple.td RTMS_ADMIN_PASSWORD='une phrase de passe longue' npm run db:seed
```

```bash
DATABASE_URL=postgresql://rtms_app:...@localhost/rtms DATA_ENCRYPTION_KEYS=v1:$(openssl rand -base64 32) COOKIE_SECURE=false WEB_ROOT=../web npm run dev
```

Puis ouvrir http://localhost:3000. La première connexion de l'administrateur demande l'activation de la MFA.

## Production (serveur unique)

Prévu pour un serveur Linux (Debian 12 / Ubuntu 24.04), 4 vCPU, 8 Go de RAM, disque SSD chiffré (LUKS). _[À compléter : serveur réellement retenu, sur site ou hébergé, accès distant.]_

1. **Système** : mises à jour automatiques de sécurité, pare-feu n'ouvrant que 443 (et 80 pour la redirection), SSH par clé uniquement, agent Wazuh installé (`infra/wazuh/`).
2. **Docker** Engine + plugin Compose.
3. **Secrets** dans `/etc/rtms/secrets/` (droits `600`, propriétaire root) ou dans Vault (`infra/vault/setup.sh`). Liste : `postgres_password`, `database_url`, `migration_database_url`, `redis_password`, `redis_url`, `data_keys`, `metrics_token`, `license_public_key.pem`, `grafana_admin_password`.
4. **Certificats** : certificat d'origine Cloudflare et CA « Authenticated Origin Pulls » dans `infra/caddy/certs/` ; certificat TLS PostgreSQL dans `infra/postgres/tls/`.
5. **Cloudflare** : `cd infra/cloudflare && terraform init && terraform plan -var zone_id=... -var hostname=...`, relire le plan, puis `apply`.
6. **Premier démarrage** :

```bash
cd /opt/rtms/infra && docker compose -f compose.prod.yml --env-file /etc/rtms/rtms.env --profile migrate run --rm migrate
```

```bash
docker compose -f compose.prod.yml --env-file /etc/rtms/rtms.env up -d
```

7. **Initialisation de la société** (une fois) :

```bash
docker compose -f compose.prod.yml run --rm -e MIGRATION_DATABASE_URL="$(cat /etc/rtms/secrets/migration_database_url)" -e RTMS_ADMIN_EMAIL=... -e RTMS_ADMIN_PASSWORD=... api node dist/scripts/seed.js
```

8. **Licence** : Paramètres → Licence → saisir la clé fournie par l'éditeur.
9. **Supervision** : `docker compose -f compose.prod.yml --profile observability up -d`. Grafana n'écoute que sur `127.0.0.1:3001` (accès par tunnel SSH ou VPN).
10. **Sauvegardes** : planifier les tâches de `06-SAUVEGARDE-RESTAURATION.md` et faire **un premier test de restauration avant la mise en service**.

## Mises à jour et retour arrière

La CI publie une image à chaque étiquette `rtms-vX.Y.Z`, la déploie sur l'environnement **test**, puis attend une approbation manuelle pour la **production** (règle de protection d'environnement GitHub à activer).

Sur le serveur, `infra/deploy/deploy.sh X.Y.Z` :

1. lance une sauvegarde ;
2. applique les migrations ;
3. démarre la nouvelle version ;
4. contrôle `/readyz` pendant une minute ;
5. en cas d'échec, relance la version précédente.

Condition pour que le retour arrière fonctionne : les migrations doivent rester compatibles avec la version précédente (on ajoute une colonne, on la remplit, on bascule le code, et on ne supprime l'ancienne qu'à la version suivante). Une migration destructive impose une restauration de sauvegarde pour revenir en arrière.

## Gestion des versions

Numérotation `MAJEUR.MINEUR.CORRECTIF` ; chaque version est décrite dans `CHANGELOG.md`. Les migrations sont numérotées et jamais modifiées une fois publiées (la 0003 corrige la 0002 au lieu de la réécrire).

## Secrets nécessaires dans GitHub

`DEPLOY_SSH_KEY`, `DEPLOY_HOST` (par environnement), et facultativement `SNYK_TOKEN`, `SONAR_TOKEN`, `SONAR_HOST_URL`.
