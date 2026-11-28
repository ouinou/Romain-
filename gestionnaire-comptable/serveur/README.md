# FINEXA ERP : serveur

API sécurisée et outils d'exploitation. Node.js 22, TypeScript, Fastify, PostgreSQL 16.

- Architecture : [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- Sécurité et limites : [../docs/SECURITE.md](../docs/SECURITE.md)
- Installation sous Windows : [../docs/INSTALLATION-WINDOWS.md](../docs/INSTALLATION-WINDOWS.md)
- Routes de l'API : [../docs/API.md](../docs/API.md)

## Commandes

| Commande | Rôle |
|---|---|
| `npm ci && npm run build` | Installer et compiler |
| `npm run migrer` | Appliquer les migrations (rôle gc_owner) |
| `npm run entreprise:creer -- --code … --raison-sociale … --admin-email … --admin-nom …` | Créer une entreprise et inviter son administrateur |
| `npm run demarrer` | Lancer le serveur (lit `.env`) |
| `npm run journal:verifier` | Contrôler l'intégrité des journaux et ajouter des ancrages |
| `npm run sauvegarder` | Sauvegarde complète chiffrée |
| `npm run restaurer -- --fichier=… --base-cible … --confirmer` | Restaurer dans une base vide |
| `npm test` | Tests d'intégration (PostgreSQL requis, voir ci-dessous) |

## Lancer les tests

Les tests créent une base neuve par exécution sur un PostgreSQL où existent les rôles `gc_owner`, `gc_app` et `gc_backup` :

```bash
psql -U postgres -c "CREATE ROLE gc_owner LOGIN; CREATE ROLE gc_app LOGIN NOINHERIT; CREATE ROLE gc_backup LOGIN BYPASSRLS;"
GC_TEST_SUPER=postgresql://postgres@localhost:5432/postgres npm test
```

## Migrations

`001_schema_initial.sql` est le schéma fourni par le porteur du projet, sans modification. `002_securite_et_audit.sql` le corrige et le complète, avec un commentaire pour chaque changement. Une migration appliquée ne se modifie plus : on en ajoute une nouvelle.
