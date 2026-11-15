# Suivi GPS des trajets (parc automobile)

Version 2.5.0. Chaque trajet GPS est rattaché à un véhicule du parc, et si besoin à une mission de transport et à un chauffeur.

## Ce que fait RTMS

- **Import d'un trajet** depuis la fiche du véhicule (« Importer un trajet ») ou depuis l'écran **Suivi GPS** de la barre latérale. Formats acceptés : `.gpx` (conseillé), `.kml` avec horodatage, `.csv` avec des colonnes latitude / longitude / date-heure.
- **Chiffres calculés par le poste principal** : distance, durée totale, temps de roulage, vitesse moyenne en roulage, vitesse maximale et arrêts de 5 minutes ou plus (heure, durée, position).
- **Tracé du trajet**, affiché sans Internet : départ, arrivée, arrêts numérotés, échelle et quadrillage en kilomètres.
- **Fiche du véhicule** : nombre de trajets, kilomètres suivis et temps de roulage cumulés, avec les 5 derniers trajets.
- **Filtres** par véhicule et par période. Le total des kilomètres affiché tient compte des filtres.
- **Impression / PDF** d'une fiche de trajet sur le modèle A4 RAHA, et **export GPX** du trajet (lisible dans Google Earth, OsmAnd, QGIS…).
- **Retrait d'un trajet** importé par erreur. Le trajet n'est pas effacé de la base : il est masqué, et le motif est gardé dans le journal d'audit.

## Ce que RTMS ne fait pas (encore) : la position en direct

RTMS fonctionne sur le réseau local du bureau, sans Internet. Un camion sur la route n'est pas sur ce réseau, donc le poste principal ne peut pas recevoir sa position en temps réel.

Le suivi porte donc sur les trajets **déjà effectués** : le fichier est récupéré au retour du véhicule, ou téléchargé depuis la plateforme du traceur, puis importé dans RTMS.

Pour voir les camions en direct, il faudrait :

1. des traceurs GPS avec carte SIM dans les véhicules (abonnement data par véhicule) ;
2. un serveur joignable depuis Internet pour recevoir les positions, ce qui sort du fonctionnement 100 % hors ligne actuel.

C'est faisable dans une version ultérieure, mais c'est un choix d'équipement et de coût à faire avec le client.

Depuis la 2.6, si les camions ont déjà des traceurs (SinoTrack ou autre), la plateforme web du fournisseur s'ouvre dans RTMS (bouton « Suivi en direct ») : voir `14-CLIENTS-CAISSE-BL-DOUANE.md`, partie 6.

## D'où viennent les fichiers

| Source | Comment récupérer le fichier | Remarques |
|---|---|---|
| Traceur GPS installé dans le camion | Export « historique » ou « trajet » depuis la plateforme ou le logiciel du fabricant, au format GPX ou CSV | Le plus fiable : fonctionne même si le chauffeur oublie son téléphone |
| Téléphone du chauffeur | Application d'enregistrement de trajets qui exporte en GPX (plusieurs applications gratuites existent sur Android) | Le téléphone doit rester allumé, avec la localisation active, pendant tout le trajet |
| Google Earth / autre logiciel | KML **avec horodatage** (« gx:Track ») | Un tracé KML sans heures de passage est refusé : on ne peut pas en tirer de durée ni de vitesse |

Un fichier GPX qui contient seulement un itinéraire prévu, sans heures de passage, est refusé avec un message clair.

## Règles de calcul (fichier `apps/api/src/gps/track.ts`)

Ces seuils sont des choix de départ. Ils seront à ajuster après quelques semaines de vraies traces RAHA.

- **Position aberrante** : un saut qui impliquerait plus de 180 km/h est écarté. Cela arrive sous les arbres, près des bâtiments ou au démarrage du récepteur.
- **Bruit GPS** : à l'arrêt, la position « tremble » de quelques mètres. Les déplacements de moins de 25 m ne sont pas ajoutés à la distance.
- **Arrêt** : au moins 5 minutes dans un rayon de 100 m.
- **Vitesse maximale** : mesurée sur au moins 20 secondes, pour ne pas retenir un à-coup du récepteur.
- **Temps de roulage** : segments à plus de 3 km/h. Une coupure de signal ne compte pas plus de 10 minutes.
- Limites : 50 000 positions et 7 jours au maximum par trajet. Un fichier plus gros est allégé par le poste avant l'envoi, ce qui garde la forme du trajet.

La distance GPS **ne remplace pas** le compteur kilométrique du véhicule. Elle sous-estime un peu les virages serrés quand les positions sont espacées. Le champ « Kilométrage » de la fiche n'est donc pas modifié automatiquement.

## Droits

Le suivi GPS reprend les droits du module **Parc automobile** :

| Action | Droit nécessaire |
|---|---|
| Voir les trajets | Parc automobile : lecture |
| Importer, modifier le libellé ou le chauffeur | Parc automobile : mise à jour |
| Retirer un trajet | Parc automobile : annulation |
| Exporter en GPX | Parc automobile : export |
| Imprimer | Parc automobile : impression |

Avec les droits par défaut, le **responsable transport** importe et consulte les trajets, mais seul l'administrateur peut en retirer. Les profils sans accès au parc (agent opérationnel, commercial…) ne voient pas le suivi GPS.

## Technique

- Table `gps_tracks` (migration `0007_gps_tracks`) : une ligne par trajet, les positions en JSON `[[secondes depuis le départ, latitude, longitude], …]`. Aucune donnée existante n'est modifiée par la migration.
- Isolation par société par la RLS PostgreSQL, comme pour les autres données.
- Base de données : suppression physique interdite, et la trace (positions, distance, véhicule, dates) ne peut pas être modifiée après l'import (déclencheur `gps_tracks_guard`). Seuls le libellé, le chauffeur, la mission et l'annulation peuvent changer.
- Journal d'audit : `gps.import`, `gps.update`, `gps.cancel`, `gps.export`.
- Les sauvegardes `.rtmsbak` incluent les trajets. Une sauvegarde faite avant la 2.5.0 se restaure normalement, sans trajets.
- Routes : `GET/POST /api/gps/tracks`, `GET/PATCH /api/gps/tracks/:id`, `POST /api/gps/tracks/:id/cancel`, `GET /api/gps/tracks/:id/gpx`.
- Tests : `test/unit/gps-track.test.ts` (calculs), `test/integration/gps.test.ts` (droits, isolation, base), scénario navigateur dans `apps/web/e2e/rtms.spec.ts`.

## À vérifier sur le terrain

- Le format exact exporté par le traceur que RAHA choisira : le CSV varie d'un fabricant à l'autre. RTMS reconnaît les colonnes courantes (`latitude`, `lat`, `longitude`, `lon`, `lng`, `date`, `heure`, `time`, `timestamp`…). Un exemple de fichier réel permettra de confirmer.
- L'heure des CSV sans fuseau est lue comme heure du Cameroun (UTC+1).
- Les seuils de calcul ci-dessus, sur de vraies traces de camions RAHA.
