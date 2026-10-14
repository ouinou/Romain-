# API du serveur (v0.1)

Toutes les réponses sont en JSON, sauf l'export CSV. Les erreurs ont la forme `{ "erreur": { "code", "message" } }`.

Toute requête autre que GET doit porter l'en-tête `X-GC-Requete: 1`. La session est portée par le cookie `gc_session` (HttpOnly), posé à la connexion.

Les listes acceptent `page` (à partir de 1) et `taille` (1 à 100, 25 par défaut), et renvoient `{ elements, total, page, taille }`.

## Authentification (`/api/auth`)

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| POST | `/connexion` | — | `{ codeEntreprise, email, motDePasse, codeMfa? }`. Codes d'erreur : `identifiants_invalides`, `mfa_requis`, `mfa_invalide`, `compte_verrouille`, `compte_inactif`, `trop_de_tentatives`. |
| POST | `/deconnexion` | connecté | Ferme la session. |
| GET | `/moi` | connecté | Utilisateur, entreprise, rôles, permissions, état MFA. |
| POST | `/mot-de-passe` | connecté | `{ ancien, nouveau }`. Ferme les autres sessions. |
| POST | `/invitation/acceptation` | — | `{ codeEntreprise, jeton, motDePasse }` : active un compte invité. |
| POST | `/reinitialisation` | — | `{ codeEntreprise, jeton, motDePasse }`. |
| POST | `/mfa/initialisation` | connecté | Renvoie `secret` et `uri` (otpauth://, à afficher en QR code). |
| POST | `/mfa/activation` | connecté | `{ code }`. |
| POST | `/confirmation` | connecté | `{ motDePasse, codeMfa? }`. Valide les opérations sensibles pendant 5 min. Erreur `confirmation_requise` sur une route sensible sans confirmation récente. |
| POST | `/recuperation` | — | `{ codeEntreprise, codeMaitre, email }` : rétablit l'accès d'un administrateur actif. Renvoie un code de réinitialisation de 30 min ; le code maître est consommé. |
| GET | `/sessions` | connecté | Mes sessions ouvertes. |
| DELETE | `/sessions/:id` | connecté | Fermer une de mes sessions. |

## Utilisateurs (`/api/utilisateurs`)

| Méthode | Route | Permission | Remarques |
|---|---|---|---|
| GET | `/` | users.read | Filtres `recherche`, `statut` (invited, active, disabled), `role`, `tri` (nom, email, connexion, creation). |
| GET | `/:id` | users.read | |
| POST | `/` | users.create (+ users.admin et confirmation pour attribuer des rôles) | `{ nom, email, roles?, accesExpireLe? }`. Renvoie le code d'invitation, affiché une seule fois. |
| PATCH | `/:id` | users.update | `{ nom?, accesExpireLe? }`. |
| POST | `/:id/desactivation` | users.admin + confirmation | `{ motif }`. Ferme ses sessions. Interdit sur soi-même et sur le dernier administrateur. |
| POST | `/:id/reactivation` | users.admin + confirmation | `{ motif }`. |
| POST | `/:id/deverrouillage` | users.admin + confirmation | Lève un verrouillage après échecs. |
| PUT | `/:id/roles` | users.admin + confirmation | `{ roles: [id], motif }`. Interdit sur soi-même. |
| POST | `/:id/invitation` | users.create | Nouveau code d'invitation. |
| POST | `/:id/reinitialisation-mot-de-passe` | users.admin + confirmation | `{ motif }`. Code valable 30 min. |
| POST | `/:id/revocation-sessions` | users.admin + confirmation | `{ motif }`. |
| GET | `/:id/connexions` | users.read | Historique des connexions, échecs compris. |

## Rôles

| Méthode | Route | Permission | Remarques |
|---|---|---|---|
| GET | `/api/permissions/catalogue` | roles.read | Modules et actions. |
| GET | `/api/roles` | roles.read | `?archives=oui` pour inclure les rôles archivés. |
| GET | `/api/roles/:id` | roles.read | |
| POST | `/api/roles` | roles.create (+ roles.admin si permissions) | `{ cle, libelle, description?, mfaRequise?, permissions?, copierDe? }`. |
| PATCH | `/api/roles/:id` | roles.update | Rôles personnalisés uniquement. |
| PUT | `/api/roles/:id/permissions` | roles.admin + confirmation | `{ permissions, motif }`. Interdit sur un rôle système ou sur un rôle que l'on détient. |
| POST | `/api/roles/:id/archivage` | roles.archive | `{ motif }`. Le rôle ne doit plus être attribué. |

## Journal d'audit

| Méthode | Route | Permission | Remarques |
|---|---|---|---|
| GET | `/api/audit` | audit.read | Filtres `type`, `action`, `resultat`, `utilisateur`, `du`, `au` (AAAA-MM-JJ), `recherche`. |
| GET | `/api/audit/integrite` | audit.read | Vérifie la chaîne d'empreintes ; la vérification est elle-même journalisée. |
| GET | `/api/audit/export` | audit.export + confirmation | CSV (séparateur `;`, UTF-8 avec BOM), mêmes filtres. Export journalisé. |
| POST/PUT/PATCH/DELETE | `/api/audit…` | — | Toujours refusé (403) et journalisé comme tentative de modification. |

## Entreprise et notifications

| Méthode | Route | Permission | Remarques |
|---|---|---|---|
| GET | `/api/entreprise` | company.read | |
| PATCH | `/api/entreprise` | company.update (+ company.admin et confirmation pour `parametres`) | `{ raisonSociale?, rccm?, niu?, adresse?, telephone?, parametres?: { mfaObligatoire, inactiviteJours } }`. |
| POST | `/api/entreprise/code-maitre` | company.admin + confirmation | Génère un nouveau code maître, affiché une seule fois ; l'ancien cesse d'être valable. |
| GET | `/api/notifications` | connecté | Avec le nombre de notifications non lues. |
| POST | `/api/notifications/:id/lecture` | connecté | |
| GET | `/api/sante` | — | État du serveur et de la base. |

## Comptabilité (`/api/comptabilite`)

Montants : entiers en FCFA. Toutes les routes respectent les comptes protégés (voir `COMPTABILITE.md`).

| Méthode | Route | Permission | Remarques |
|---|---|---|---|
| GET | `/comptes` | accounting.read | Filtres `recherche`, `classe`, `imputables=oui`, `actifs=oui`. |
| POST | `/comptes` | accounting.admin | `{ numero, libelle }` : sous-compte rattaché au compte parent existant. |
| PATCH | `/comptes/:id` | accounting.admin | `{ libelle?, actif? }`. Le numéro ne change pas. |
| POST | `/comptes/import` | accounting.admin + confirmation | `{ contenu }` CSV `numero;libelle` : ajoute les comptes absents. |
| GET / POST | `/journaux` | read / admin | `{ code, libelle, type }`. |
| PATCH | `/journaux/:id` | accounting.admin | `{ libelle?, actif? }`. |
| GET / POST | `/exercices` | read / admin | `{ code, debut, fin }` ; pas de chevauchement. |
| POST | `/exercices/:id/cloture` | accounting.admin + confirmation | `{ motif }`. Définitive ; refusée s'il reste des brouillards. |
| GET / PATCH | `/parametres` | read / admin + confirmation | `{ separationSaisieValidation }`. |
| PUT | `/comptes-proteges` | accounting.admin + confirmation | `{ groupes: [{ prefixe, libelle, permission }], motif }`. |
| GET | `/ecritures` | accounting.read | Filtres `exercice`, `journal`, `statut` (brouillard, validee), `du`, `au`, `recherche`. |
| GET | `/ecritures/:id` | accounting.read | Écriture avec ses lignes, son auteur, son validateur et ses liens d'extourne. |
| POST | `/ecritures` | accounting.create | `{ journalId, date, piece, datePiece?, libelle, lignes: [{ compteId, libelle?, debit, credit }] }`. Brouillard, éventuellement déséquilibré. |
| PUT / DELETE | `/ecritures/:id` | accounting.update | Brouillards uniquement. |
| POST | `/ecritures/:id/validation` | accounting.approve + confirmation | Équilibre, séparation des tâches et numérotation contrôlés par la base. |
| POST | `/ecritures/:id/extourne` | accounting.cancel + confirmation | `{ date?, motif }`. |
| GET | `/tableau-de-bord` | accounting.read | Synthèse de l'exercice. |
| GET | `/grand-livre`, `/balance` | accounting.read | Filtres `exercice`, `du`, `au`, `compte` (début de numéro), `journal`, `brouillons=oui`. |
| GET | `/grand-livre/export`, `/balance/export` | accounting.export | CSV, tracé dans le journal. |
