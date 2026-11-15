# Version 2.6 : clients automatiques, classement, caisse, BL et douane

Ces changements font suite à la visite de terrain chez RAHA TRANSPORT. Voici ce qui en est ressorti :

- l'équipe ne veut pas tenir un répertoire de clients à part ;
- le comptable tient aussi la caisse ;
- le suivi des BL et des déclarations en douane manquait ;
- le commerce général n'est pas pratiqué pour le moment ;
- les camions ont des traceurs (SinoTrack et autres) dont la plateforme doit être accessible depuis RTMS.

## 1. Clients enregistrés automatiquement

Quand on enregistre une **facture**, une **mission de transport**, un **dossier de transit** ou un **BL**, RTMS regarde si le client existe déjà dans la liste des clients. S'il n'existe pas, sa fiche est créée :

- type « Client », nom tel que saisi ;
- téléphone repris du champ « Contacts » de la facture ;
- champ « Origine de la fiche » : par exemple « Créée automatiquement (facture F-2026-0012) ».

Règles :

- Pas de doublon pour une simple différence de majuscules ou d'espaces : « SOCAVER SARL », « Socaver sarl » et « SOCAVER  SARL » désignent le même client. Une faute de frappe (« SOCAVR ») crée en revanche une deuxième fiche. La saisie propose les clients existants pendant la frappe, ce qui limite ce risque.
- Si la fiche existe sans téléphone, le numéro de la facture y est ajouté. Un téléphone déjà présent n'est jamais remplacé.
- Seuls les **clients** sont créés automatiquement. Les fournisseurs et autres tiers restent saisis à la main, car aucune pièce de RTMS ne les identifie de façon sûre.
- La création est faite par le serveur, dans le même enregistrement que la facture. Si la facture est refusée (champ manquant, avance trop forte…), aucune fiche n'est créée.
- Un utilisateur qui peut créer des factures sans pouvoir créer de clients (le comptable, avec les droits par défaut) déclenche quand même la création : c'est le but.
- Chaque création apparaît dans le journal d'audit.

Les fiches existantes ne sont pas modifiées par la mise à jour. Un client déjà facturé avant la 2.6 sans fiche sera créé à la prochaine facture ou mission à son nom.

## 2. Classement des clients

Accès : barre latérale **Classement clients**, menu **Clients**, ou « Plus d'actions » dans la liste des clients.

Le tableau classe les clients par nombre de commandes. Une commande, c'est le plus grand des deux nombres « factures » et « missions », plus les dossiers de transit et BL. Une mission et sa facture ne comptent donc pas deux fois.

Pour chaque client, le tableau donne aussi :

- le chiffre d'affaires et le reste dû (seulement pour les profils qui voient les factures) ;
- la date de la dernière commande ;
- le nombre de mois actifs sur les 12 derniers mois.

| Catégorie | Règle |
|---|---|
| **Régulier** (constant) | Des commandes dans au moins 6 des 12 derniers mois |
| **Occasionnel** | Des commandes dans 2 à 5 des 12 derniers mois |
| **Nouveau** | Premier document il y a moins de 90 jours |
| **Ponctuel** | Un seul mois d'activité dans l'année |
| **Inactif** | Aucune commande depuis plus de 120 jours |

La **tendance** compare les 6 derniers mois aux 6 précédents : en hausse, stable ou en baisse.

En pratique, l'écran donne la liste des clients « constants » à soigner et celle des clients « inactifs » à relancer. Le classement s'imprime et s'exporte en PDF.

Ces seuils sont des valeurs de départ, à revoir avec la direction de RAHA après quelques mois de données réelles.

## 3. Caisse (le comptable tient la caisse)

- Nouvel écran **Caisse** (barre latérale, groupe Gestion, et menu Finance) : les mouvements de trésorerie payés en **espèces**.
- En tête de l'écran : le **solde de caisse** (toutes les entrées en espèces moins toutes les sorties), les entrées du jour et les sorties du jour.
- Le tableau de bord affiche le solde de caisse aux profils qui ont accès à la trésorerie.
- Un nouveau mouvement de caisse est déjà réglé sur « Espèces » et à la date du jour.
- En bas des listes de trésorerie et de caisse, la ligne de total donne désormais le **solde** (recettes moins dépenses). Avant, elle additionnait les deux.
- Le profil « Comptable / Finance » s'appelle maintenant **« Comptable / Caisse »**. Ses droits ne changent pas.

Le solde dépend de ce qui est saisi. Pour qu'il corresponde à l'argent réellement en caisse, le **fonds de caisse de départ** doit être saisi une fois comme recette en espèces. Le contrôle physique de la caisse (comptage en fin de journée) reste à faire par le comptable.

## 4. BL et douane

Nouveau module **BL et douane** (barre latérale, groupe Opérations, et menu Transit). Une fiche par BL, enregistrée dès que le BL arrive, et suivie jusqu'à la livraison.

| Partie | Champs |
|---|---|
| Titre de transport | N° BL, type (connaissement maritime, LTA, lettre de voiture, bon de livraison), statut, client, dossier de transit lié |
| Acheminement | Navire / transporteur, lieu de chargement, lieu de déchargement, arrivée prévue, arrivée effective, fin de franchise |
| Marchandise | N° de conteneur(s), nombre de colis, poids, marchandise |
| Déclaration en douane | N° de déclaration, date, bureau de douane, régime, droits et taxes, N° de quittance |
| Sortie et livraison | Date de mainlevée (BAE), date de livraison, observations |

