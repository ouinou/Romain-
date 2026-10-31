#!/usr/bin/env bash
# Mise en place Vault (à exécuter par l'administrateur Vault, une fois).
set -euo pipefail
vault secrets enable -path=secret kv-v2 2>/dev/null || true
vault auth enable approle 2>/dev/null || true
vault policy write rtms-api infra/vault/rtms-api.hcl
vault policy write rtms-license-issuer infra/vault/rtms-license-issuer.hcl
# secret_id à durée limitée et à usage restreint par adresse source
vault write auth/approle/role/rtms-api token_policies=rtms-api token_ttl=5m token_max_ttl=10m \
  secret_id_ttl=720h secret_id_bound_cidrs="10.0.0.0/8,172.16.0.0/12"
vault write auth/approle/role/rtms-license-issuer token_policies=rtms-license-issuer token_ttl=5m token_max_ttl=10m
echo "Renseigner ensuite les secrets :"
echo "  vault kv put secret/rtms/prod DATABASE_URL=... REDIS_URL=... DATA_ENCRYPTION_KEYS=... METRICS_TOKEN=..."
echo "  vault kv put secret/rtms-license LICENSE_SIGNING_KEY_PEM=@license-signing.key ISSUER_DATABASE_URL=... ISSUER_ADMIN_TOKEN_SHA256=..."
