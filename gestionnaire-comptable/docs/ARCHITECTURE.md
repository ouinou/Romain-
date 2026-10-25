# Architecture de FINEXA ERP

État : socle technique (sections 1 à 6 du cahier des charges). Les modules métier (comptabilité OHADA, trésorerie, stocks, paie…) viendront se brancher dessus.

## Vue d'ensemble

```
 Postes du réseau local (navigateur : PC, tablette, téléphone)
                 │  HTTPS, cookie de session HttpOnly
                 ▼
 ┌─────────────────────────────────────────────┐
 │ Serveur Windows : service « Gestionnaire    │
 │ Comptable » (Node.js + Fastify)             │
 │  • API /api/...  (JSON)                     │
 │  • contrôle de session, MFA, permissions    │
 │  • journalisation de chaque action sensible │
 └───────────────┬─────────────────────────────┘
                 │  connexion locale, rôle gc_app
                 ▼
 ┌─────────────────────────────────────────────┐
 │ PostgreSQL 16 (même machine ou serveur      │
 │ dédié)                                      │
 │  • Row-Level Security par entreprise        │
 │  • journal d'audit en ajout seul, chaîné    │
 └─────────────────────────────────────────────┘
        ▲                     ▲
   gc_owner (migrations,  gc_backup (sauvegardes
   outils d'exploitation) chiffrées, lecture seule)
```

Rien ne dépend d'Internet. Le même serveur peut plus tard être installé sur une machine dédiée sans changer le code : seule la configuration (adresse de la base, certificat) change.

## Choix techniques et raisons

| Couche | Choix | Pourquoi |
|---|---|---|
| Serveur | Node.js 22 LTS, TypeScript, Fastify 5 | Installable sous Windows sans licence, typage strict, framework HTTP rapide et maintenu. |
| Base | PostgreSQL 16 | Imposé par le cahier des charges. Apporte la Row-Level Security, indispensable ici. |
| Mots de passe | Argon2id (19 Mio, 2 itérations) | Recommandation OWASP actuelle. |
| Validation | Zod | Chaque entrée de l'API est validée avant usage. |
| Double authentification | TOTP (RFC 6238), implémenté sans service externe | Fonctionne hors ligne avec Google Authenticator, Microsoft Authenticator, FreeOTP, etc. |
| Interface | React 18 + Vite, sans bibliothèque de composants | Servie par le même serveur, aucune ressource externe. Les couleurs, ombres, rayons et la police sont des jetons CSS définis dans `interface/src/jetons.css` (charte FINEXA) ; les composants n'utilisent que ces variables, ce qui permet aussi d'appliquer les couleurs propres à une entreprise. |

## Organisation du code (`serveur/`)

```
migrations/      001 = schéma fourni par le porteur du projet ; 002 = corrections et sécurité ; … ; 008 = identité figée sur les reçus
sql/             préparation de PostgreSQL (rôles, base) à exécuter une fois
src/config.ts    lecture et contrôle de la configuration
src/db.ts        pool de connexions, transaction avec contexte d'entreprise
src/securite/    mots de passe, jetons, TOTP, chiffrement, limitation des tentatives
src/domaine/     règles métier : rôles système, sessions, audit, entreprises, migrations
src/http/        application Fastify, enveloppe de sécurité commune, routes par module
src/cli/         outils d'exploitation : migrer, créer une entreprise, vérifier le journal, sauvegarder, restaurer
test/            tests d'intégration sur un vrai PostgreSQL
```

## Profil de l'entreprise : une seule source

`src/domaine/profil-entreprise.ts` est le seul endroit qui lit et assemble l'identité de l'entreprise :

