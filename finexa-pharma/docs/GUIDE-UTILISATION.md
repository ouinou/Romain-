# Guide d'utilisation de FINEXA PHARMA (version 0.1)

Cette version est le **socle** du logiciel : accès et utilisateurs, catalogue des produits, lots, stock, inventaires et historique des mouvements. La vente au comptoir, la caisse et les achats fournisseurs viendront ensuite ; ils s'appuieront sur ce socle.

Les données de démonstration (produits marqués « (démo) ») sont fictives. Le logiciel ne contient aucune règle médicale ou réglementaire : les champs « catégorie de délivrance » ou « conservation » sont des informations saisies par la pharmacie, dont le logiciel ne déduit rien.

## 0. Se repérer dans le logiciel

L'écran est celui de FINEXA ERP, organisé comme un logiciel de bureau :

- **Barre de titre** : logo et nom de la pharmacie, notifications, votre nom (ouvre *Mon compte*), *Déconnexion*.
- **Barre d'accès rapide** : tableau de bord, écran précédent, actualiser, imprimer, et le champ **Rechercher** (Ctrl+F) qui trouve un écran, une commande ou un produit.
- **Ruban** : un onglet par module (Accueil, Catalogue, Stock, Administration). Seules les commandes autorisées par votre rôle apparaissent.
- **Menu latéral** : tous les écrans, par module.
- **Onglets des documents** : chaque écran ouvert reste disponible au-dessus de la zone de travail.
- **Barre d'état** (en bas) : pharmacie, utilisateur, connexion au serveur, nombre d'alertes de stock à traiter (lien direct), zoom.

**Raccourcis** : Alt+P produits, Alt+N nouveau produit, Alt+E entrée de stock, Alt+L lots en stock, Alt+M mouvements, Alt+I inventaires, Alt+A alertes, Ctrl+F rechercher, F1 aide, Échap fermer. Dans un tableau, les flèches passent d'une ligne à l'autre et Entrée ouvre la ligne.

## 1. Se connecter

Ouvrez l'adresse du serveur dans le navigateur, par exemple `https://192.168.1.10:8444`. Saisissez le **code de la pharmacie** (mémorisé ensuite sur le poste), votre **e-mail**, votre **mot de passe**, et le **code à 6 chiffres** de votre application si la double authentification est active.

Après 5 erreurs, le compte est bloqué 15 minutes et l'administrateur est prévenu. La session se ferme après 15 minutes sans activité : un poste de comptoir laissé ouvert ne reste pas connecté.

**Premier accès** : choisissez « J'ai reçu un code d'invitation » et le code de votre fiche d'accès, puis votre mot de passe (au moins 12 caractères, sans votre nom ni votre e-mail ; une phrase de quelques mots convient).

**Mot de passe oublié** : demandez un code de réinitialisation à l'administrateur (valable 30 minutes).

## 2. Double authentification

Elle est exigée pour l'administrateur, le pharmacien titulaire, le pharmacien adjoint et l'auditeur. Installez sur votre téléphone une application comme Google Authenticator, Microsoft Authenticator ou FreeOTP, puis *Mon compte › Activer la double authentification* : scannez le QR code et saisissez le code affiché. Tant qu'elle n'est pas activée, un bandeau le rappelle sur le tableau de bord.

## 3. Le tableau de bord

- **Stock de l'officine** : produits actifs, ruptures, produits sous le seuil, péremptions proches, lots périmés ou bloqués encore en stock, et valeur du stock au prix d'achat (visible seulement des rôles autorisés).
- **Derniers mouvements**.
- **À traiter** : les alertes, avec un lien vers la liste concernée. Les lots périmés ou rappelés sont en rouge.

## 4. Catalogue

**Produits** (*Catalogue › Produits*) : recherche par nom, DCI, code interne ou code-barres. Une douchette fonctionne directement dans le champ de recherche : si un seul produit correspond, sa fiche s'ouvre. Filtres par catégorie, statut et alerte (rupture, sous le seuil). **Exporter (CSV)** produit un fichier lisible par Excel ; l'export est tracé.

**Créer un produit** : nom commercial et prix de vente obligatoires. Le code interne (`P-00001`…) est attribué par le logiciel. Le code-barres, s'il est saisi, doit être unique. Le taux de TVA se choisit dans la liste définie par la pharmacie (voir 8) ; « Non soumis à la TVA » est toujours proposé. Le **seuil d'alerte** déclenche l'alerte « sous le seuil » quand le stock vendable descend à ce niveau.

**Fiche produit** : stock vendable, lots, historique des prix (chaque changement de prix est conservé avec sa date et son auteur). Un produit ne se supprime pas : on le **suspend** ou on l'**archive**, avec un motif. Un produit archivé n'apparaît plus dans les listes de choix ; son historique reste.

**Importer un catalogue** (*Catalogue › Importer*) : pour reprendre une liste existante depuis un tableur, en CSV. Téléchargez le modèle, remplissez une ligne par produit, puis **Vérifier** : rien n'est créé tant qu'il reste une erreur, et chaque erreur est donnée avec son numéro de ligne. L'import est complet ou n'a pas lieu. Les catégories, familles et formes absentes sont créées. Les fichiers enregistrés par Excel en français (Windows-1252) sont acceptés.

**Catégories et référentiels** : catégories et familles (deux niveaux), formes pharmaceutiques, emplacements de rangement (rayon, réserve, réfrigérateur…). Un élément utilisé ne se supprime pas : il s'archive.

