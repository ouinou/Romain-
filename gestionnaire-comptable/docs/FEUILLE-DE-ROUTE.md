# Feuille de route

## Fait (v0.1, socle)

Couvre les sections 1 à 6 du cahier des charges, côté serveur.

- [x] Architecture serveur + PostgreSQL, fonctionnement hors ligne sur réseau local
- [x] Multi-entreprises avec isolation par Row-Level Security
- [x] Authentification : invitations, connexion, déconnexion, verrouillage, limitation par IP, expiration et révocation des sessions, accès temporaires, réinitialisation hors ligne
- [x] Double authentification TOTP, obligatoire pour les rôles sensibles
- [x] Permissions granulaires 14 modules × 10 actions, 10 rôles système, rôles personnalisés
- [x] Garde-fous : pas d'auto-attribution, dernier administrateur protégé
- [x] Journal d'audit en ajout seul, chaîné, vérifiable, avec ancrages externes
- [x] Notifications (sécurité)
- [x] Sauvegarde chiffrée, restauration contrôlée
- [x] Code maître de l'entreprise (récupération d'accès contrôlée), confirmation avant les opérations sensibles, désactivation des comptes inutilisés
- [x] Copie du journal sur un support distinct
- [x] 30 tests automatisés sur PostgreSQL réel : authentification, permissions, isolation, journal, secrets absents des journaux, sauvegarde et restauration
- [x] Documentation : architecture, sécurité, API, installation Windows

## Fait (v0.1, étape 7 : interface, en attente de validation)

- [x] Interface web reliée au serveur : connexion, invitation, réinitialisation, code maître, activation MFA par QR code
- [x] Tableau de bord selon les droits, utilisateurs, rôles (grille module × action), journal (filtres, intégrité, export), entreprise, mon compte
- [x] Confirmation par mot de passe intégrée, motifs obligatoires, codes secrets affichés une seule fois
- [x] Parcours de bout en bout automatisé dans un vrai navigateur (13 étapes, 0 erreur, 0 violation CSP)
- [x] Version de démonstration en un seul fichier, avec serveur simulé

## Fait (v0.1, étape 8 : module Comptabilité générale)

- [x] Plan de comptes SYSCOHADA (liste restreinte à vérifier), import du plan officiel en CSV
- [x] Journaux, exercices, clôture définitive
- [x] Saisie en brouillard, validation équilibrée, numérotation continue, séparation saisie / validation
- [x] Écritures validées intangibles, correction par extourne motivée (garanties par PostgreSQL)
- [x] Comptes protégés selon les permissions (banques, personnel, résultat)
- [x] Grand livre, balance générale, exports CSV tracés
- [x] 16 tests d'intégration comptables (47 au total côté serveur) et parcours complet dans le navigateur
- [x] Palette bleu nuit et orange vif

## À faire ensuite

**Comptabilité (suite).** À-nouveaux, affectation du résultat, pièces justificatives, périodes mensuelles, comptes de tiers et lettrage, TVA paramétrable, états financiers SYSCOHADA. Les règles sont à valider par un expert-comptable (voir `COMPTABILITE.md`, section 7).


**Interface (après validation du design).**
- textes regroupés dans un fichier de langue, pour ajouter d'autres langues plus tard ;
- jeu d'icônes dessiné, à la place des symboles provisoires du menu.

**Modules métier.** Ils attendent la suite du cahier des charges, coupée à la section 6 :
- comptabilité générale SYSCOHADA révisé (plan de comptes, journaux, écritures équilibrées, lettrage, clôtures, contre-passation au lieu de suppression) ;
- trésorerie et banques, caisse, ventes, achats, stocks, RH et paie ;
- états financiers OHADA (bilan, compte de résultat, TAFIRE / tableau des flux) et déclarations fiscales camerounaises.

**Exploitation.**
- installateur Windows (service, certificat, tâches planifiées) ;
- restauration par entreprise ;
- chaînage du journal système ;
- règles de détection supplémentaires (horaires, volumes d'export).
