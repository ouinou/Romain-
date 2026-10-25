# FINEXA PHARMA

Logiciel de gestion d'officine de la suite FINEXA (éditeur : Incubateur Technologique de l'Innovation, ITI). Il fonctionne en local, sur un seul PC ou sur le réseau de la pharmacie, sans Internet.

**Version 0.1 : socle.** Configuration de la pharmacie, comptes et rôles, catalogue des produits, lots, stock, inventaires et historique des mouvements. La vente au comptoir, la caisse, les achats fournisseurs et la licence viendront après validation de ce socle (voir `docs/CONCEPTION.md`, plan par étapes).

| Dossier | Contenu |
|---|---|
| `serveur/` | API Fastify + PostgreSQL : authentification, permissions, journal d'audit, catalogue, lots, stock, inventaires |
| `interface/` | Interface React (même présentation que FINEXA ERP : police Arial, couleurs, ruban, menus, tableaux) |
| `installateur/` | Setup Windows « FINEXA PHARMA » (dossiers, services, base et port 8444 distincts de l'ERP) |
| `docs/` | Conception, guide d'utilisation, sécurité, logo |

## Lien avec FINEXA ERP

FINEXA ERP (`../gestionnaire-comptable`, version 0.3.1) n'a pas été modifié.

La conception prévoyait un dossier `finexa-core/` contenant les éléments communs, partagé par les deux logiciels. **Il n'a pas été créé dans cette version.** Le code commun (sécurité, journal, utilisateurs, rôles, sauvegardes, cadre de l'interface, composants, setup) a été **copié** dans `finexa-pharma/` puis adapté. Raisons :

- extraire un noyau partagé aurait obligé à modifier les imports et la construction de l'ERP, ce qui était exclu ;
- une copie permet à PHARMA d'évoluer (rôles, permissions, signature des sauvegardes) sans risque de régression pour l'ERP déjà livré.

Le prix à payer : un correctif de sécurité dans le code commun devra être reporté à la main dans les deux logiciels. Si un troisième produit FINEXA arrive, l'extraction d'un vrai `finexa-core` versionné deviendra rentable ; c'est une décision à prendre avec l'ITI.

Ce qui a été retiré de la copie : comptabilité, trésorerie, ventes et avoirs de l'ERP (tables, routes, écrans, tests). Ce qui a changé dans le code commun : rôles et modules de permissions propres à l'officine, signature des fichiers de sauvegarde (`FXPH1`, une sauvegarde de l'ERP est refusée), nom du logiciel et logo.

## Développement

Prérequis : Node.js 22, PostgreSQL 16.

```
cd serveur && npm ci && npm test          # tests du serveur (base de test : voir serveur/test/)
cd interface && npm ci && npm run build   # interface
```

Base de démonstration (données fictives) puis parcours dans un navigateur :

```
cd serveur && npm run migrer && GC_MODE_DEMO=oui npm run demo:initialiser && npm run demarrer
cd interface && GC_URL=http://localhost:8444 node tests/parcours.mjs captures
```

Setup Windows (construit sous Linux avec NSIS) : `installateur/construire.sh`.

Démonstration en ligne (vraie interface, serveur simulé dans le navigateur, données fictives, aucune sécurité réelle) : `cd interface && npm run build:demo` produit `finexa-pharma-demo.html`, un fichier unique. Le simulateur (`interface/src/demo/`) reprend les règles des routes du serveur ; chaque onglet a sa propre mémoire, perdue au rechargement.

## État des vérifications (version 0.1)

- Tests du serveur : 62 sur 62 réussis (catalogue, stock, inventaires, sécurité, rôles, sauvegarde et restauration).
- Parcours navigateur : 19 étapes réussies (connexion, paramètres, création de produit, entrée de stock, lot périmé refusé, ajustement avec confirmation, inventaire avec écart, historique, alertes, recherche, création et activation d'un compte, droits de la vendeuse avec refus serveur, journal intègre, affichage téléphone), sans erreur JavaScript.
- Setup Windows : construit sous Linux ; **pas encore installé sur un vrai poste Windows**. À faire avant toute mise en service.
- Aucun audit de sécurité externe.

## Points à valider par un pharmacien

Le logiciel n'invente aucune règle médicale ou réglementaire. Avant une utilisation réelle, à confirmer :

- taux de TVA applicables aux médicaments et à la parapharmacie (aucun taux n'est fourni par défaut ; la démonstration contient un taux marqué « à vérifier ») ;
- délai d'alerte de péremption (90 jours par défaut) ;
- registres obligatoires (stupéfiants, ordonnancier…) et mentions des tickets : non traités dans le socle ;
- gestion des prix réglementés, le cas échéant.
