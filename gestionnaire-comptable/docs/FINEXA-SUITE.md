# FINEXA Suite : état de FINEXA ERP, éléments réutilisables et plan de FINEXA PHARMA

Document de travail, version 0.3.1 de FINEXA ERP (octobre 2026). Il répond au cahier de spécifications « FINEXA Suite » v1.0 : il décrit ce qui existe réellement, ce qui peut servir aux autres produits, et propose un plan pour le produit suivant. **Rien n'est développé pour FINEXA PHARMA tant que ce plan n'est pas validé.**

---

## 1. FINEXA ERP : ce qui existe vraiment

### 1.1 Fonctions achevées et testées

| Domaine | Ce qui fonctionne | Tests |
|---|---|---|
| Accès | Connexion, double authentification (TOTP), verrouillage après échecs, invitation, réinitialisation, code maître, sessions limitées dans le temps | 19 tests sécurité, 6 tests codes d'accès |
| Utilisateurs et droits | Comptes, 10 rôles système, rôles personnalisés, grille module × action, confirmation des opérations sensibles | inclus ci-dessus |
| Traçabilité | Journal d'audit chaîné (empreintes), copie hors serveur, contrôle d'intégrité | inclus ci-dessus |
| Entreprise | Profil complet (identité, coordonnées, fiscal, banque, documents), logo, cachet, couleurs ; plusieurs entreprises isolées dans une même base | 12 + 7 tests |
| Comptabilité | Plan SYSCOHADA de référence, journaux, écritures (brouillard, validation, extourne), exercices, balance, grand livre, exports CSV | 16 tests |
| Trésorerie | Caisses, banques, mobile money, encaissements, dépenses, transferts, annulations, caisse jamais négative, reçus PDF | 16 tests |
| Ventes | Clients, factures signées (QR vérifiable), règlements, avoirs, ventes en direct, PDF | 9 tests avoirs + complémentaires |
| Tableau de bord | Indicateurs du jour, courbe ventes/encaissements, documents récents | 2 tests |
| Exploitation | Sauvegarde chiffrée et restauration (testées), setup Windows (PostgreSQL privé, services, HTTPS local, pare-feu), mise à jour avec sauvegarde préalable | 12 tests complémentaires, 2 tests installation |

Total : 103 tests serveur automatisés, un parcours complet dans un navigateur (28 étapes), un test de la démonstration, un test du profil avec redémarrage du serveur.

### 1.2 Fonctions partielles

- **États financiers** : balance et grand livre existent ; bilan, compte de résultat et tableau des flux ne sont pas produits.
- **TVA** : un taux paramétrable unique ; pas de taux par produit, pas de déclaration.
- **Référentiel comptable** : le choix « système minimal de trésorerie » est enregistré mais ne change pas les états.
- **Exports** : CSV pour la balance et le grand livre ; pas d'export Excel natif.

### 1.3 Fonctions absentes

Achats et fournisseurs, stocks, paie, devis, bons de commande et de livraison, rapprochement bancaire, clôture de caisse journalière, relances clients, **gestion des licences** (aucun mécanisme d'essai ni d'activation n'existe aujourd'hui).

---

## 2. Architecture de FINEXA ERP (résumé)

Le détail est dans `ARCHITECTURE.md` et `SECURITE.md`. L'essentiel pour la suite :

- **Un serveur, des navigateurs.** Un poste de l'entreprise héberge le serveur (Node.js 22, Fastify, TypeScript) et une base PostgreSQL 16 privée. Les autres postes passent par Edge ou Chrome, sur le réseau local, en HTTPS. Aucun service Internet n'est nécessaire ; aucune donnée n'est envoyée à ITI.
- **La base garantit les règles critiques** : isolation des entreprises par Row-Level Security, tables en ajout seul pour ce qui doit rester tracé (écritures validées, mouvements de trésorerie, factures, audit), numérotations continues, contrôles (caisse jamais négative).
- **Interface** : React 18 + Vite, sans bibliothèque de composants, servie par le même serveur. Cadre « logiciel de bureau » : ruban de commandes, menu latéral, onglets de documents, barre d'état.
- **Installation** : un setup NSIS construit sous Linux (`installateur/construire.sh`) embarque Node, PostgreSQL et WinSW, configure les services Windows, le certificat HTTPS local, le pare-feu et les sauvegardes du soir.
- **Taille** : environ 11 700 lignes de TypeScript, 8 migrations SQL. Dépendances serveur : fastify, pg, zod, argon2, pdfkit, qrcode. Interface : react, qrcode, jsqr.

Cette architecture convient aussi aux autres produits : une pharmacie ou une école a, comme une entreprise, un poste principal et quelques postes clients.

---

## 3. Identité graphique de référence

### 3.1 Police

