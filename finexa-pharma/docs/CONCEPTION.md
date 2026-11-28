# FINEXA PHARMA : constat technique et plan de développement

Version 1, octobre 2026. Document à valider avant tout développement.
Référence : FINEXA ERP 0.3.1 (dossier `gestionnaire-comptable/`), qui n'est pas modifié.
Complète `gestionnaire-comptable/docs/FINEXA-SUITE.md` (inventaire détaillé de l'ERP et composants réutilisables).

---

# Partie A. Constat technique sur FINEXA ERP

## A.1 Technologie et structure

| Couche | Choix dans l'ERP |
|---|---|
| Serveur | Node.js 22, TypeScript, Fastify 5, requêtes SQL directes (pg), validation zod, Argon2id, pdfkit, qrcode |
| Base | PostgreSQL 16 : sécurité par ligne (une organisation ne voit que ses données), tables en ajout seul, numérotations continues, contrôles critiques en base |
| Interface | React 18 + Vite, sans bibliothèque de composants, servie par le serveur ; une version « démonstration » en un seul fichier HTML |
| Installation | Setup NSIS construit sous Linux : Node, PostgreSQL et WinSW embarqués, services Windows, certificat HTTPS local, pare-feu, sauvegarde du soir, mise à jour avec sauvegarde préalable |
| Tests | 103 tests serveur sur une vraie base, parcours navigateur (Playwright) |

```
gestionnaire-comptable/
  serveur/      migrations SQL, src/securite, src/domaine (règles), src/http (routes), src/cli (outils), test/
  interface/    src/composants (ui, cadre, icônes), src/pages, src/demo (serveur simulé), tests/
  installateur/ setup NSIS, configuration Windows, certificats
  docs/         architecture, sécurité, API, guides
```

## A.2 Identité graphique relevée dans le code

**Police** : Arial (`interface/src/jetons.css`, variable `--police`), Helvetica dans les PDF. Fournie par Windows, non redistribuée : rien à acquérir. Chasse fixe pour les codes : `--mono` (Cascadia Mono, Consolas).

**Tailles et graisses**

| Élément | Taille | Graisse |
|---|---|---|
| Texte courant | 13 px | normale |
| Titre de page | 18 px | gras (700) |
| Titre de panneau | 14 px | 700 |
| En-tête de tableau | 12,5 px | 700 |
| Libellé de champ | 12 px | 700 |
| Aide, texte secondaire | 12 px | normale |
| Bouton | 13 px | 700 |
| Chiffre clé du tableau de bord | 22 px (19 px sur petit écran) | 900 |

**Couleurs** (seul fichier qui en contient : `jetons.css`) : marine #062B68 pour la structure (titre, menu, barre d'état), bleu #0647A9 pour les actions, cyan #00B8F0 pour le focus clavier, vert foncé #08752D pour les validations, rouge pour les erreurs, orange foncé pour les avertissements, fond #F4F7FB, texte #263449. Chaque couleur a un rôle nommé (`--accent`, `--succes`, `--danger`…). Contrastes vérifiés.

**Disposition des menus** (cadre de type logiciel de bureau)
- barre de titre marine (38 px) : logo, nom du logiciel, organisation, notifications, utilisateur ;
- barre d'accès rapide : accueil, retour, actualiser, imprimer, recherche (Ctrl+F) ;
- ruban à onglets, un par module, avec les commandes en gros boutons et leurs raccourcis (Alt+N…) ;
- menu latéral marine, groupes repliables par module, filtré selon les droits ;
- onglets de documents ouverts (10 au plus) ;
- barre d'état (28 px) : organisation, exercice, utilisateur, connexion au serveur, alertes, date, zoom.

**Boutons et formulaires** : boutons de 30 px de haut, rayon 4 px, gras ; bouton principal bleu, validation vert foncé, danger rouge. Champs sur deux colonnes (écart 10 × 14 px), libellé au-dessus, astérisque pour l'obligatoire, aide en dessous, erreur en rouge sur le champ concerné. Fenêtres modales pour les saisies courtes ; confirmation avec motif et ressaisie du mot de passe pour les opérations sensibles.

**Tableaux** : en-tête gris à 12,5 px gras, cellules 6 × 8 px, séparateurs fins, montants à droite en chiffres tabulaires, en-tête et totaux fixes au défilement, ligne active au clavier (flèches, Entrée ouvre), panneau de détail à droite, pagination, export CSV.

**Icônes** : jeu dessiné pour le logiciel (`assets/icons/Icone.tsx`, environ 50 icônes), grille 24 × 24, trait de 1,6, deux tons (tracé dans la couleur du texte, repère dans la couleur d'accent). Aucune bibliothèque externe.

**Marges et espacements** : zone de travail 12 × 16 px, panneaux 10 × 12 px, rayon 10 px, écart de 12 px entre blocs.

**Tableau de bord** : une rangée de cartes indicateurs (liseré coloré à gauche, chiffre en gros, libellé, sous-titre), puis deux colonnes : graphique simple à gauche, tableaux courts à droite (« à valider », « documents récents »). Pas de graphique décoratif.

## A.3 Mécanismes réutilisables

Repris tels quels : sécurité (mots de passe, double authentification, sessions, limitation des tentatives, codes d'accès lisibles), journal d'audit chaîné, utilisateurs et rôles, profil de l'organisation avec logo et cachet, en-tête et pied des PDF, signature Ed25519, sauvegarde chiffrée et restauration, migrations, première installation, fiche d'accès pour les autres postes, cadre de l'interface, composants de formulaire, icônes, setup Windows. Détail fichier par fichier dans `FINEXA-SUITE.md`, § 4.

À construire (absent de l'ERP) : licences, achats, stocks, lots, caisse avec clôture.

---

# Partie B. Conception de FINEXA PHARMA

## B.1 Architecture

**Même modèle que l'ERP**, parce qu'il a fait ses preuves et qu'il répond aux deux cas demandés :

- **un seul ordinateur** : le serveur et l'écran sont sur le même poste ; FINEXA PHARMA s'ouvre dans sa propre fenêtre (Edge en mode application), comme l'ERP ;
- **plusieurs postes** : la caisse et le bureau du pharmacien ouvrent l'adresse du serveur dans le navigateur ; rien à installer sur eux. Le passage d'un mode à l'autre ne demande aucune migration.

**Indépendance vis-à-vis de l'ERP** : dossier d'installation, services Windows, base PostgreSQL, port (8444 par défaut, l'ERP utilisant 8443), licence et mises à jour distincts. Les deux logiciels peuvent cohabiter sur un même poste sans se voir.

**Organisation du code**, à côté de l'ERP, sans le modifier :

```
finexa-core/      copie extraite des éléments communs de l'ERP (sécurité, audit, utilisateurs, PDF, cadre, setup)
finexa-pharma/
  serveur/        migrations, domaine (catalogue, lots, stock, achats, ventes, caisse), routes, tests
  interface/      pages propres à la pharmacie, menus, marque FINEXA PHARMA
  installateur/   setup « FINEXA PHARMA »
  docs/
gestionnaire-comptable/   FINEXA ERP, inchangé
```

**Dépendances** : les mêmes que l'ERP, aucune nouvelle. Les lecteurs de codes-barres (douchettes USB) fonctionnent comme un clavier : pas de pilote ni de bibliothèque. Les exports sont en CSV (ouvrables dans Excel) et en PDF ; un export .xlsx natif pourra être ajouté plus tard.

**Une officine par installation**, mais la base garde la séparation par organisation de l'ERP : un groupement de pharmacies pourra être servi plus tard sans refonte.

## B.2 Les 16 modules et leur ordre

| # | Module | Lot |
|---|---|---|
| 14 | Paramètres de la pharmacie | 0 |
| 12 | Utilisateurs et permissions | 0 |
| 16 | Sauvegarde et restauration | 0 |
| 2, 3 | Catalogue, catégories et familles | 1 |
| 4 | Lots et péremptions | 2 |
| 5 | Stocks et mouvements | 2 |
| 6, 7 | Fournisseurs, achats et approvisionnements | 3 |
| 8 | Ventes et caisse | 4 |
| 9 | Clients (facultatif) | 4 |
| 10 | Retours et annulations | 4 |
| 11 | Alertes et rappels de lots | 5 |
| 1 | Tableau de bord | 6 |
| 13 | Rapports et statistiques | 6 |
| 15 | Impression et export | à chaque lot |
| — | Licence | 7 |
| — | Setup Windows et documentation | 8 |

Les lots 0 à 2 forment le **socle** demandé au § 7 du cahier de lancement.

## B.3 Modèle de données

Montants en FCFA entiers. Quantités en entiers, dans l'unité de vente du produit (la boîte en première version ; voir décision n° 3).

**Paramétrage**
- `organisations` (reprise de l'ERP) : identité de l'officine, n° d'autorisation d'ouverture, pharmacien titulaire et son n° d'inscription à l'Ordre (champs libres, non contrôlés), logo, cachet, paramètres.
- `parametres_pharmacie` : délai d'alerte de péremption (jours), méthode de sortie (FEFO), remise maximale par rôle, taux de TVA disponibles (saisis, jamais écrits dans le code), mentions du reçu.
- `categories` (arborescence à deux niveaux : catégorie › famille), `formes` (comprimé, sirop…), `emplacements` (rayon, réserve, réfrigérateur).

**Catalogue**
- `produits` : nom commercial, DCI, catégorie, famille, forme, dosage, présentation, fabricant, fournisseur habituel, codes (code-barres EAN, code interne), prix d'achat de référence, prix de vente, taux de TVA, seuil d'alerte, conditions de conservation, statut (actif, suspendu, archivé), champs libres réglementaires (liste, catégorie de délivrance) **renseignés par la pharmacie, sans règle inventée**.
- Un produit qui a des mouvements ne se supprime pas : il s'archive. Les changements de prix sont tracés (`historique_prix`).

**Lots et stock**
- `lots` : produit, n° de lot, date de péremption, fournisseur, date de réception, prix d'achat, emplacement, statut (disponible, bloqué, rappelé). Un même n° de lot ne peut exister qu'une fois par produit.
- `mouvements_stock` (ajout seul) : date, lot, nature (entrée initiale, réception, vente, retour client, retour fournisseur, ajustement, casse, péremption, transfert), quantité signée, pièce liée, motif, auteur. Numérotation continue `MVT-AAAA-NNNNN`.
- Quantité d'un lot = somme de ses mouvements. **Un déclencheur refuse tout mouvement qui rendrait un lot négatif**, sous verrou (deux caisses ne peuvent pas vendre la même dernière boîte).
- `inventaires`, `lignes_inventaire` : comptage, écart, validation qui génère les ajustements.

**Achats** (lot 3) : `fournisseurs`, `commandes`, `lignes_commande`, `receptions`, `lignes_reception` (produit, lot, péremption, quantité, prix), `factures_fournisseurs`.

**Ventes et caisse** (lot 4) : `sessions_caisse` (ouverture, fond, clôture, comptage par mode de paiement, écart), `ventes` (n° `VTE-AAAA-NNNNN`, date, caissier, client facultatif, total, remise, statut), `lignes_vente` (produit, lot servi, quantité, prix, remise), `paiements`, `retours` liés à la vente d'origine, `clients` (facultatif).

**Alertes et rappels** (lot 5) : `rappels` (lot, motif, référence de l'avis, date, actions), alertes calculées (pas de table).

**Traçabilité** : journal d'audit de l'ERP pour les opérations sensibles ; les ventes, réceptions, mouvements et clôtures validés ne se modifient ni ne se suppriment.

## B.4 Règles de gestion

1. **Sortie FEFO** : une vente prend d'abord le lot disponible qui périme le plus tôt, puis le suivant si la quantité ne suffit pas. Servir un autre lot demande le droit `stock.choix_lot` et un motif.
2. **Lot périmé, bloqué ou rappelé** : invendable. Le contrôle est fait par le serveur, pas seulement par l'écran.
3. **Alerte de péremption** : lots dont la date tombe dans le délai réglé (90 jours proposés).
4. **Rupture** : stock vendable (lots disponibles non périmés) à zéro ; **alerte** : sous le seuil du produit.
5. **Ajustement** : uniquement avec le droit `stock.ajustement`, un motif choisi dans une liste (casse, erreur de saisie, vol constaté, péremption, autre avec texte) et une confirmation par mot de passe.
6. **Entrée initiale** : pour démarrer avant que le module achats existe, ou à la mise en service, saisie du stock d'ouverture par lot (n°, péremption, quantité, prix d'achat), tracée comme telle.
7. **Vente** : prix du catalogue ; remise plafonnée selon le rôle ; total arrondi au franc ; validation = mouvements de stock, paiement et reçu, en une seule opération qui réussit entièrement ou pas du tout.
8. **Annulation** : uniquement le jour même, par une personne autorisée, avec motif ; elle crée une opération inverse (la vente d'origine reste visible).
9. **Retour client** : rattaché à la vente et au lot ; remise en stock ou mise en casse selon la décision du pharmacien.
10. **Clôture de caisse** : comptage par mode de paiement, écart calculé, justification obligatoire au-delà d'un seuil réglable ; une session clôturée est figée.
11. **Rappel de lot** : blocage immédiat, liste des ventes (et clients connus) concernées, actions enregistrées.
12. **Ordonnances et médicaments réglementés** : aucune règle de délivrance n'est codée tant qu'elle n'a pas été fournie et validée par un pharmacien. En attendant, la fiche produit porte une catégorie de délivrance informative, et le module ordonnances reste hors périmètre.

## B.5 Écrans

Même cadre que l'ERP. Modules du ruban et du menu :

| Module | Écrans |
|---|---|
| Accueil | Tableau de bord, mon compte |
| Vente | Caisse (plein écran, au clavier), ventes du jour, retours, clôture de caisse, clients |
| Stock | Produits, fiche produit, lots, mouvements, inventaire, entrée initiale, ajustements |
| Achats | Fournisseurs, commandes, réceptions, factures fournisseurs |
| Alertes | Ruptures, péremptions proches, lots bloqués et rappels |
| Rapports | Ventes, stock valorisé, péremptions, achats, mouvements, traçabilité d'un lot |
| Administration | Utilisateurs, rôles, profil de la pharmacie, paramètres, catégories, journal d'audit, sauvegardes, licence |

**Écran de caisse** : un champ de recherche toujours actif (nom, DCI ou code-barres), la liste des lignes, le total en gros, le lot servi affiché sur chaque ligne, F2 pour encaisser, F4 pour annuler une ligne, impression du reçu (ticket 80 mm ou A5). Aucune animation.

**Tableau de bord** : cartes « ventes du jour », « ruptures », « péremptions sous 90 jours », « commandes à recevoir » ; puis la courbe des ventes sur 30 jours et la liste des alertes. Chaque carte ouvre la liste correspondante.

## B.6 Rôles proposés

| Rôle | Peut |
|---|---|
| Pharmacien titulaire | Tout, y compris paramètres, ajustements, annulations, rappels |
| Pharmacien adjoint | Comme le titulaire, sauf utilisateurs et paramètres |
| Préparateur / vendeur | Vendre, consulter le stock et les lots |
| Caissier | Encaisser, clôturer sa caisse |
| Gestionnaire de stock | Réceptions, inventaires, ajustements avec motif |
| Administrateur | Utilisateurs, rôles, sauvegardes (sans accès aux ventes, sauf rôle cumulé) |

Les droits restent modifiables par rôle personnalisé, comme dans l'ERP.

## B.7 Tests

| Lot | Tests |
|---|---|
| 0 | Connexion, rôles pharmacie, profil de l'officine sur les documents, audit, sauvegarde puis restauration |
| 1 | Fiche produit : champs obligatoires, code-barres unique, archivage au lieu de suppression, historique des prix, recherche par nom, DCI ou code |
| 2 | Lot unique par produit ; stock = somme des mouvements ; refus du stock négatif (y compris deux ventes simultanées) ; mouvements non modifiables ; ajustement sans droit refusé ; inventaire qui génère les bons écarts |
| 3 | Réception partielle, lots créés, écart commande/livraison, retour fournisseur |
| 4 | FEFO (plusieurs lots, lot partiel, dates égales, lot bloqué ou périmé ignoré) ; remise au-delà du plafond refusée ; annulation et retour ; clôture avec écart ; reçu imprimé |
| 5 | Alertes aux bonnes dates (veille, jour même) ; rappel qui bloque et liste les ventes |
| 6 | Chiffres des rapports recalculés à la main ; exports CSV et PDF |
| 7 | Licence valide, expirée (lecture seule, export possible), falsifiée (refusée), essai de 30 jours |
| 8 | Installation à côté de l'ERP, mise à jour, désinstallation sans perte de données ; fonctionnement sans Internet |

Chaque lot ajoute un parcours dans le navigateur. Aucun lot n'est déclaré terminé sans ses tests réellement exécutés.

## B.8 Plan de développement

| Lot | Contenu | Terminé quand |
|---|---|---|
| 0 | Extraction de `finexa-core` ; squelette PHARMA (marque, menus, rôles) ; paramètres et profil de la pharmacie ; utilisateurs ; sauvegarde | Un titulaire crée ses utilisateurs, se connecte depuis un second poste, sauvegarde puis restaure |
| 1 | Catégories, familles, formes, emplacements ; catalogue | 200 produits saisis ou importés (CSV), recherche instantanée |
| 2 | Lots, entrée initiale, mouvements, inventaire, ajustements, historique | Stock exact par lot, historique complet, impossible de passer sous zéro |
| — | **Validation du socle avec vous** | Démonstration et livraison d'un setup d'essai |
| 3 | Fournisseurs, commandes, réceptions | Une commande reçue en deux livraisons crée les bons lots |
| 4 | Caisse, ventes, clients, retours, annulations, clôture | Une journée de caisse complète, reçus imprimés |
| 5 | Alertes et rappels | Rappel d'un lot traité de bout en bout |
| 6 | Tableau de bord, rapports, exports | Rapports vérifiés à la main |
| 7 | Licence (mécanisme commun à la gamme, outil d'émission séparé pour ITI) | Essai, activation hors ligne, expiration en lecture seule |
| 8 | Setup Windows, guide d'installation et d'utilisation | Installé et testé sur Windows 10 et 11 |

## B.9 Points à vérifier avant ou pendant le développement

| Point | Lot concerné | Avec qui |
|---|---|---|
| TVA applicable aux médicaments et parapharmacie | 1, 4 | Expert-comptable |
| Prix homologués de certains médicaments | 1, 4 | Ordre des pharmaciens ou autorité compétente |
| Registres obligatoires (stupéfiants, ordonnancier) | hors périmètre initial | Pharmacien titulaire |
| Mentions obligatoires du reçu | 4 | Expert-comptable, pharmacien |
| Délai d'alerte de péremption usuel | 5 | Pharmacien pilote |
| Douchette et imprimante de tickets | 4 | Officine pilote |

---

# Décisions à valider

Les choix par défaut ci-dessous sont ceux que j'appliquerai si vous les validez tels quels.

1. **Organisation du code** : dossiers `finexa-core/` et `finexa-pharma/` dans le même dépôt, ERP inchangé. *(par défaut : oui)*
2. **Licence** : liée au poste serveur ; postes clients du réseau illimités. *(par défaut : oui, à confirmer commercialement)*
3. **Vente à l'unité (déconditionnement)** : pas dans la première version ; la boîte est l'unité de vente. *(par défaut : plus tard)*
4. **Port par défaut** : 8444. *(par défaut : oui)*
5. **Périmètre de la première livraison** : le socle (lots 0 à 2), puis validation avec vous avant les achats et la caisse. *(par défaut : oui)*
6. **Officine pilote** : à désigner par ITI pour valider les règles et tester sur place.
