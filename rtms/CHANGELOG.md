# Journal des versions

## 2.4.2 — 10/11/2026
Correction de l’erreur « listen EADDRINUSE: address already in use 0.0.0.0:8443 » au démarrage du poste principal.
- Le serveur local s’arrête avec l’application, même fermée de force (plus de serveur resté ouvert en arrière-plan).
- Au démarrage, un ancien serveur RTMS du même poste est arrêté proprement (route locale protégée par un jeton, réservée au poste lui-même), et une base PostgreSQL restée ouverte est arrêtée par `pg_ctl`.
- Si le port 8443 est pris par un autre logiciel, le poste principal prend le suivant (jusqu’à 8452) ; les postes de travail le retrouvent par la découverte. Règle du pare-feu élargie à 8443-8452.
- Vérifié : second démarrage, serveur tué avec sa base restée ouverte, port pris par un autre programme, application tuée brutalement ; API 112/112 ; réseau local à deux postes.

## 2.4.1 — 10/11/2026
- Édition client **sans mode démonstration** : l'écran de démarrage ne propose plus que « poste principal » et « poste de travail » ; un ancien réglage « démo » revient à l'écran de choix. La démonstration reste activable pour les présentations et les tests (variable d'environnement `RTMS_DEMO=1`).
- Installateur allégé (134 Mo) et publié automatiquement dans une release GitHub, avec la version portable.

## 2.4.0 — 06/11/2026

### Aperçu avant impression
- Toute impression et tout export PDF passent d’abord par un **aperçu A4 à l’écran** (zoom, nombre de pages) : Imprimer, Enregistrer en PDF ou Fermer.
- **Pendant la saisie** (avant enregistrement), « Aperçu avant impression » (Ctrl+Maj+P, ou Ctrl+P / Imprimer) montre la facture telle qu’elle sortira : totaux et montant en lettres calculés, numéro « attribué à l’enregistrement ». « Fermer et corriger » garde la saisie ; « Enregistrer, puis voir le document final » enregistre et réaffiche l’aperçu avec le vrai numéro.
- L’impression du tableau de bord produit maintenant une synthèse (auparavant une page vide).

### Tableau de bord
- **Accès rapide en tête**, avant les compteurs : Nouvelle facture, mission, dossier de transit, importation, exportation, mouvement, client, fournisseur, article, véhicule, employé, intervention, document — selon les droits du profil.

### Licence : 14 jours d’essai, puis activation obligatoire
- Poste principal : essai gratuit de 14 jours à partir du premier démarrage. Ensuite, le serveur refuse toutes les opérations (réponse 402) sauf la connexion, l’activation de la licence, l’installation et les sauvegardes ; l’interface affiche l’écran « Licence requise » avec le **code d’activation** du poste.
- Reculer l’horloge du PC ne rallonge pas l’essai (date la plus récente mémorisée, **migration 0006** : colonne `installation.clock_high_water`).
- Licence hors ligne signée Ed25519, liée au poste ; motifs de refus en clair (autre ordinateur, expirée…).
- Outil éditeur `tools/generateur-licences.html` (Edge ou Chrome, sans Internet) : signe la licence avec la clé privée de l’éditeur, jamais livrée ni versionnée. Seule la clé publique est dans l’application (`apps/desktop/src/license-public-key.pem`).
- Décompte « Version d’essai : N jour(s) restant(s) » dans la barre d’état ; alerte à 3 jours de la fin.

### Icône de l’application Windows
- Le logo officiel du logiciel (FINEXA Transport Management System) devient l’icône de l’application : exécutable, raccourcis Bureau et menu Démarrer, barre des tâches, icône près de l’horloge, installateur. L’intérieur du logiciel (nom RAHA TRANSPORT MANAGEMENT SYSTEM, logo Raha, factures et documents) est inchangé. Source : `apps/desktop/build/finexa-logo-source.png`.

### Tests
- API 112/112 (dont essai, blocage, horloge reculée, activation, licence d’un autre poste). Interface 20/20. Bureau : démo + aperçu + PDF ; réseau local complet.

## 2.3.0 — 02/11/2026

### Fonctionnement 100 % hors ligne en réseau local
- Rôle « poste principal » : un PC de bureau ordinaire héberge les données (PostgreSQL intégré, accessible
  uniquement depuis ce PC), sert l'application aux autres postes en HTTPS (certificat généré sur place),
  sauvegarde chaque jour. Icône près de l'horloge : état, sauvegarde, restauration, pare-feu, démarrage
  avec Windows.
- Postes de travail : recherche automatique du poste principal sur le réseau, vérification de l'empreinte
  du certificat (retenue ensuite ; connexion bloquée si elle change), retrouvé même si la box change son
  adresse. Connexion directe pour les adresses locales (pas de proxy).
- Premier démarrage : création de la société et de l'administrateur, possible uniquement depuis le poste
  principal lui-même et seulement sur une base vide.
- Sauvegarde/restauration logique (.rtmsbak + empreinte SHA-256), l'ancienne base est conservée.
- Licence hors ligne (jeton signé, sans vérification en ligne).
- Doc : `docs/11-RESEAU-LOCAL-HORS-LIGNE.md`.

### Factures
- Numéro (F-AAAA-NNNN) et date attribués automatiquement par le serveur. **Migration 0005** : table
  `document_counters` (RLS), fonction `next_document_number`. Sans doublon entre postes, numéros de
  factures annulées jamais réutilisés, numéros saisis à la main respectés.
- Export PDF d'une ou plusieurs factures vers le Bureau, Documents, une clé USB détectée ou un autre dossier.

### Utilisateurs
- « Personnes connectées » (barre d'état) : nom, profil, depuis quand ; poste et adresse pour les profils
  qui gèrent les utilisateurs. Route `GET /api/presence`.
- Les menus vides pour un profil sont masqués.
- Démonstration : un compte par profil (Administrateur, Direction, Comptable, Transport, Commercial,
  Agent), avec les mêmes restrictions que le serveur.

### Tests
- API : 110/110 (dont numérotation simultanée et présence). Interface : 20/20.
- Bureau : parcours démo + export PDF ; parcours hors ligne poste principal → poste de travail →
  empreinte falsifiée refusée.

## 2.2.0 (bureau) — 31/10/2026
- Application Windows (Electron) : installateur français sans droits administrateur, version portable, choix du serveur au premier lancement, écran « serveur injoignable », export PDF natif, navigation et permissions verrouillées.
- Mode démonstration (serveur simulé dans le navigateur, données fictives) : intégré à l'application Windows et publié en ligne.
- Depuis une fiche facture, « Exporter PDF » produit la facture au modèle RAHA.

## 2.2.0 — 31/10/2026

### Éléments fournis par RAHA TRANSPORT pris en compte
- **Logo officiel** : bandeau titre, écran de connexion, icône de l'application, documents imprimés, filigrane.
- **Modèle de facture** reproduit au format A4 : logo et ligne des activités, date et n°, nom du chauffeur, contacts, n° de camion, montant du transport, bloc FACTURE, tableau N° / DÉSIGNATION / QTE / P. UNITAIRE / P. TOTAL, TOTAL, mention sur les marchandises, montant arrêté en lettres, avance et reste, trois signatures, filigrane, bandeau ondulé vert/jaune/orange avec RCCM, contribuable, téléphones et adresse. Vérifié par génération d'un PDF A4 d'une page et comparaison visuelle avec le modèle.
- **Maquette d'interface** : bandeau titre vert avec logo, barre latérale avec libellés (repliable), barre de commandes avec « Plus d'actions », tuiles de comptage par statut, filtres Période et Statut, pagination numérotée, panneau droit à onglets Propriétés / Historique / Documents, barre d'état (version, base, utilisateur, connexion, date et heure).

### Données (sans migration de base : champs JSON validés par le serveur)
- Factures : lignes multiples, chauffeur, contacts, n° de camion, montant du transport, avance ; reste et montant en lettres calculés par le serveur. Les factures à une ligne restent valides.
- Missions : champ « Montant (FCFA) ».
- Paramètres : RCCM et n° de contribuable.

### Ajouté
- Lettre de transport et bon de chargement imprimables (modèles RTMS, à valider).
- Route `GET /api/records/:module/stats` (compteurs par statut).

## 2.1.0 — 31/10/2026

### Interface (identité visuelle RAHA inchangée)
- Espace de travail de type logiciel de bureau : barre de menus (13 menus), barre de commandes contextuelle, barre d'outils verticale (17 modules), onglets multiples, panneaux droits, barre d'état.
- Onglets : saisie conservée entre modules, réorganisation, historique de navigation, restauration après rechargement.
- Panneaux : propriétés, historique champ par champ, documents associés, actions rapides, notifications, activités récentes ; réduction, masquage, réorganisation, redimensionnement, panneaux flottants ; espaces de travail enregistrables.
- Tableaux : tri, filtres multicritères, sélection multiple, actions groupées, colonnes au choix, totaux de page, menu contextuel.
- Formulaires : sections, champs obligatoires signalés, recherche dans les référentiels, calculs automatiques, confirmation avant validation, gestion des conflits de modification.
- Recherche globale groupée par catégorie (Ctrl+K), notifications métier (assurances, documents, factures échues, stocks, entretiens), raccourcis clavier.
- Commandes métier : affectation véhicule/chauffeur, ordre de mission, impression de facture (provisoire), export PDF par l'impression du système.
- Administration complète dans l'interface : profils des utilisateurs, déverrouillage, réinitialisation MFA, désactivation, matrice des permissions.

### API (aucune route existante modifiée)
- Tri et filtres sur les listes ; historique d'un enregistrement ; recherche globale ; notifications ; activité récente.
- Migration `0004_ui_helpers` (fonctions de conversion tolérantes, aucune donnée modifiée).

### Corrigé pendant les tests
- Un formulaire neuf n'envoyait pas la valeur par défaut d'une liste déroulante (statut).
- Double-clic perdu quand la sélection décalait le tableau ; barre d'actions groupées désormais flottante.
- Survol « fantôme » qui changeait le menu ouvert au clavier ; Échap ne fermait pas un menu ouvert à la souris.
- Brouillons perdus lors d'un rechargement rapide ; glisser-déposer interrompu (capture du pointeur).

## 2.0.0 — 31/10/2026

### Ajouté
- API REST sécurisée (Node.js 22, Fastify 5, TypeScript, Prisma, PostgreSQL 16, Redis 7).
- Comptes utilisateurs, Argon2id, MFA TOTP avec codes de secours, sessions serveur, CSRF, limitation de débit, verrouillage de compte.
- 9 profils (CdC §8) avec permissions par module et par action, modifiables.
- Row-Level Security PostgreSQL par société ; rôles PostgreSQL à moindre privilège.
- Journal d'audit chaîné SHA-256, en ajout seul, vérifiable depuis l'interface.
- Chiffrement AES-256-GCM des données sensibles (secret MFA, N° contribuable, permis).
- Système de licences Ed25519 (serveur éditeur + vérification côté installation).
- Migration des données du prototype depuis le navigateur.
- Métriques Prometheus, Sentry, OpenTelemetry ; configurations Grafana, Loki, Wazuh.
- Sauvegardes Restic avec test de restauration automatique ; configuration pgBackRest.
- Docker, Compose de production, Caddy, Cloudflare (Terraform), CI/CD GitHub Actions.
- 70 tests Vitest, 10 tests Playwright, scénario k6.

### Corrigé (défauts du prototype)
- « Supprimer » après une recherche supprimait un autre enregistrement.
- Colonnes affichant la mauvaise valeur (ex. quantité dans « Total TTC »).
- Total TTC jamais calculé ; taxe ignorée.
- Recettes/dépenses mal classées selon l'orthographe saisie.
- Bouton « Enregistrer les paramètres » sans effet.
- Export CSV vulnérable à l'injection de formules.

### Modifié
- « Supprimer » devient une annulation tracée (exigence CdC §7) ; rien n'est effacé physiquement.

### Migrations
- `0001_init`, `0002_security`, `0003_audit_chain_order` (correctif de l'ordre de chaînage de l'audit sous concurrence).
