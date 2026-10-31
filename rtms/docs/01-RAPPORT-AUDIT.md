# Rapport d'audit technique — RTMS

**Objet audité :** `RAHA_TRANSPORT_PROTOTYPE.zip` (fichier unique `raha_transport/index.html`, 19 Ko) et cahier des charges RTMS V2.
**Date :** 31 octobre 2026
**Auteur de l'intervention :** _[à compléter : nom, fonction]_

---

## 1. Ce qui existait

Le « projet existant » est un prototype d'interface, pas encore une application. Tout tient dans un seul fichier HTML :

- 14 écrans accessibles depuis un menu latéral (tableau de bord, 11 modules de saisie, rapports, paramètres) ;
- un formulaire générique par module, une liste avec recherche, un bouton « Supprimer » et un export CSV ;
- les données sont stockées dans le `localStorage` du navigateur (clé `rtms_data`).

Il n'y a ni serveur, ni base de données, ni comptes utilisateurs. Le prototype l'annonce lui-même (« la synchronisation serveur et les comptes utilisateurs seront ajoutés dans la phase backend »). L'audit porte donc à la fois sur les défauts du code présent et sur l'écart entre ce prototype et une exploitation réelle.

Point positif à noter : l'auteur du prototype échappait déjà les valeurs affichées (fonction `esc()`), ce qui évitait l'essentiel des injections XSS. L'identité visuelle (vert, orange, jaune) est cohérente avec le cahier des charges.

## 2. Anomalies et vulnérabilités relevées

Sévérité : **C** critique · **H** haute · **M** moyenne · **F** faible.

### 2.1 Défauts fonctionnels (données fausses ou perdues)

| # | Sév. | Constat | Conséquence concrète |
|---|---|---|---|
| F1 | **C** | Après une recherche, « Supprimer » utilise l'indice de la ligne **dans la liste filtrée** pour supprimer dans la liste complète (`data[k].splice(i,1)`). | On cherche « Coton », on supprime la ligne affichée… et c'est une autre mission qui disparaît. Perte de données silencieuse. |
| F2 | **H** | Quand une colonne ne porte pas le nom exact d'un champ, l'affichage prend la valeur **à la même position** (`vals[j]`). | En facturation, la colonne « Total TTC » affichait la **quantité**. « Trajet » n'affichait que la ville de départ. « Assurance » affichait le kilométrage, etc. |
| F3 | **H** | Le total TTC n'est jamais calculé ; le champ « Taxe (%) » est ignoré. | Montants de factures faux à l'affichage. |
| F4 | **H** | « Type (Recette/Dépense) » est un champ texte libre ; le rapport ne compte en dépense que la chaîne exacte `Dépense`. | Une saisie « depense » ou « Dépense » est comptée comme une **recette** : solde de trésorerie faux. Même problème pour Import/Export et Client/Fournisseur. |
| F5 | **M** | Aucun identifiant, date de création ni auteur sur les enregistrements. | Impossible de tracer, de dédoublonner ou de relier les données (exigence §7 du CdC). |
| F6 | **M** | Aucun contrôle d'unicité (n° de facture, immatriculation, matricule…). | Doublons de factures possibles. |
| F7 | **M** | `JSON.parse(localStorage…)` sans protection. | Une donnée corrompue bloque toute l'application au démarrage. |
| F8 | **M** | Le bouton « Enregistrer les paramètres » affiche seulement une alerte. | Bouton factice, contraire à la règle du CdC « chaque action visible doit fonctionner ». |
| F9 | **F** | Tous les champs sont obligatoires, y compris ceux qui ne le sont pas métier. | Saisie bloquée quand une information manque (ex. date de prochain entretien). |
| F10 | **F** | L'impression du rapport imprime aussi le menu et la barre supérieure. | Rapport papier peu lisible. |

### 2.2 Vulnérabilités de sécurité

| # | Sév. | Constat | Risque |
|---|---|---|---|
| S1 | **C** | Aucune authentification ni contrôle d'accès. | Toute personne devant le poste lit, modifie et supprime tout. |
| S2 | **C** | Données en clair dans le navigateur, sur un seul poste. | Vol du poste ou accès à la session Windows = accès à toutes les données. Nettoyage du navigateur = perte totale. Aucune sauvegarde. |
| S3 | **C** | Suppression définitive sans trace. | Contraire au CdC (§7 : annulation tracée) ; aucune preuve en cas de litige ou de fraude interne. |
| S4 | **H** | Export CSV vulnérable à l'injection de formules (`=`, `+`, `-`, `@`). | Une valeur saisie comme `=HYPERLINK(...)` s'exécute à l'ouverture dans Excel. |
| S5 | **H** | Validation uniquement dans le navigateur (attributs HTML). | Contournable en deux clics avec les outils du navigateur. Tant qu'il n'y a pas de serveur, aucune règle n'est réellement appliquée. |
| S6 | **M** | Gestionnaires `onclick` en ligne dans le HTML. | Empêche une politique CSP stricte (`script-src 'self'`), qui est la meilleure défense contre le XSS. |
| S7 | **M** | Aucun en-tête de sécurité (CSP, anti-clickjacking, etc.). | Dépend de l'hébergement, rien n'est prévu. |
| S8 | **F** | Pas de journal, pas de supervision. | Un incident passe inaperçu. |