Étapes (statut) : Attendu → Arrivé → Déclaration déposée → En vérification → Mainlevée obtenue → Livré → Clôturé.

Alertes (cloche et pastille du module) :

- **fin de franchise** dans 3 jours ou moins, ou dépassée (frais de magasinage), tant que la mainlevée n'est pas obtenue ;
- **arrivée prévue** dans les 3 jours pour un BL encore « Attendu ».

Droits par défaut :

| Profil | Accès |
|---|---|
| Responsable transit, responsable import-export | Gestion complète |
| Agent opérationnel | Saisie |
| Comptable, direction | Consultation, export et impression |
| Responsable transport | Consultation |

Le module **Gestion documentaire** reste en place pour référencer les autres pièces (cartes grises, contrats…), avec leur emplacement.

À vérifier avec RAHA :

- la liste des étapes ;
- les régimes douaniers utilisés ;
- le nombre de jours de franchise habituel au port de Douala, à saisir sur chaque BL.

RTMS ne joint pas encore les fichiers scannés (PDF du BL, de la déclaration). Le champ « Observations » et la gestion documentaire servent à noter où se trouve le papier ou le fichier.

## 5. Commerce général masqué

Le module reste dans le logiciel, avec ses données, mais il est **masqué par défaut** :

- barre latérale ;
- tableau de bord ;
- accès rapide ;
- menu (renommé « Clients »).

Pour le réactiver : **Paramètres › Société › Activités affichées › Commerce général**. Le module réapparaît pour tous les postes à leur prochaine connexion, ou tout de suite pour l'administrateur qui a fait le changement.

C'est un choix d'affichage. Les droits du serveur ne changent pas, et les articles déjà saisis sont conservés.

## 6. Traceurs GPS (SinoTrack et autres)

Les fournisseurs de traceurs ont une application mobile et une **plateforme web**, sur laquelle on voit les camions en direct. RTMS ouvre cette plateforme dans sa propre fenêtre :

1. **Paramètres › Société › Traceurs GPS** : indiquer le nom du fournisseur et l'adresse de sa plateforme web (en https://). Cette adresse est donnée par le fournisseur, souvent dans son application mobile ou sur la facture d'abonnement.
2. Sur la fiche de chaque véhicule, section **Traceur GPS** : saisir le N° du traceur (IMEI) et le fournisseur.
3. Le bouton **Suivi en direct** apparaît dans l'écran Suivi GPS et sur la fiche des véhicules qui ont un traceur. Depuis la fiche, le N° du traceur est copié pour être collé dans la recherche de la plateforme.

Fonctionnement et limites :

- La plateforme s'ouvre dans une fenêtre RTMS séparée. L'identifiant et le mot de passe du compte fournisseur sont saisis une fois et retenus dans cette fenêtre seulement, séparés de RTMS.
- Ce suivi en direct a besoin d'**Internet** sur le poste qui l'ouvre. Le reste de RTMS continue de fonctionner sur le réseau local, sans Internet.
- RTMS ne lit pas encore les positions des traceurs pour les ranger lui-même dans ses trajets. Pour cela, il faudrait l'accès à l'API du fournisseur (documentation et clé fournies par SinoTrack ou le fournisseur retenu), et que le poste principal soit connecté à Internet.
- En attendant, l'historique d'un trajet exporté depuis la plateforme (GPX ou CSV) s'importe dans **Suivi GPS** : distance, arrêts et tracé, rattachés au véhicule et à la mission (voir `13-SUIVI-GPS-TRAJETS.md`).

## Technique

- Migration `0008_bl_clients` :
  - le module `bl` est ajouté à la liste autorisée (`records_module_chk`) ;
  - les droits par défaut du module sont ajoutés pour les sociétés existantes (`ON CONFLICT DO NOTHING`).
  
  Aucune donnée existante n'est modifiée.
- Clients automatiques : `ensureClient` dans `apps/api/src/modules/routes.ts`. Verrou `pg_advisory_xact_lock` par nom de client, pour que deux postes qui enregistrent en même temps ne créent pas deux fiches.
- Classement : `apps/api/src/modules/clientRanking.ts`, route `GET /api/reports/clients` (droit de lecture sur les clients ; montants seulement avec le droit de lecture sur les factures).
- Caisse : `cash` dans `/api/dashboard` (droit de lecture sur la trésorerie).
- Réglages société : `commerceEnabled`, `trackerName`, `trackerUrl` (https obligatoire, contrôlé par le serveur), renvoyés à toute l'interface dans `/api/auth/me` (`company`).
- Fenêtre de la plateforme GPS (application Windows) :
  - session Electron séparée (`persist:traceur-gps`) ;
  - pas d'accès au pont `rtmsDesktop` ;
  - HTTPS uniquement ;
  - permissions du navigateur refusées.
- Tests :
  - `apps/api/test/integration/clients-bl.test.ts` (clients automatiques, droits, classement, BL, migration, caisse, réglages) ;
  - 4 scénarios navigateur dans `apps/web/e2e/rtms.spec.ts`.
