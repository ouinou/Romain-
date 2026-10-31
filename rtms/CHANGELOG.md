# Journal des versions

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
