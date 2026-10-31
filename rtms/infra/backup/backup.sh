#!/usr/bin/env bash
# Sauvegarde logique chiffrée de RTMS avec Restic (complément de pgBackRest).
# - pg_dump au format custom (restaurable table par table)
# - envoi dans un dépôt Restic chiffré (AES-256) local ET/OU distant
# - rétention : 7 quotidiennes, 4 hebdomadaires, 12 mensuelles
# Variables : PGHOST PGPORT PGUSER PGDATABASE (+ PGPASSFILE), RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE
#             RTMS_EXTRA_PATHS (facultatif : dossiers de pièces jointes, configuration)
set -euo pipefail
umask 077
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD_FILE:?}" "${PGDATABASE:=rtms}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$WORK/rtms-$STAMP.dump"

echo "[$(date -Is)] pg_dump $PGDATABASE"
pg_dump --format=custom --compress=6 --no-owner --file="$DUMP" "$PGDATABASE"
pg_restore --list "$DUMP" > /dev/null   # contrôle immédiat : archive lisible
( cd "$WORK" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256" )

restic snapshots --quiet >/dev/null 2>&1 || restic init
# shellcheck disable=SC2086
restic backup --quiet --tag rtms --tag "db:$PGDATABASE" --host rtms "$DUMP" "$DUMP.sha256" ${RTMS_EXTRA_PATHS:-}
restic forget --quiet --tag rtms --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
restic check --quiet --read-data-subset=5%
echo "[$(date -Is)] sauvegarde OK ($STAMP)"