- **Arial**, déclarée une seule fois : `interface/src/jetons.css`, variable `--police: Arial, "Helvetica Neue", Helvetica, sans-serif`.
- Les PDF utilisent **Helvetica**, police standard des PDF (métriquement équivalente à Arial), sans fichier embarqué.
- **Licence** : Arial est fournie avec Windows ; le logiciel ne la redistribue pas, il l'appelle. Aucune contrainte pour les autres produits tant qu'on ne copie pas le fichier de police. La police Lato des versions 0.1 a été retirée.

### 3.2 Hiérarchie typographique observée

| Usage | Taille | Graisse |
|---|---|---|
| Texte courant (corps de page) | 13 px | 400 |
| Titre de page (`.entete-page h2`) | 18 px | 700 |
| Titre de panneau (`.panneau h3`) | 14 px | 700 |
| En-têtes de tableaux | 12,5 px | 700 |
| Libellés de champs | 12 px | 700 |
| Aides et textes secondaires | 12 px | 400 |
| Boutons | 13 px | 700 |
| Chiffres clés du tableau de bord (`.indicateur .val`) | 22 px (19 px sur petit écran) | 900 |
| Codes et identifiants techniques | police à chasse fixe (`--mono`), 12–15 px | 400–700 |

Les montants utilisent des chiffres tabulaires (`font-variant-numeric: tabular-nums`), alignés à droite.

### 3.3 Couleurs, formes, états

- Palette officielle FINEXA dans `jetons.css` (seul fichier contenant des codes couleur) : marine #062B68 (structure), bleu #0647A9 (actions), cyan #00B8F0 (focus), vert foncé #08752D (validation), vert #65C900 (voyant « connecté » seulement), fond #F4F7FB, texte #263449.
- Rôles nommés : `--accent`, `--succes`, `--danger`, `--avertissement`, `--info`, `--graphique-1/2/3`. Contrastes vérifiés (WCAG AA).
- Rayon 4 px (champs, boutons), 10 px (cartes). Ombres légères. Focus clavier visible. Aucune animation décorative ; l'indicateur de chargement s'arrête si l'utilisateur réduit les animations.
- Côté TypeScript : `jetons.ts` (interface), `domaine/marque.ts` (PDF).

---

## 4. Éléments réutilisables par les autres produits

Classés par facilité de réutilisation. « Tel quel » : copiable sans modification de fond ; « à généraliser » : demande d'en retirer ce qui est propre à l'ERP.

### 4.1 Serveur

| Élément | Fichiers | Réutilisation |
|---|---|---|
| Mots de passe, TOTP, chiffrement, jetons, codes d'accès, limitation des tentatives | `src/securite/*` | Tel quel |
| Sessions, confirmation des opérations sensibles, enveloppe des routes (`proteger`) | `src/domaine/sessions.ts`, `src/http/contexte.ts` | Tel quel |
| Journal d'audit chaîné et son contrôle | `src/domaine/audit.ts`, `controle-journal.ts`, migration 002 | Tel quel |
| Utilisateurs, rôles, permissions, invitations | `routes/utilisateurs.ts`, `routes/roles.ts`, `routes/auth.ts`, `domaine/roles-systeme.ts` | À généraliser : la liste des rôles et des permissions est propre à chaque produit |
| Profil de l'organisation, logo, cachet, en-tête des documents | `domaine/profil-entreprise.ts`, `routes/entreprise.ts` | À généraliser : « entreprise » devient « organisation » (pharmacie, établissement) |
| PDF : en-tête, pied, cachet, montant en lettres | `domaine/ventes/pdf.ts`, `lettres.ts` | À extraire du module ventes |
| Signature Ed25519 et QR vérifiable | `domaine/ventes/signature.ts` | Tel quel ; sert aussi de base aux licences |
| Sauvegarde chiffrée, restauration, migrations, première installation | `domaine/sauvegarde.ts`, `domaine/migrations.ts`, `cli/*`, `routes/installation.ts` | Tel quel |
| Tests d'intégration (base neuve par fichier, agent HTTP) | `test/aide.ts` | Tel quel |

### 4.2 Interface

| Élément | Fichiers | Réutilisation |
|---|---|---|
| Jetons de design, feuille de style | `jetons.css`, `jetons.ts`, `styles.css` | Tel quel |
| Champs, sélections, modales, pagination, toasts, confirmations, codes à usage unique | `composants/ui.tsx`, `Confirmations.tsx` | Tel quel |
| Cadre : ruban, menu, onglets, barre d'état, recherche Ctrl+F, en-tête d'impression | `composants/cadre/*` | À généraliser : la liste des commandes (`commandes.ts`) est propre à chaque produit |
| Écran de connexion, activation, première installation, fiche d'accès | `pages/Accueil.tsx`, `composants/FicheAcces.tsx` | Tel quel, avec le nom du produit |
| Utilisateurs, rôles, journal d'audit, mon compte, profil | `pages/*` | Tel quel ou presque |
| Identité sur les documents, graphique, QR | `composants/IdentiteEntreprise.tsx`, `Graphique.tsx`, `QrCode.tsx` | Tel quel |
| Marque (nom, logo, slogan, éditeur) | `composants/Marque.tsx` | Un fichier par produit |

