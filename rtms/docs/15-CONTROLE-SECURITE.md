# Contrôle de sécurité point par point (version 2.6.1, 16/11/2026)

Ce document reprend une liste de 25 contrôles et indique, pour chacun, ce qui existe dans RTMS, où c'est dans le code, et comment c'est vérifié.

Ce contrôle a été fait sur le code et par des tests automatiques. Il ne remplace pas un test d'intrusion réalisé par un tiers.

Légende :

- **Déjà en place** : vérifié pendant ce contrôle, sans changement.
- **Corrigé en 2.6.1** : un manque a été trouvé et corrigé.
- **Sans objet** : la fonction n'existe pas dans RTMS.

| # | Contrôle | État | Où / comment |
|---|---|---|---|
| 1 | Vraie authentification | Déjà en place, **complété** | Sessions côté serveur ; double authentification (TOTP) obligatoire pour administrateur, direction et comptable ; codes de secours ; verrouillage progressif après 5 échecs. 2.6.1 : le mot de passe provisoire d'un nouvel utilisateur doit être changé avant tout accès. Il ne l'était pas, malgré ce que disait un commentaire du code. |
| 2 | Clés d'API cachées | Déjà en place | Aucune clé dans le code de l'interface. Secrets en variables d'environnement, fichiers `*_FILE` ou Vault (serveur hébergé) ; générés à l'installation et réservés au poste principal (`local/secrets.ts`). L'application ne contient que la clé **publique** des licences. |
| 3 | Base de données sécurisée | Déjà en place | Isolation par société par la RLS PostgreSQL. Rôle applicatif sans droit de suppression ni de contournement de la RLS. Suppression physique interdite par déclencheur. Journal d'audit chaîné (SHA-256) et immuable. Champs sensibles chiffrés (AES-256-GCM). Base intégrée accessible seulement depuis le poste principal (127.0.0.1). |
| 4 | HTTPS imposé | Déjà en place | Hébergé : `PUBLIC_ORIGIN` en https obligatoire en production, HSTS, `upgrade-insecure-requests`. Poste principal : HTTPS uniquement (certificat du poste, empreinte vérifiée par les postes de travail). |
| 5 | Mots de passe hachés | Déjà en place | Argon2id (19 Mio, 2 passes). Mots de passe faibles ou contenant l'e-mail refusés (12 caractères minimum). Codes de secours et codes de réinitialisation stockés en empreinte seulement. |
| 6 | Validation côté serveur | Déjà en place, **complété** | Schémas zod stricts pour chaque module : champ inconnu refusé, listes fermées, dates, longueurs. 2.6.1 : plafond de 1 000 milliards sur les montants et de 1 million sur les quantités ; avant, une valeur absurde pouvait rendre un total infini. |
| 7 | Protection XSS | Déjà en place, **testé** | Échappement systématique à l'affichage, et politique CSP qui interdit tout script non fourni par le serveur. 2.6.1 : test automatique avec un nom de client piégé (`<img onerror=…>`), affiché comme du texte, sans exécution. |
| 8 | Activités suspectes enregistrées et surveillées | Déjà en place, **complété** | Journal d'audit (connexions, échecs, verrouillages, exports, changements de droits…), dont l'intégrité se vérifie en un clic. 2.6.1 : les essais sur un compte déjà verrouillé sont enregistrés (avant, une attaque devenait invisible après le verrouillage). Alertes dans la cloche pour les profils qui lisent l'audit : compte verrouillé, 10 échecs de connexion ou plus en 24 h. |
| 9 | Routes d'administration verrouillées | Déjà en place | Chaque route d'administration exige le droit « admin » de la ressource concernée, contrôlé par le serveur. Testé par profil. |
| 10 | Requêtes paramétrées | Déjà en place, **corrigé** | Prisma et requêtes SQL paramétrées. 2.6.1 : les routes du suivi GPS (2.5) assemblaient le texte SQL, avec des valeurs passées en paramètres. Elles utilisent maintenant uniquement des requêtes paramétrées, comme le reste du code. |
| 11 | Variables d'environnement vérifiées | Déjà en place, **complété** | Schéma zod au démarrage. En production, refus de démarrer si : cookie non sécurisé, origine en http, contrôle de licence désactivé. 2.6.1 : refus aussi des journaux de débogage, des mots de passe d'exemple (`change-me`, `devapp`…), d'une clé de chiffrement non générée, et d'un jeton de supervision trop court. |
| 12 | Limite de requêtes | Déjà en place | 300 requêtes par minute et par utilisateur (par IP sans session). Connexion : 10 par minute par IP et par compte. Code MFA : 10 par 5 minutes. Réinitialisation : 5 par 15 minutes. |
| 13 | Réglages CORS restreints | Déjà en place, **nettoyé** | Aucun accès autorisé depuis une autre origine (pas d'en-tête CORS). Origine contrôlée sur chaque écriture. 2.6.1 : le paquet `@fastify/cors`, installé mais inutilisé, a été retiré. Testé : une demande venant d'un autre site ne reçoit aucune autorisation. |
| 14 | En-têtes de sécurité | Déjà en place | Helmet : CSP stricte, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS en production. |
| 15 | Cookies de session sécurisés | Déjà en place | `__Host-rtms_sid`, `HttpOnly`, `Secure`, `SameSite=Strict`. Expiration après 30 minutes d'inactivité, et au plus tard 12 heures après la connexion. Nouvel identifiant après la double authentification et après changement de mot de passe. |
| 16 | Protection CSRF | Déjà en place | Jeton CSRF par session, exigé sur toute écriture et comparé en temps constant, en plus du contrôle d'origine et de `SameSite=Strict`. |
| 17 | Liens de réinitialisation qui expirent | **Ajouté en 2.6.1** | Il n'existait aucun moyen de réinitialiser un mot de passe oublié. RTMS fonctionne sans e-mail : l'administrateur génère un **code** (16 caractères, 80 bits). Ce code est à usage unique, valable **30 minutes**, annule le précédent, et ne fonctionne qu'avec l'e-mail du compte. Après usage, toutes les sessions du compte sont fermées. Le code n'apparaît jamais dans l'audit. |
| 18 | Type et taille des fichiers envoyés | Déjà en place, **complété** | RTMS ne reçoit aucun fichier brut : les traces GPS sont lues sur le poste puis envoyées en JSON, revalidé par le serveur. Limites : 1 Mo par défaut, 4 Mo pour une trace GPS, 10 Mo pour la reprise des données du prototype. 2.6.1 : seul le JSON est accepté (le texte brut est refusé, code 415). |
| 19 | Prix et paiements vérifiés | Déjà en place, **complété** | Totaux, taxe, reste et montant en lettres calculés par le serveur (le poste ne peut pas les imposer) ; avance plafonnée au total ; passage en « Payée » réservé au droit de validation ; plafonds de montants (point 6). Pas de paiement en ligne dans RTMS. |
| 20 | Mode debug désactivé en production | Déjà en place, **complété** | Outils de développement désactivés dans l'application installée. Aucun détail technique dans les erreurs (référence seulement). Journaux de débogage interdits en production (point 11). |
| 21 | Dépendances vulnérables | Contrôlé | `npm audit` : **0 vulnérabilité** (serveur, interface, application de bureau). |
| 22 | Paquets inutilisés | **Corrigé en 2.6.1** | `depcheck` : `@fastify/cors` retiré. `pino` gardé (utilisé par Fastify). |
| 23 | Fichiers exposés | **Corrigé en 2.6.1** | L'installateur et l'image Docker ne contenaient déjà que l'application. Mais un serveur lancé depuis le dossier du projet servait aussi `package.json`, les tests, `node_modules`, et l'image Docker servait le code de démonstration, qui n'a pas de sécurité. Le serveur ne sert désormais qu'une **liste blanche** (`index.html`, `app.css`, `src/*.js` hors démonstration, images de `assets/`). `../` et ses formes encodées sont refusés. Testé. |
| 24 | Secrets dans l'historique Git | Contrôlé | Recherche dans les 29 commits : clés privées, jetons GitHub/AWS/Google/Slack, clés de chiffrement, jetons de licence, fichiers `.env`/`.pem`. **Rien trouvé.** Seuls existent des mots de passe d'exemple (`change-me`) et ceux de la base de test locale. `.gitignore` étendu (`.env`, sauvegardes `.rtmsbak`). Le scanner de secrets de GitHub n'a pas pu être lancé : il demande l'option payante GitHub Advanced Security. |
| 25 | Clés compromises révoquées et remplacées | Sans objet | Aucune clé n'a fuité (point 24), donc rien à révoquer. Voir la note sur la clé privée des licences ci-dessous. |

## Note sur la clé privée des licences

La clé privée qui signe les licences n'a jamais été dans Git (`.gitignore` : `*cle-privee*`, `*.private.pem`). Elle a été créée pendant la préparation de la version 2.4 dans un environnement de travail en ligne, puis transmise à l'éditeur.

Rien n'indique qu'elle ait été copiée. Par précaution, avant de vendre des licences à grande échelle, l'éditeur peut :

1. générer une nouvelle paire de clés sur son propre PC (outil `license-keygen`) ;
2. livrer une version de RTMS avec la nouvelle clé publique ;
3. réactiver les clients déjà équipés.

À faire avant le premier client payant, pas après.

## Ce qui reste hors du logiciel

- Les mots de passe des postes Windows, l'antivirus, les mises à jour de Windows et la sécurité physique du poste principal.
- Le rangement hors du bureau des copies de sauvegarde (clé USB).
- La transmission des codes de réinitialisation en main propre ou par téléphone, jamais dans un groupe de discussion.

## Tests

- **Serveur** : 141 tests. Nouveaux :
  - `password-reset.test.ts` : réinitialisation, expiration, usage unique, anti force brute, changement obligatoire, alertes de sécurité, refus du texte brut, CORS, configuration de production ;
  - `static.test.ts` : liste blanche des fichiers ;
  - plafonds des montants dans `definitions.test.ts`.
- **Navigateur** : 27 scénarios, dont XSS, mot de passe provisoire et mot de passe oublié. Le dernier scénario vérifie qu'aucune erreur JavaScript et aucune violation CSP ne se produisent pendant toute la session.
- **Application de bureau** : contrôles complets, et réseau local hors ligne à deux postes (migration `0009` appliquée sur la base intégrée).
