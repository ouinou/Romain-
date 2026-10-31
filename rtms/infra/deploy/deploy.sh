#!/usr/bin/env bash
# Déploiement réversible d'une version RTMS sur le serveur.
#   sudo infra/deploy/deploy.sh 2.0.1
# 1. sauvegarde préalable  2. migrations  3. nouvelle version  4. contrôle de santé
# 5. en cas d'échec : retour automatique à la version précédente.
# Les migrations doivent rester rétrocompatibles (expand → contract) pour que
# l'ancienne version fonctionne encore sur le schéma migré.
set -euo pipefail
NEW="${1:?Version à déployer (ex. 2.0.1)}"
cd "$(dirname "$0")/.."
STATE=/etc/rtms/current_version
OLD="$(cat "$STATE" 2>/dev/null || echo '')"
COMPOSE=(docker compose -f compose.prod.yml --env-file /etc/rtms/rtms.env)

echo "→ Sauvegarde avant déploiement"
/opt/rtms/infra/backup/backup.sh

echo "→ Image $NEW"
RTMS_VERSION="$NEW" "${COMPOSE[@]}" pull api migrate

echo "→ Migrations"
RTMS_VERSION="$NEW" "${COMPOSE[@]}" --profile migrate run --rm migrate

echo "→ Démarrage $NEW"
RTMS_VERSION="$NEW" "${COMPOSE[@]}" up -d --no-deps api

for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "https://${RTMS_DOMAIN:?}/readyz" >/dev/null; then
    echo "$NEW" > "$STATE"; echo "✓ RTMS $NEW en service"; exit 0
  fi
  sleep 2
done

echo "✗ Contrôle de santé en échec"
if [ -n "$OLD" ]; then
  echo "→ Retour à $OLD"
  RTMS_VERSION="$OLD" "${COMPOSE[@]}" up -d --no-deps api
fi
exit 1
