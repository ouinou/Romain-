#!/usr/bin/env bash
# Test de restauration PÉRIODIQUE (à planifier chaque semaine).
# Restaure le dernier instantané Restic dans une base jetable, puis vérifie :
#   1. que la restauration aboutit sans erreur ;
#   2. que les tables clés existent et contiennent des données ;
#   3. que les migrations appliquées sont celles attendues ;
#   4. que la chaîne d'audit de chaque société est intacte.
# Code retour ≠ 0 en cas d'échec (à relier à l'alerte de supervision).
set -euo pipefail
umask 077
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD_FILE:?}"
TARGET_DB="${RESTORE_TEST_DB:-rtms_restore_test}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; dropdb --if-exists "$TARGET_DB" 2>/dev/null || true' EXIT

restic restore latest --tag rtms --target "$WORK" --quiet
DUMP="$(find "$WORK" -name 'rtms-*.dump' | sort | tail -1)"
[ -n "$DUMP" ] || { echo "ÉCHEC : aucune sauvegarde trouvée"; exit 1; }
( cd "$(dirname "$DUMP")" && sha256sum --check --quiet "$(basename "$DUMP").sha256" )

dropdb --if-exists "$TARGET_DB"
createdb "$TARGET_DB"
pg_restore --no-owner --exit-on-error --dbname="$TARGET_DB" "$DUMP"

q() { psql -X -A -t -v ON_ERROR_STOP=1 -d "$TARGET_DB" -c "$1"; }
for t in companies users records audit_log role_permissions _prisma_migrations; do
  n="$(q "SELECT count(*) FROM $t")"
  echo "  $t : $n ligne(s)"
done
[ "$(q 'SELECT count(*) FROM companies')" -gt 0 ] || { echo "ÉCHEC : aucune société restaurée"; exit 1; }
MIG="$(q "SELECT string_agg(migration_name, ',' ORDER BY migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
echo "  migrations : $MIG"
BROKEN="$(q "SELECT count(*) FROM companies c WHERE audit_verify(c.id) IS NOT NULL")"
[ "$BROKEN" = "0" ] || { echo "ÉCHEC : chaîne d'audit altérée pour $BROKEN société(s)"; exit 1; }
echo "RESTAURATION VÉRIFIÉE : $(basename "$DUMP")"
