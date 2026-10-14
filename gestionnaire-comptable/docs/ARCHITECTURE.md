# Architecture de GESTIONNAIRE COMPTABLE

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
| Interface | À construire (étape suivante) | La maquette HTML existante sert de référence visuelle. Elle n'est pas l'application. |

## Organisation du code (`serveur/`)

```
migrations/      001 = schéma fourni par le porteur du projet ; 002 = corrections et sécurité
sql/             préparation de PostgreSQL (rôles, base) à exécuter une fois
src/config.ts    lecture et contrôle de la configuration
src/db.ts        pool de connexions, transaction avec contexte d'entreprise
src/securite/    mots de passe, jetons, TOTP, chiffrement, limitation des tentatives
src/domaine/     règles métier : rôles système, sessions, audit, entreprises, migrations
src/http/        application Fastify, enveloppe de sécurité commune, routes par module
src/cli/         outils d'exploitation : migrer, créer une entreprise, vérifier le journal, sauvegarder, restaurer
test/            tests d'intégration sur un vrai PostgreSQL
```

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
