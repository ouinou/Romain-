#!/usr/bin/env bash
# Création des rôles PostgreSQL au premier démarrage du conteneur.
# Les mots de passe viennent de l'environnement / des secrets, jamais du dépôt.
set -euo pipefail
: "${RTMS_OWNER_PASSWORD:?}" "${RTMS_APP_PASSWORD:?}" "${RTMS_LICENSE_PASSWORD:?}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" \
  -v owner_pw="$RTMS_OWNER_PASSWORD" -v app_pw="$RTMS_APP_PASSWORD" -v lic_pw="$RTMS_LICENSE_PASSWORD" <<'SQL'
SET password_encryption = 'scram-sha-256';
CREATE ROLE rtms_owner LOGIN CREATEROLE PASSWORD :'owner_pw';
CREATE ROLE rtms_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_pw';
CREATE ROLE rtms_license LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'lic_pw';
CREATE DATABASE rtms OWNER rtms_owner;
REVOKE ALL ON DATABASE rtms FROM PUBLIC;
GRANT CONNECT ON DATABASE rtms TO rtms_app, rtms_license;
SQL
