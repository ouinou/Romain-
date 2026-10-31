#!/usr/bin/env bash
# Restauration physique pgBackRest dans un répertoire temporaire + démarrage d'une
# instance éphémère sur un port local, puis contrôles SQL. À exécuter sur un hôte de test.
set -euo pipefail
DATA="$(mktemp -d)"; PORT="${PORT:-55432}"
trap 'pg_ctl -D "$DATA" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
pgbackrest --stanza=rtms --pg1-path="$DATA" --type=immediate --target-action=promote restore
echo "port = $PORT" >> "$DATA/postgresql.auto.conf"
echo "archive_mode = off" >> "$DATA/postgresql.auto.conf"
pg_ctl -D "$DATA" -w start
psql -X -p "$PORT" -d rtms -At -c "SELECT count(*) FROM records" | sed 's/^/  records : /'
[ "$(psql -X -p "$PORT" -d rtms -At -c 'SELECT count(*) FROM companies c WHERE audit_verify(c.id) IS NOT NULL')" = 0 ]
echo "RESTAURATION PHYSIQUE VÉRIFIÉE"
