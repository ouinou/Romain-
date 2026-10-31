# Résultats des tests et rapport de performance

Mesures faites le 31/10/2026 dans un conteneur Linux à **4 cœurs**, PostgreSQL 16.15 et Redis sur la même machine, une seule instance de l'API. Ce n'est pas le serveur de production : les chiffres donnent un ordre de grandeur, pas une garantie.

## Synthèse

| Outil | Portée | Résultat |
|---|---|---|
| Vitest — unitaires | chiffrement, jetons de licence, validation, CSV, RBAC, mots de passe, Vault, absence de secrets dans le web | **28 / 28** |
| Vitest — intégration (vrais PostgreSQL + Redis) | authentification, MFA, CSRF, débit, RBAC, RLS, audit, chiffrement, import, licences, concurrence | **42 / 42** |
| Couverture (Vitest v8) | `apps/api/src` | lignes 80,6 % · instructions 76,1 % · branches 64,9 % · fonctions 75,3 % |
| Playwright (Chromium) | parcours réels dans le navigateur | **10 / 10** |
| k6 — charge | 0 → 50 → 100 utilisateurs, 2 min 20 | **0 % d'erreur**, p95 lecture 10,8 ms |
| k6 — résistance | 100 utilisateurs sans temps de réflexion, 40 s | **0 % d'erreur**, ~490 req/s, p95 258 ms |
| Restic + `restore-test.sh` | sauvegarde chiffrée puis restauration dans une base jetable | **restauration vérifiée** (3 migrations, chaîne d'audit intacte) |
| Trivy fs | dépendances npm, secrets, Dockerfile, Terraform | **0** HIGH/CRITICAL |
| npm audit | API et web | **0** vulnérabilité |
| OWASP ZAP, Snyk, SonarQube | — | **non exécutés** (voir plus bas) |

## Tests de bout en bout (Playwright)

1. Connexion refusée avec un mauvais mot de passe, puis enrôlement MFA obligatoire de l'administrateur (QR code, code TOTP, 10 codes de secours).
2. Les 14 entrées de menu du prototype sont présentes.
3. Transport : trois missions créées, recherche « coton », suppression → c'est bien la mission « coton » qui disparaît (régression F1).
4. Référence en double : message clair renvoyé par le serveur.
5. Facture 2 × 250 000 FCFA à 18 % : la colonne affiche 590 000 (régression F2/F3).
6. Tableau de bord et rapports cohérents avec les saisies.
7. Paramètres enregistrés, toujours là après rechargement ; vérification d'intégrité du journal.
8. Transfert des données d'un ancien `localStorage` vers le serveur (aperçu puis import).
9. Après déconnexion, l'API répond 401.
10. Aucune erreur JavaScript, aucune violation de CSP pendant tout le parcours.

## Charge (k6)

Scénario `tests/load/rtms.k6.js` : chaque utilisateur virtuel se connecte avec son propre compte, puis enchaîne tableau de bord, liste de 50 missions, recherche, et dans 30 % des cas une création. Temps de réflexion de 1 à 3 s.

| Indicateur | Charge (100 VU, réflexion 1-3 s) | Résistance (100 VU, sans pause) |
|---|---|---|
| Requêtes traitées | 14 092 (~100 req/s) | 19 832 (~490 req/s) |
| Échecs | 0 % | 0 % |
| Lecture p95 | 10,8 ms | 258 ms |
| Écriture p95 | 12,9 ms | 264 ms |
| Max observé | 33 ms | 874 ms |

Lecture : pour un effectif réaliste de RAHA TRANSPORT (quelques dizaines de postes), la marge est large. En résistance, la saturation vient du processeur partagé entre Node.js, PostgreSQL et le hachage Argon2 des connexions ; une deuxième instance de l'API (déjà prévue dans `compose.prod.yml`) et un serveur dédié repoussent ce seuil.

Ce qui n'a pas été mesuré : les performances avec plusieurs centaines de milliers d'enregistrements par module (la recherche s'appuie sur un index trigramme, mais je ne l'ai pas éprouvée à ce volume), et la latence réseau réelle entre les postes et le serveur.

## Ce que les tests ont permis de corriger

- Chaîne d'audit cassée sous concurrence → migration 0003 (voir `01-RAPPORT-AUDIT.md` §4).
- Limite de débit par IP inadaptée à un bureau derrière NAT → limite par utilisateur.
- Sauvegarde : empreinte SHA-256 enregistrée avec un chemin absolu, invérifiable à la restauration → corrigé.
- Insertion d'audit refusée par la RLS pour les échecs de connexion d'un e-mail inconnu (`INSERT … RETURNING` soumis à la politique de lecture) → insertion sans `RETURNING`.

## Non exécutés, et pourquoi

- **OWASP ZAP** : nécessite Docker ou Java, absents ici. Le scan de base est dans la CI (`zaproxy/action-baseline`) avec `tests/security/zap-rules.tsv`.
- **Snyk, SonarQube** : nécessitent un compte et un jeton. Étapes prêtes dans la CI, activées dès que `SNYK_TOKEN` / `SONAR_TOKEN` sont renseignés.
- **pgBackRest** : non installé dans l'environnement. Configuration et script de test de restauration physique fournis.
- **Build de l'image Docker** : pas de démon Docker. Le Dockerfile est analysé par Trivy et la CI le construit.

## Relancer les tests

```bash
cd rtms/apps/api && npx vitest run
```

```bash
cd rtms/apps/web && npx playwright test
```

```bash
k6 run -e BASE_URL=http://localhost:3000 -e USERS_FILE=users.json rtms/tests/load/rtms.k6.js
```