## 5. Lots et entrées de stock

Chaque boîte en stock appartient à un **lot** : numéro tel qu'imprimé sur la boîte, date de péremption, fournisseur, date de réception, prix d'achat, emplacement.

**Entrée de stock** (*Stock › Entrée de stock*, ou bouton depuis la fiche produit) : cherchez le produit (douchette possible), puis saisissez le lot, la péremption et la quantité en boîtes. Le produit reste choisi après l'enregistrement pour saisir le lot suivant.

- Un lot **déjà périmé** est refusé.
- Le **même numéro de lot** pour le même produit complète le lot existant ; avec une date de péremption différente, l'entrée est refusée : vérifiez la boîte.
- Dans cette version, une entrée est enregistrée comme « stock initial ». Les réceptions de commandes fournisseurs arriveront avec le module Achats.

**Lots en stock** : filtres par état (péremption proche, périmé), statut et épuisement. La **fiche du lot** montre tous ses mouvements avec le solde après chacun.

**Bloquer un lot** (doute sur l'emballage, contrôle en attente) ou le déclarer **rappelé** (retrait demandé par le fabricant ou l'autorité) : un motif est demandé. Un lot bloqué ou rappelé n'est plus compté dans le stock vendable. Lever un rappel demande de ressaisir son mot de passe.

Numéro, produit, péremption et prix d'un lot enregistré ne se modifient pas. Seul l'emplacement se change librement.

## 6. Ajustements, mouvements et alertes

**Ajuster le stock** (depuis la fiche du lot, rôles autorisés seulement) : casse, péremption, erreur de saisie, vol ou autre motif (précision obligatoire pour « autre »). L'ajustement demande la ressaisie du mot de passe et crée un mouvement définitif, numéroté `MVT-AAAA-NNNNN`.

Un mouvement ne se modifie ni ne se supprime. Si un ajustement était faux, on en saisit un autre en sens inverse, avec son motif. Le stock ne peut jamais devenir négatif : la base refuse le mouvement.

**Mouvements** (*Stock › Mouvements*) : tout l'historique, filtrable par nature, produit, lot ou période, exportable en CSV.

**Alertes** (*Stock › Alertes*) : produits en rupture, produits sous le seuil, lots périmés encore en stock, lots qui périment dans le délai d'alerte, lots bloqués ou rappelés.

## 7. Inventaires

*Stock › Inventaires › Nouvel inventaire* : libellé, et éventuellement une catégorie ou un emplacement pour un inventaire tournant. Un seul inventaire peut être ouvert à la fois.

1. Saisissez les quantités **comptées**, lot par lot, puis **Enregistrer les comptages**. On peut s'arrêter et reprendre plus tard.
2. La quantité attendue est relue au moment de chaque comptage : les ventes ou entrées faites pendant l'inventaire sont prises en compte.
3. **Valider l'inventaire** (mot de passe ressaisi) : chaque écart devient un mouvement « inventaire ». Les lots non comptés ne changent pas.
4. Un inventaire validé ou annulé est figé : ses lignes restent consultables mais ne se modifient plus.

## 8. Administration

**Utilisateurs** : ajout avec fiche d'accès à remettre en main propre (adresse du serveur, code de la pharmacie, e-mail, code d'invitation valable 72 heures) ; modification, rôles, désactivation, réinitialisation, fermeture des sessions. Les opérations sensibles demandent un motif et la ressaisie du mot de passe. Vous ne pouvez ni modifier vos propres rôles ni désactiver votre propre compte.

**Rôles et permissions** : grille de 11 modules × 10 actions. Rôles fournis : Administrateur, Pharmacien titulaire, Pharmacien adjoint, Préparateur / vendeur, Caissier, Gestionnaire de stock, Auditeur, Employé. Ils servent de modèles ; pour un profil différent, créez un rôle à partir de l'un d'eux. Par défaut, le vendeur et le caissier consultent le catalogue et le stock mais ne font ni entrée ni ajustement.

**Journal d'audit** : toutes les actions importantes (connexions, refus d'accès, créations de produits, changements de prix, entrées, ajustements, inventaires, exports…), avec auteur, date, poste, motif et valeurs avant/après. **Vérifier l'intégrité** recalcule la chaîne d'empreintes. Personne ne peut modifier ou supprimer un événement depuis le logiciel.

**Pharmacie** :

- *Profil* (identité, coordonnées, mentions légales, banque, logo et couleurs) : repris sur l'en-tête des documents imprimés.
- *Paramètres de la pharmacie* : délai d'alerte de péremption (90 jours par défaut) et liste des taux de TVA proposés sur les fiches produits. **Aucun taux n'est fourni par le logiciel** : saisissez ceux de la réglementation en vigueur, vérifiés avec votre expert-comptable.
- *Sécurité* : code maître, durée de désactivation des comptes inutilisés.

## 9. Mon compte

Changez votre mot de passe (vos autres sessions sont alors fermées), activez la double authentification et fermez les sessions que vous ne reconnaissez pas.

## 10. Sauvegardes

Sur le serveur installé par le setup, une sauvegarde chiffrée de toute la base est faite chaque soir à 20 h, suivie d'un contrôle du journal à 20 h 30. Elles sont dans `C:\ProgramData\FinexaPharma\sauvegardes` : copiez-les régulièrement sur un support séparé et gardez la clé de sauvegarde hors du serveur. La restauration se fait sur le serveur par l'administrateur technique (voir le guide d'installation).
