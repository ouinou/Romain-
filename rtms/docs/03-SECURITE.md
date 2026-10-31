# Modules de sécurité — état réel

Règle suivie : une protection n'est marquée **vérifiée** que si un test automatisé la met en échec et constate le refus. Le reste est indiqué comme configuré ou à faire, sans détour.

## Vulnérabilités corrigées

| Réf. audit | Correction | Preuve |
|---|---|---|
| F1 suppression de la mauvaise ligne | suppression par identifiant, côté serveur | `data.test.ts` « Supprimer annule l'enregistrement visé », e2e transport |
| F2 colonnes décalées | colonnes déclarées explicitement | e2e « Total TTC affiche le montant calculé » |
| F3 TTC non calculé | calcul serveur (`computed.totalTTC`) | `definitions.test.ts`, `data.test.ts` |
| F4 Recette/Dépense en texte libre | listes fermées validées par le serveur | `definitions.test.ts` |
| F5 pas d'auteur ni de date | `created_by`, `created_at`, `updated_by`, `version` | schéma + audit |
| F6 doublons | index unique PostgreSQL insensible à la casse | `data.test.ts` « référence unique » |
| F7 JSON corrompu | lecture protégée (import) | code `app.js` |
| F8 paramètres factices | enregistrement réel + audit | e2e « paramètres » |
| F9 tous champs obligatoires | obligatoire seulement si défini côté serveur | formulaire généré depuis `/api/modules` |
| F10 impression | feuille de style `@media print` | manuel |
| S1 pas d'authentification | Argon2id + MFA + RBAC | `auth.test.ts`, `data.test.ts` |
| S2 données sur le poste | PostgreSQL centralisé, chiffrement des champs sensibles, sauvegardes | `data.test.ts`, test de restauration |
| S3 suppression sans trace | annulation tracée, `DELETE` interdit par droits et trigger | `data.test.ts` |
| S4 injection CSV | préfixe `'` + export côté serveur | `definitions.test.ts`, `data.test.ts` |
| S5 validation contournable | schémas Zod stricts côté serveur | `data.test.ts` « champ inconnu… refusés » |
| S6 `onclick` en ligne | délégation d'événements ; CSP `script-src 'self'` | e2e « aucune violation CSP » |
| S7 en-têtes absents | Helmet (CSP, nosniff, frame-ancestors, COOP…) + HSTS en prod | `auth.test.ts` |
| S8 pas de traçabilité | audit chaîné + métriques + journaux JSON | `data.test.ts` |

## Ce qui est vérifié par les tests

| Protection | Détail | Test |
|---|---|---|
| Hachage des mots de passe | Argon2id (m=19 Mio, t=2) ; calcul factice si compte inconnu (pas d'énumération par le temps de réponse) | `auth.test.ts` |
| Politique de mot de passe | 12 caractères min., mots courants refusés, pas l'identifiant | `security.test.ts` |
| Verrouillage de compte | 5 échecs → 15 min, puis doublement, plafond 24 h | `auth.test.ts` |
| MFA TOTP | obligatoire pour admin, direction, finance (paramétrable) ; secret chiffré ; anti-rejeu ; 10 codes de secours à usage unique ; session fermée après 5 codes faux | `auth.test.ts` |
| Sessions | jeton 256 bits, HttpOnly, SameSite=Strict, `__Host-` + Secure en prod ; inactivité 30 min, absolu 12 h ; nouveau jeton après MFA ; révocation des autres sessions au changement de mot de passe | `auth.test.ts` |
| CSRF | jeton lié à la session + contrôle de l'origine | `auth.test.ts` |
| Limitation de débit | globale (par utilisateur connecté, sinon par IP) + connexion (IP + compte) + MFA ; stockée dans Redis donc partagée entre instances | `auth.test.ts` |
| Injection SQL | requêtes paramétrées uniquement (Prisma, `$queryRaw` à gabarit) ; recherche échappée | `data.test.ts` (`%' OR 1=1 --`) |
| XSS | échappement systématique à l'affichage + CSP sans script en ligne | e2e |
| RBAC | 9 profils × 17 ressources × 8 actions, modifiable par l'admin, effet immédiat ; droits Administrateur non modifiables | `data.test.ts` |
| Données validées | modifier ou valider une facture validée exige le droit `validate` | `data.test.ts` |
| Isolation des sociétés (RLS) | lecture et écriture croisées refusées par PostgreSQL lui-même | `data.test.ts` |
| Moindre privilège BDD | `rtms_app` : pas de DELETE métier, pas d'UPDATE audit, pas d'accès aux licences | `data.test.ts` |
| Audit inviolable | ajout seul (UPDATE/DELETE/TRUNCATE refusés, même au propriétaire) ; chaînage SHA-256 ; une altération par superutilisateur est détectée | `data.test.ts` |
| Chiffrement au repos | AES-256-GCM, clés versionnées, contexte (AAD) par champ ; secret MFA, N° contribuable, permis | `crypto.test.ts`, `data.test.ts`, `auth.test.ts` |
| Erreurs | aucune trace technique renvoyée | `data.test.ts` |
| Secrets hors du frontend | balayage des fichiers web | `security.test.ts` + Trivy (secrets) |
| Vault | AppRole → lecture KV v2 → révocation du jeton | `security.test.ts` (faux serveur) |

## Configuré mais non vérifié dans cet environnement

Ces éléments sont écrits et relus, mais je n'ai pas pu les exécuter (pas de démon Docker, pas de compte Cloudflare, pas de serveur Vault/Wazuh réel). Ils doivent être validés lors de l'installation pilote.

- **Cloudflare WAF / anti-DDoS** : `infra/cloudflare/main.tf`. À valider par `terraform plan`. Les identifiants de rulesets gérés sont ceux publiés par Cloudflare ; à revérifier dans le tableau de bord.
- **TLS** : Caddy avec certificat d'origine Cloudflare et mTLS (`infra/caddy/Caddyfile`). PostgreSQL en `hostssl` uniquement (`infra/postgres/`).
- **Vault réel** : politiques et script `infra/vault/`.
- **Wazuh** : extrait de configuration d'agent et règles locales (`infra/wazuh/`).
- **Image Docker** : Dockerfile analysé par Trivy (0 problème HIGH/CRITICAL) mais jamais construit ici.

## Points à arbitrer par RAHA TRANSPORT

- Profils soumis à la MFA (par défaut : Administrateur, Direction, Comptable/Finance). Je recommande de l'étendre à tous les profils dès que les téléphones du personnel le permettent.
- Champs à chiffrer : actuellement N° contribuable et permis. Les téléphones et adresses ne le sont pas, pour rester cherchables. À revoir avec la personne responsable des données.
- Pays autorisés dans la règle Cloudflare (défaut : TD, CM, FR) — **à confirmer**.
- `style-src 'unsafe-inline'` reste nécessaire tant que l'interface utilise des attributs `style=` hérités du prototype. Risque faible (aucun script), mais à supprimer lors de la refonte de l'interface.

## Rotation des clés de chiffrement

1. Générer une clé : `openssl rand -base64 32`.
2. L'ajouter : `DATA_ENCRYPTION_KEYS=v1:<ancienne>,v2:<nouvelle>` et `DATA_ENCRYPTION_ACTIVE_KEY=v2`.
3. Redémarrer : les nouvelles écritures utilisent `v2`, les anciennes restent lisibles.
4. Ré-chiffrer les anciennes valeurs (script à écrire — **non fourni**), puis retirer `v1`.

Perdre une clé rend illisibles les champs chiffrés avec elle : les clés doivent être sauvegardées séparément des données (Vault + copie hors ligne).
