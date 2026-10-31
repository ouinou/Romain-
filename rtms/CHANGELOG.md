# Journal des versions

## 2.0.0 — 31/10/2026

### Ajouté
- API REST sécurisée (Node.js 22, Fastify 5, TypeScript, Prisma, PostgreSQL 16, Redis 7).
- Comptes utilisateurs, Argon2id, MFA TOTP avec codes de secours, sessions serveur, CSRF, limitation de débit, verrouillage de compte.
- 9 profils (CdC §8) avec permissions par module et par action, modifiables.
- Row-Level Security PostgreSQL par société ; rôles PostgreSQL à moindre privilège.
- Journal d'audit chaîné SHA-256, en ajout seul, vérifiable depuis l'interface.
- Chiffrement AES-256-GCM des données sensibles (secret MFA, N° contribuable, permis).
- Système de licences Ed25519 (serveur éditeur + vérification côté installation).
- Migration des données du prototype depuis le navigateur.
- Métriques Prometheus, Sentry, OpenTelemetry ; configurations Grafana, Loki, Wazuh.
- Sauvegardes Restic avec test de restauration automatique ; configuration pgBackRest.
- Docker, Compose de production, Caddy, Cloudflare (Terraform), CI/CD GitHub Actions.
- 70 tests Vitest, 10 tests Playwright, scénario k6.

### Corrigé (défauts du prototype)
- « Supprimer » après une recherche supprimait un autre enregistrement.
- Colonnes affichant la mauvaise valeur (ex. quantité dans « Total TTC »).
- Total TTC jamais calculé ; taxe ignorée.
- Recettes/dépenses mal classées selon l'orthographe saisie.
- Bouton « Enregistrer les paramètres » sans effet.
- Export CSV vulnérable à l'injection de formules.

### Modifié
- « Supprimer » devient une annulation tracée (exigence CdC §7) ; rien n'est effacé physiquement.

### Migrations
- `0001_init`, `0002_security`, `0003_audit_chain_order` (correctif de l'ordre de chaînage de l'audit sous concurrence).