### 4.3 Installation

Le setup NSIS, le script de configuration (PostgreSQL privé, services, certificats, pare-feu, sauvegardes) et la mise à jour avec sauvegarde préalable sont réutilisables en changeant le nom du produit, ses dossiers, ses services et son port par défaut. Deux produits FINEXA doivent pouvoir cohabiter sur le même poste : dossiers, services, ports et bases distincts.

---

## 5. FINEXA CORE : proposition prudente

Le cahier demande de ne pas compromettre la stabilité de l'ERP. Je propose donc :

1. **Ne pas toucher à l'ERP pour l'instant.** Son code reste tel quel.
2. **Créer FINEXA CORE en extrayant une copie** des éléments du § 4 marqués « tel quel », dans un paquet partagé (dépôt organisé en `core/`, `erp/`, `pharma/`…). FINEXA PHARMA est le premier produit construit dessus.
3. **Faire migrer l'ERP vers CORE plus tard**, dans une intervention distincte, quand CORE aura été éprouvé par PHARMA, avec la batterie de tests actuelle comme filet.

L'inconvénient est une duplication temporaire (sécurité, audit, cadre). Elle est assumée : c'est le prix de la stabilité demandée pour l'ERP.

### Licences (à construire dans CORE, pour tous les produits)

Rien n'existe aujourd'hui. Proposition conforme au § 7 du cahier :

- fichier de licence signé (Ed25519, comme les factures) : produit, client, durée, date de fin, empreinte du poste serveur ;
- clé privée gardée par ITI dans un outil séparé, hors des dépôts des produits ; seule la clé publique est dans les logiciels ;
- essai de 30 jours sans fichier ; activation hors ligne par import du fichier ;
- à expiration : **lecture seule** (consultation, impression, export), aucune suppression ;
- transfert : ITI émet un nouveau fichier pour la nouvelle machine ; une réinstallation sur la même machine réutilise le fichier existant.

---

## 6. Plan de FINEXA PHARMA

### 6.1 Périmètre de la première version (lots dans l'ordre)

