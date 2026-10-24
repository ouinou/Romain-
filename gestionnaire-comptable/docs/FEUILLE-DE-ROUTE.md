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

## Fait (v0.1, étape 9 : ventes, factures PDF et trésorerie)

- [x] Caisses, banques et mobile money ; caissiers attitrés ; caisse jamais négative (contrôle en base)
- [x] Encaissements, dépenses par catégorie, TVA récupérable, transferts, annulation motivée
- [x] Ventes de marchandises et prestations de services, factures numérotées FAC-AAAA-NNNNN, intangibles
- [x] Facture PDF avec montant en lettres, imprimable directement après l'opération
- [x] Écritures générées en brouillard, validation par lots par la comptabilité
- [x] Taux de TVA paramétrable par l'entreprise (aucun taux codé en dur)
- [x] 65 tests côté serveur, parcours navigateur de 22 étapes, test de la démonstration hors serveur
- [x] Police Lato intégrée à l'application (fonctionne sans Internet)

## Fait (v0.1, étape 10 : profil, factures signées, ventes en direct)

- [x] Profil d'entreprise : régime fiscal, patente, e-mail, logo, couleurs appliquées à l'interface
- [x] Facture PDF avec logo, en-tête complet et code QR signé (Ed25519)
- [x] Écran « Vérifier une facture » (caméra, douchette, saisie)
- [x] Écran « Ventes en direct » pour la direction et les caisses
- [x] Correction : les rafraîchissements automatiques ne prolongent plus la session
- [x] 74 tests serveur, parcours navigateur de 25 étapes
- [x] Setup Windows tout inclus (NSIS) : Node.js, PostgreSQL privé, services, HTTPS par autorité locale, pare-feu, sauvegardes planifiées ; assistant de première installation
- [ ] Setup à éprouver sur un vrai Windows 10/11 et Windows Server. Premier essai réel (0.1.4) : échec à la création de la base (droits réduits d'initdb sur le fichier du mot de passe), corrigé en 0.1.5 ; l'installation complète reste à confirmer sur Windows
- [ ] Signature numérique du setup (certificat de signature de code à acquérir)

## Fait (v0.1, étape 11 : interface de logiciel de bureau)

- [x] Barre de titre, accès rapide avec recherche (Ctrl+F), ruban à onglets et groupes, menu Fichier, menu latéral par module
- [x] Onglets des documents ouverts, panneau de détail (écritures), barre d'état avec connexion, brouillards, somme sélectionnée et zoom
- [x] Palette de la charte : fond blanc, texte noir, bleu nuit pour la structure, orange pour les actions ; grilles bordées, montants négatifs en rouge
- [x] Tableau de bord : synthèse du jour, trésorerie par compte, documents récents (données réelles, selon les droits)
- [x] Raccourcis clavier, navigation au clavier dans les tableaux, impression sans le cadre du logiciel
- [x] Parcours navigateur de 27 étapes, test de la démonstration
- [x] Courbe des ventes et des encaissements sur six mois, brouillards par journal, détail de la sélection ; historique fictif dans l'option de démonstration

## Fait (v0.1, étape 12 : avoirs)

- [x] Avoir total ou partiel sur une facture émise, ligne par ligne ; numérotation AV-AAAA-NNNNN ; plafonds contrôlés par la base
- [x] Écriture inverse en brouillard ; remboursement facultatif limité au trop-perçu (caisse ou banque)
- [x] PDF et aperçu « AVOIR » avec code QR signé, vérifiable comme une facture ; liste des avoirs
- [x] Reste dû, statut « annulée par avoir », tableau de bord net des avoirs
- [x] 9 tests serveur dédiés (dont des écritures directes en base), étape d'avoir dans le parcours navigateur et dans le test de la démonstration
- [ ] Imputation comptable des avoirs (701/706 ou 709) et mentions obligatoires à valider par l'expert-comptable

## À faire ensuite

**Ventes et trésorerie (suite).** Rapprochement bancaire, clôture de caisse journalière avec billetage, devis et bons de livraison, relances clients. Règles à vérifier : voir `TRESORERIE-VENTES.md`.


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
