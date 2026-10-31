# Interface RTMS — espace de travail

> **Version 2.2** : l'interface suit désormais la maquette fournie par RAHA TRANSPORT (`docs/references/maquette-interface-rtms.webp`), avec le logo officiel, et la facture reproduit le modèle fourni (`docs/references/modele-facture-raha.webp`). Les sections ci-dessous décrivent l'organisation générale ; les écarts restants avec la maquette sont listés à la fin.

## Ce qui a changé, et ce qui n'a pas changé

**Inchangé** : la palette RAHA TRANSPORT (vert `#123f32`, orange `#ef8125` pour les actions, jaune `#f2c94c` pour les alertes), les fonds clairs, la typographie (Inter / Segoe UI), les boutons, les pastilles de statut, les panneaux blancs, l'écran de connexion, les 14 écrans du prototype et toutes les routes de l'API.

**Changé** : l'organisation. L'application n'est plus une suite de pages avec un menu latéral. C'est un espace de travail de logiciel de bureau, organisé comme les grands logiciels de création (barre de menus, barre d'outils verticale, documents en onglets, panneaux à droite), mais habillé aux couleurs de RAHA. Aucun thème sombre, aucune couleur empruntée.

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│RAHA TRANSPORT│ Fichier Édition Affichage … Administration Aide   [Recherche] 🔔│  (1) menus
├──────────────┴──────────────────────────────────────────────────────────────┤
│ Missions de transport │ + Nouvelle mission │ Ouvrir Modifier │ Statut … │      │  (2) commandes du module
├────┬──────────────────────────────────────────────────┬──┬──────────────────┤
│ ▦  │ [Tableau de bord] [Missions ×] [M-101 ×] [Nouvelle…•]│▌ │ PROPRIÉTÉS        │
│ ⇄  │                                                  │▌ │ HISTORIQUE        │
│ …  │   zone de travail : tableau, fiche, rapport…     │▌ │ DOCUMENTS ASSOCIÉS│  (5) panneaux
│(3) │                     (4)                          │▌ │ ACTIONS RAPIDES   │
│    │                                                  │▌ │ NOTIFICATIONS     │
│    │                                                  │▌ │ ACTIVITÉS         │
├────┴──────────────────────────────────────────────────┴──┴──────────────────┤
│ Utilisateur · contexte · dernière opération · licence · connexion            │  (6) barre d'état
└──────────────────────────────────────────────────────────────────────────────┘
```

## Les zones

1. **Barre de menus** (13 menus). Chaque entrée appelle une vraie commande ; une commande impossible dans le contexte est grisée plutôt que cachée. Ouverture au clic ou avec F10, flèches pour se déplacer, Entrée pour exécuter, Échap pour fermer.
2. **Barre de commandes contextuelle**. Elle change avec l'onglet actif : en facturation, « Nouvelle facture, Ouvrir, Modifier, Valider, Imprimer la facture, Exporter PDF, Exporter Excel, Supprimer… » ; en transport, « Affecter un véhicule, Affecter un chauffeur, Ordre de mission… ». Quand la place manque, seules les actions principales gardent leur libellé (les autres restent accessibles par leur icône et leur infobulle).
3. **Barre d'outils verticale** : 17 modules (Tableau de bord, Transport, Transit, Importation, Exportation, Commerce général, Clients, Fournisseurs, Facturation, Trésorerie, Parc automobile, Chauffeurs et personnel, Maintenance, Gestion documentaire, Rapports, Administration, Paramètres). Infobulle au survol, pastille orange du nombre d'alertes, module actif marqué par le filet orange du prototype. Seuls les modules autorisés au profil apparaissent.
4. **Espace de travail à onglets**. Chaque module, fiche ou formulaire s'ouvre dans son onglet. On peut en ouvrir jusqu'à 20, les réordonner par glisser-déposer, les fermer (croix, clic molette, menu contextuel), revenir à l'onglet précédent (Alt+Retour arrière). Chaque onglet garde sa saisie, son défilement, sa sélection et ses filtres. Un point orange signale un formulaire modifié ; fermer un onglet modifié demande confirmation. Les onglets et brouillons survivent à un rechargement de la page pendant la session du navigateur.
5. **Panneaux droits** : Propriétés, Historique (champ par champ, avec l'auteur), Documents associés, Actions rapides, Notifications, Activités récentes. Leur contenu suit l'onglet et la ligne sélectionnée. Chaque panneau se réduit, se masque (menu Fenêtre pour le réafficher), se réorganise par glisser-déposer ou se détache en panneau flottant déplaçable, toujours maintenu dans l'écran. La colonne se redimensionne avec la poignée (double-clic ou F4 pour la masquer).
6. **Barre d'état** : utilisateur, contexte (nombre d'enregistrements, sélection, tri), dernière opération (un clic ouvre l'historique des opérations de la session), état de la licence, connexion au serveur.

## Espaces de travail

Menu **Fenêtre › Espaces de travail** : *Essentiel* (tout visible), *Saisie* (panneaux masqués, maximum de place pour les formulaires), *Contrôle* (historique et notifications en premier). « Enregistrer l'espace actuel… » mémorise votre disposition sous un nom. Les préférences (largeur des panneaux, ordre, colonnes visibles, densité, nombre de lignes par page) sont propres à chaque utilisateur sur chaque poste. Elles ne contiennent aucune donnée métier.

## Tableaux

Recherche instantanée côté serveur, tri par clic sur l'en-tête (croissant, décroissant, aucun), filtres multicritères (listes, texte, plages de dates et de montants) affichés en étiquettes supprimables, pagination (25 à 200 lignes), sélection multiple (case, Ctrl+clic, Maj+clic, Maj+flèches), actions groupées (statut, export, impression, suppression), colonnes à afficher au choix, totaux de page pour les montants, menu contextuel au clic droit, double-clic ou Entrée pour ouvrir la fiche.

## Formulaires

Sections par opération métier, champs obligatoires marqués d'un astérisque rouge, listes déroulantes et calendriers, recherche dans les référentiels (client, véhicule, chauffeur, prestataire, dossier lié), calcul immédiat du total TTC des factures et de la marge des articles, erreurs du serveur affichées en clair avec le champ en cause surligné, confirmation avant tout passage à un statut qui fige l'enregistrement. Le conflit de modification (deux utilisateurs sur la même fiche) est détecté et l'utilisateur choisit de recharger.

## Raccourcis clavier

| Touche | Action |
|---|---|
| Ctrl+K | Recherche globale |
| Alt+N | Nouvel enregistrement dans le module actif |
| F2 | Modifier |
| Ctrl+S | Enregistrer |
| Suppr | Supprimer (annulation tracée) la sélection |
| Ctrl+P | Imprimer |
| F5 | Actualiser |
| Ctrl+F | Rechercher dans la liste |
| Ctrl+A | Tout sélectionner (hors champ de saisie) |
| F4 | Afficher / masquer les panneaux |
| Alt+W | Fermer l'onglet |
| Alt+PgSuiv / Alt+PgPréc | Onglet suivant / précédent |
| Alt+Retour arrière | Revenir à l'onglet précédent |
| F10 | Aller à la barre de menus |
| F1 | Liste des raccourcis |

Ctrl+W et Ctrl+N sont réservés par les navigateurs, d'où Alt+W et Alt+N. Sur macOS, Ctrl correspond à ⌘.

## Architecture du code (apps/web/src)

Pas de nouvelle technologie : l'interface existante était en JavaScript natif, sans étape de compilation, servie par l'API sous une CSP stricte (`script-src 'self'`). Je l'ai gardée ainsi, découpée en modules ES. Pas de React, de Tailwind ni de bibliothèque d'icônes : ces outils auraient imposé une chaîne de compilation et des dépendances sans gain fonctionnel ici. Les icônes sont dessinées dans le style Lucide (trait 2 px, grille 24) et intégrées en SVG.

| Fichier | Rôle |
|---|---|
| `components/ApplicationShell.js` | assemble les six zones |
| `components/TopMenuBar.js` | barre de menus, sous-menus, clavier |
| `components/ContextToolbar.js` | commandes du module actif |
| `components/LeftToolBar.js` | barre d'outils verticale, pastilles |
| `components/WorkspaceTabs.js` / `MainWorkspace.js` | onglets, historique de navigation, persistance |
| `components/RightPropertiesPanel.js` | panneaux contextuels, redimensionnement, flottants |
| `components/StatusBar.js` | barre d'état, historique des opérations |
| `components/ModalManager.js` | fenêtres modales déplaçables, confirmations, petits formulaires |
| `components/NotificationCenter.js` | messages éphémères, alertes métier |
| `components/GlobalSearch.js` | recherche globale groupée |
| `components/ContextMenu.js`, `PrintService.js` | menu contextuel, impression / PDF |
| `core/commands.js` | registre unique des commandes (menus, barres, raccourcis, menus contextuels) |
| `views/*.js` | tableau de bord, listes, fiches, rapports, paramètres, administration, connexion |
| `config.js` | colonnes, sections de formulaires, référentiels, vues |

Nouvelles routes API (aucune route existante modifiée) : tri et filtres sur `GET /api/records/:module` (paramètres `sort`, `dir`, `f`), `GET /api/records/:module/:id/history`, `GET /api/search`, `GET /api/notifications`, `GET /api/activity`. Migration `0004_ui_helpers` : deux fonctions de conversion tolérantes, aucune donnée modifiée.

## Écarts assumés avec la maquette (v2.2)

- Les boutons de fenêtre (réduire, agrandir, fermer) dessinés dans la maquette appartiennent au cadre de la fenêtre du système : ils apparaîtront avec l'application de bureau. Dans le navigateur, je ne les ai pas imités (ils ne feraient rien).
- Les statuts restent ceux du cahier des charges (« Clôturé » plutôt que « Terminée »). Les renommer est un paramétrage à valider.
- Le filtre « Période » vaut « Toutes » par défaut, pour ne rien masquer à l'ouverture (la maquette montre « Ce mois »).
- La facture ajoute une ligne « CLIENT » absente du modèle papier : une facture doit identifier son client. À confirmer.

## Ce qui reste à développer

- **PDF côté serveur** : « Exporter PDF » passe par l'impression du navigateur (« Enregistrer au format PDF »). C'est fiable, mais ce n'est pas un fichier généré par le serveur.
- **Police de la facture** : le PDF utilise la police du poste (Segoe UI sous Windows). Pour un rendu strictement identique partout, il faudra un PDF généré par le serveur avec police intégrée.
- **Excel natif (.xlsx)** : l'export produit un CSV compatible Excel (séparateur « ; », accents conservés).
- **Pièces jointes réelles** dans « Documents associés » : le panneau liste les fiches de documents dont le « Dossier lié » correspond ; il n'y a pas encore de dépôt de fichiers.
- **Règlements multiples** : l'avance est un montant unique ; l'historique des paiements reliés à la trésorerie reste à faire.
- **Application de bureau Electron** et installateurs Windows / macOS : l'interface est prête pour une fenêtre de bureau (raccourcis, menus, pas de dépendance au navigateur), mais l'emballage n'est pas fait.
- **Anglais** : le paramètre « Langue » existe, l'interface n'est qu'en français.
