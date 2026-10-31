# Politique du serveur de licences (éditeur) : seul détenteur de la clé privée Ed25519.
path "secret/data/rtms-license" { capabilities = ["read"] }
path "auth/token/revoke-self" { capabilities = ["update"] }