### 2.3 Écart avec le cahier des charges (non bloquant pour l'audit, mais à suivre)

- Multi-utilisateur, rôles, journal d'audit, sauvegardes : absents (traités dans cette intervention).
- Facture conforme au modèle RAHA (logo, filigrane, montant en lettres, avances, PDF A4) : **absente, non traitée ici** — le modèle original n'est pas dans les fichiers reçus (l'image de l'annexe A du CdC n'a pas été exploitée faute de validation des mentions légales).
- Interface « type Word/Excel » avec ruban (addendum du CdC) : **non traitée**. La consigne de cette mission était de préserver les interfaces actuelles ; les deux exigences se contredisent et c'est à RAHA TRANSPORT de trancher.
- Relations entre entités (mission → facture → règlement), stocks réels, PDF, pièces jointes : **non traitées** (phases 3 à 5 du CdC).

## 3. Plan d'intervention retenu

L'ordre suit le risque : d'abord ce qui peut faire perdre ou fuiter des données, ensuite l'exploitation.

| Étape | Contenu | Statut |
|---|---|---|
| 1 | API Node.js/Fastify en TypeScript, base PostgreSQL, Prisma, Redis | Fait, testé |
| 2 | Authentification (Argon2id), MFA TOTP, sessions serveur, CSRF, limitation de débit, verrouillage de compte | Fait, testé |
| 3 | RBAC par module et par action, configurable ; RLS PostgreSQL par société | Fait, testé |
| 4 | Validation serveur, calculs serveur, unicité, verrou optimiste, annulation tracée | Fait, testé |
| 5 | Journal d'audit chaîné SHA-256 et immuable | Fait, testé |
| 6 | Chiffrement applicatif des données sensibles, secrets par Vault ou fichiers | Fait, testé (Vault avec un faux serveur) |
| 7 | Licences Ed25519 : serveur éditeur + vérification côté installation | Fait, testé |
| 8 | Frontend branché sur l'API, mêmes écrans, corrections F1 à F10 et S4/S6 | Fait, testé (Playwright) |
| 9 | Migration contrôlée des données du prototype (`localStorage` → serveur) | Fait, testé |
| 10 | Sauvegarde Restic + test de restauration automatisé ; config pgBackRest | Restic fait et testé ; pgBackRest configuré, **non exécuté** |
| 11 | Supervision : métriques Prometheus, Sentry, OpenTelemetry ; configs Grafana, Loki, Wazuh | Code fait ; stack **non démarrée** ici |
| 12 | Docker, Compose prod, Caddy TLS, Cloudflare (Terraform), CI/CD GitHub Actions | Fichiers écrits, **non exécutés** (pas de Docker ni de compte Cloudflare dans l'environnement) |
| 13 | Tests : Vitest, Playwright, k6, Trivy | Exécutés |
| 14 | ZAP, Snyk, SonarQube | Intégrés à la CI, **non exécutés** (comptes/outils absents) |

Le détail de ce qui a été vérifié et de ce qui ne l'a pas été figure dans `03-SECURITE.md` et `04-TESTS-ET-PERFORMANCE.md`.

## 4. Défauts trouvés pendant l'intervention

Deux problèmes sont apparus en testant, et méritent d'être signalés parce qu'ils auraient pu passer en production :

1. **Chaîne d'audit cassée sous charge.** Après le test k6 (100 utilisateurs), le test de restauration a signalé une rupture de la chaîne d'audit alors que rien n'avait été falsifié. Cause : l'identifiant de séquence était attribué avant la prise du verrou dans le trigger. Correction par la migration `0003_audit_chain_order` et un test qui reproduit le cas de façon déterministe (il échoue avec l'ancienne fonction, passe avec la nouvelle). Les chaînes écrites avant la correction restent telles quelles ; cela ne concerne que les bases de développement.
2. **Limites de débit indexées sur l'adresse IP.** Dans un bureau, tous les postes sortent souvent par une seule IP publique. Une limite par IP aurait bloqué tout le personnel dès qu'un poste insistait. Les limites sont maintenant comptées par utilisateur connecté (et par IP + compte pour la connexion) ; les plafonds bruts par IP sont laissés à Cloudflare.

Un troisième point, plus discret : la lecture des secrets `*_FILE` lisait **toute** variable d'environnement se terminant par `_FILE` (par exemple `SSL_CERT_FILE` du système). C'est maintenant une liste fermée.
