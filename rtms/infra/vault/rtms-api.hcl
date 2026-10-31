# Politique Vault de l'API RTMS (installation client) : lecture seule de ses secrets.
path "secret/data/rtms/prod" { capabilities = ["read"] }
path "auth/token/revoke-self" { capabilities = ["update"] }
