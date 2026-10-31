# Gestion des licences

## Principe

Deux parties distinctes :

- le **serveur de licences**, exploité par l'éditeur, seul à détenir la **clé privée Ed25519** (dans Vault). Il crée les licences, les active, les renouvelle, les révoque ;
- l'**installation RTMS** chez le client, qui ne possède que la **clé publique**. C'est l'API qui vérifie la licence, jamais le navigateur.

## Le jeton

`RTMS1.<contenu>.<signature>` — le contenu (base64url) indique : identifiant de licence, **identifiant d'installation**, **empreinte de l'appareil**, titulaire, offre, options, nombre d'utilisateurs, date d'émission, **fin d'abonnement**, date limite de renouvellement en ligne.

La signature couvre tout le contenu. Changer une date, l'offre ou le nombre d'utilisateurs invalide le jeton (testé). Un jeton copié sur une autre machine est rejeté, car l'installation et l'appareil ne correspondent plus (testé).

- **Identifiant d'installation** : UUID créé au premier démarrage, stocké en base.
- **Empreinte d'appareil** : SHA-256 de `machine-id` + identifiant d'installation. En Docker, le `machine-id` de l'hôte est monté comme secret pour que l'empreinte ne change pas à chaque reconstruction de conteneur.

## Cycle de vie

1. L'éditeur crée la licence (`POST /licensing/admin/licenses`) : la clé `RTMS-XXXXX-…` est affichée **une seule fois** ; seule son empreinte est conservée.
2. L'administrateur client la saisit dans Paramètres → Licence. L'API contacte le serveur, qui vérifie : licence active, non expirée, nombre d'appareils, comportement normal. Il renvoie un jeton signé, valable 30 jours au plus.
3. Toutes les 12 h, l'API renouvelle son jeton. Hors ligne, elle continue de fonctionner jusqu'à la date limite + 7 jours de tolérance (paramétrable).
4. **Révocation** : l'éditeur révoque ; au renouvellement suivant, l'installation passe en consultation seule. Une liste de révocation signée est publiée sur `/licensing/v1/crl`.
5. **Abonnement** : prolongation par `POST /licensing/admin/licenses/:id/renew`.
6. **Appareil perdu ou remplacé** : `POST /licensing/admin/activations/:id/revoke`, puis nouvelle activation.

## Détection d'activations anormales

- plus de 20 tentatives d'activation en 24 h → refus temporaire et événement `anomaly_rate` ;
- tentatives depuis plus de 5 adresses IP différentes en 24 h → **suspension automatique** et événement `anomaly_suspended` (testé avec un seuil de 3) ;
- dépassement du nombre d'appareils → refus et événement `device_limit`.

Tous les événements sont conservés dans `license_events`.

## Effet d'une licence invalide

En mode `enforce` (obligatoire en production) : **consultation et export restent possibles**, les créations, modifications et imports sont refusés (HTTP 402). Le choix est volontaire : une licence expirée ne doit pas empêcher l'entreprise d'accéder à ses propres données ni de les exporter.

## Génération des clés de l'éditeur

```bash
cd rtms/apps/api && npm run license:keygen -- /chemin/hors/depot
```

Importer ensuite la clé privée dans Vault, puis l'effacer du disque (`shred -u`). La clé publique est distribuée avec chaque installation.

## Limite honnête

Un logiciel installé chez le client reste modifiable par quelqu'un qui contrôle le serveur : il peut retirer la vérification du code. La signature Ed25519 empêche de **fabriquer** ou de **modifier** une licence, pas de supprimer le contrôle. Les parades sont contractuelles, et techniques à la marge (images signées, fonctions réservées côté serveur de l'éditeur).