| Lot | Contenu | Livrable testable |
|---|---|---|
| 0 | Socle : CORE extrait, squelette PHARMA (connexion, utilisateurs, rôles pharmacie, profil de l'officine, audit, sauvegarde) | Un utilisateur se connecte, l'audit trace, la sauvegarde se restaure |
| 1 | Catalogue des produits | Fiches produits avec recherche, code-barres, statut |
| 2 | Fournisseurs, commandes, réceptions avec lots | Une réception crée des lots (n°, péremption, quantité, prix d'achat) |
| 3 | Stock par lot : mouvements, seuils, ruptures, ajustements motivés, inventaire | Stock exact par lot, historique complet |
| 4 | Ventes et caisse : recherche rapide, FEFO, remises autorisées, paiements, reçu, retours, clôture de caisse | Une journée de caisse complète, reçus imprimés |
| 5 | Rapports et alertes : ventes, stocks, péremptions, achats, mouvements ; export CSV/PDF ; tableau de bord | Rapports filtrables, imprimés, exportés |
| 6 | Traçabilité et rappel de lot | Liste des ventes et clients d'un lot rappelé, blocage du lot |
| plus tard | Ordonnances et délivrance, factures fournisseurs détaillées, transferts entre emplacements | Après validation par un pharmacien |

### 6.2 Données principales

| Table | Contenu | Règle de traçabilité |
|---|---|---|
| `produits` | Nom commercial, DCI, catégorie, forme, dosage, présentation, fabricant, code-barres, prix de vente, taux de TVA, seuil d'alerte, statut | Modification tracée ; pas de suppression d'un produit qui a des mouvements (archivage) |
| `fournisseurs` | Identité, coordonnées, conditions | Archivage seulement |
| `commandes`, `lignes_commande` | Commande fournisseur, quantités et prix prévus | Statut : brouillon, envoyée, reçue partiellement, soldée |
| `receptions`, `lignes_reception` | Ce qui est réellement livré, par lot | Une réception validée ne se modifie pas : correction par retour fournisseur |
| `lots` | N° de lot, péremption, fournisseur, date de réception, prix d'achat, statut (disponible, bloqué, rappelé, périmé) | Pas de suppression |
| `mouvements_stock` | Entrée, sortie vente, retour, ajustement, casse, péremption ; lot, quantité, motif, auteur | Ajout seul ; quantité d'un lot = somme de ses mouvements ; jamais négative (contrôle en base) |
| `ventes`, `lignes_vente` | Ticket : lignes, lots servis, remise, total, mode de paiement | Validée = figée ; annulation par vente inverse motivée |
| `sessions_caisse` | Ouverture (fond), clôture (comptage), écart | Clôture figée, écart tracé |
| `rappels` | Lot concerné, motif, date | Historique des actions menées |

Les montants restent en FCFA entiers, comme dans l'ERP. Aucun taux de TVA n'est écrit dans le code.

### 6.3 Règles de gestion

- **FEFO par défaut** : la vente sert d'abord le lot qui périme le plus tôt. Choisir un autre lot demande un droit et un motif.
- **Lot périmé ou bloqué** : impossible à vendre. Alerte avant péremption, délai réglable (par exemple 90 jours).
- **Stock négatif interdit** pour un lot, contrôlé par la base comme la caisse de l'ERP.
- **Remise** : plafond par rôle, au-delà validation par une personne autorisée.
- **Retour client** : rattaché à la vente d'origine et au lot ; le produit retourne en stock ou en casse selon son état (décision du pharmacien).
- **Clôture de caisse** : comptage par mode de paiement, écart enregistré et justifié.
- **Rappel de lot** : blocage immédiat, liste des ventes concernées.
- **Ordonnances** : aucune règle de prescription ou de délivrance n'est inventée. Le module sera conçu avec un pharmacien.

### 6.4 Écrans

Même cadre que l'ERP (ruban, menu, onglets, barre d'état), menus propres :

- **Accueil** : tableau de bord (ventes du jour, ruptures, péremptions proches, commandes à recevoir), mon compte.
- **Vente** : écran de caisse plein écran, sans menu (recherche, lignes, total, paiement, reçu), retours, clôture.
- **Stock** : produits, lots, mouvements, inventaire, ajustements.
- **Achats** : fournisseurs, commandes, réceptions.
- **Rapports** : ventes, stock, péremptions, achats, mouvements, traçabilité d'un lot.
- **Administration** : utilisateurs, rôles, profil de la pharmacie, journal d'audit, licence.

Rôles proposés : titulaire, pharmacien adjoint, préparateur ou vendeur, caissier, gestionnaire de stock, administrateur.

### 6.5 Tests prévus

- **Unitaires** : allocation FEFO (plusieurs lots, lot partiel, égalité de dates, lot bloqué), calcul des totaux et des remises, arrondis FCFA, alertes de péremption.
- **Base de données** : stock jamais négatif, mouvements non modifiables, vente validée figée, isolation entre officines.
- **Intégration** : réception → stock → vente → retour → rapport ; rappel de lot ; clôture de caisse avec écart ; permissions de chaque rôle.
- **Navigateur** : parcours d'une journée (réception, ventes, clôture, rapport), impression du reçu, écran de caisse au clavier seul.
- **Exploitation** : sauvegarde puis restauration, fonctionnement sans Internet, installation à côté de FINEXA ERP sur le même poste.

### 6.6 Risques et points à vérifier

| Point | Pourquoi | Avec qui |
|---|---|---|
| TVA sur les médicaments | Souvent exonérée, mais à confirmer par catégorie de produit | Expert-comptable |
| Prix réglementés | Certains médicaments ont un prix homologué | Ordre des pharmaciens, autorité compétente |
| Registres obligatoires (stupéfiants, ordonnancier) | Contenu exigé à connaître avant le module ordonnances | Pharmacien titulaire |
| Vente à l'unité (déconditionnement) | Change le modèle de stock (boîte, plaquette, unité) | Pharmacien titulaire |
| Lecteurs de codes-barres et imprimantes de tickets | Matériel à tester (douchette en mode clavier, imprimante 80 mm) | Une officine pilote |
| Reprise d'un catalogue existant | Import CSV à prévoir si l'officine a déjà une liste | Officine pilote |

---

## 7. Décisions attendues avant de commencer

1. **Organisation du code** : dépôt unique (`core/`, `erp/`, `pharma/`…) avec CORE extrait par copie, l'ERP restant inchangé (recommandé), ou un dépôt par produit.
2. **Licence** : la « machine autorisée » est-elle le poste serveur, avec un nombre de postes clients libre ou limité ?
3. **Vente à l'unité** en pharmacie : dès la première version, ou plus tard ?
4. **Officine pilote** : nom et contact d'un pharmacien pour valider les règles et tester sur place.
5. **Périmètre de la première version** : les lots 0 à 5 (recommandé), ou un périmètre plus réduit pour une démonstration plus rapide.