- **Stockage** : la base PostgreSQL de l'entreprise (colonnes de `companies` pour la raison sociale, le RCCM, le NIU, l'adresse, le téléphone, le pays et la devise ; `companies.settings.profil` pour le reste ; images dans `company_logos`, en ajout seul). Rien dans le navigateur.
- **Validation** : schéma zod commun (formats, longueurs) et contrôle de cohérence avec les paramètres fiscaux.
- **Identité imprimée** (`identiteDocument`) : calculée à partir du profil, options d'affichage déjà appliquées. Les factures et avoirs la copient dans `seller` à l'émission ; les mouvements de trésorerie la reçoivent dans `issuer` par un déclencheur (migration 008), qui lit la copie tenue à jour dans `companies.settings.identiteDocument`. Ces tables sont en ajout seul : un document émis ne change jamais, même si le profil change.
- **Mise en page** : `lignesIdentite()` donne les lignes d'en-tête et de pied dans l'ordre d'impression, pour les PDF (`domaine/ventes/pdf.ts`). L'aperçu à l'écran (`interface/src/composants/IdentiteEntreprise.tsx`) reprend la même logique : les deux fichiers doivent rester alignés.
- **États imprimés** : `/api/entreprise/apparence` fournit une identité courte (`enteteEtat`) que le cadre de l'interface imprime en tête de chaque page de travail, avec la période publiée par l'écran et la date d'édition.

Un module futur (achats, stocks, paie, états financiers) doit utiliser `identiteActuelle()` pour un nouveau document et figer le résultat avec le document.

## Séparation des entreprises : comment elle est garantie

La séparation ne repose pas sur la bonne volonté du code. Trois niveaux se superposent.

1. **Base de données.** Chaque table métier porte `company_id` et une politique RLS : `company_id = current_company_id()`. Le serveur se connecte avec le rôle `gc_app`, qui n'a pas le droit de contourner la RLS. Sans contexte d'entreprise, il ne voit aucune ligne. Avec le contexte de A, une écriture dans B est refusée par PostgreSQL.
2. **Clés étrangères composites** `(id, company_id)`, déjà présentes dans le schéma initial : un rôle de A ne peut pas être attribué à un utilisateur de B, même par erreur de programmation.
3. **Serveur.** Le contexte d'entreprise vient de la session (stockée côté serveur), jamais d'un paramètre envoyé par le navigateur. Un cookie modifié pour pointer vers une autre entreprise ne correspond à aucune session.

Le code entreprise ne sert qu'à identifier l'espace au moment de la connexion. Ce n'est pas un secret.

## Cycle d'une requête protégée

1. Lecture du cookie `gc_session` (identifiant d'entreprise + jeton aléatoire de 256 bits).
2. Ouverture d'une transaction avec le contexte de l'entreprise.
3. Recherche de la session par empreinte SHA-256 du jeton (le jeton n'est jamais stocké).
4. Contrôles : session non révoquée, inactivité < 15 min, durée < 10 h, compte actif, accès non expiré. Sinon, révocation immédiate.
5. Si un rôle détenu exige la MFA et qu'elle n'est pas activée, seules les routes de configuration MFA restent accessibles.
6. Contrôle de la permission `module.action` déclarée par la route. Un refus est écrit dans le journal.
7. Traitement, puis journalisation dans la même transaction : l'action et sa trace sont validées ensemble ou annulées ensemble.

Les échecs et refus sont journalisés dans une transaction séparée, pour ne pas disparaître avec l'opération annulée.

## Permissions

Grille de 14 modules × 10 actions (consulter, créer, modifier, soumettre, valider, annuler, archiver, imprimer, exporter, administrer), soit 140 permissions de la forme `accounting.approve`.

- 10 rôles système créés pour chaque entreprise (voir `src/domaine/roles-systeme.ts`). Ils ne sont pas modifiables. Pour adapter un profil, on crée un rôle personnalisé, éventuellement copié d'un rôle système.
- Garde-fous contre l'auto-attribution : personne ne peut modifier ses propres rôles, se désactiver, ni changer les permissions d'un rôle qu'il détient.
- Le dernier administrateur actif ne peut pas être désactivé ni perdre ses droits.
- Aucune route ne permet de modifier ou supprimer le journal. L'administrateur n'a, par défaut, aucun droit sur les données financières.

## Journal d'audit

Détail dans [SECURITE.md](SECURITE.md). En bref : table en ajout seul, horodatage et numéro de séquence imposés par la base, empreinte SHA-256 de chaque événement chaînée à la précédente, vérification à la demande et ancrages exportés hors de la base.

## Ce qui reste à construire

Voir [FEUILLE-DE-ROUTE.md](FEUILLE-DE-ROUTE.md).
