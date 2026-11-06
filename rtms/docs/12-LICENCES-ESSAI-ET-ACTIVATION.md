# Licences : essai de 14 jours et activation

## Ce que voit le client

1. **Premier démarrage du poste principal** : RTMS fonctionne normalement pendant 14 jours. La barre d’état affiche « Version d’essai : N jour(s) restant(s) ». À 3 jours de la fin, un message prévient à chaque connexion.
2. **Fin de l’essai** : le logiciel se bloque sur l’écran « Période d’essai terminée ». Les données ne sont ni effacées ni modifiées ; elles redeviennent accessibles dès l’activation. Le blocage est fait par le serveur du poste principal : tous les postes du réseau sont bloqués en même temps.
3. **Activation** : l’écran affiche le **code d’activation** du poste (bouton « Copier »). Le client vous l’envoie ; vous lui renvoyez une **clé de licence** ; l’administrateur de RTMS la colle et clique sur « Activer ».

Le code et la clé se trouvent aussi dans Administration › Licence, pour activer avant la fin de l’essai.

## Ce que vous faites (éditeur)

Vous avez besoin de deux fichiers, à garder **sur votre PC uniquement** :

- `RTMS-cle-privee-EDITEUR.pem` : votre clé privée. Elle signe les licences. Sans elle, impossible d’en produire ; si quelqu’un la copie, il peut en produire à votre place.
- `generateur-licences.html` : l’outil qui signe (dossier `tools/` du projet).

Pour chaque client :

1. Ouvrez `generateur-licences.html` avec **Microsoft Edge** ou **Google Chrome** à jour (double-clic, pas besoin d’Internet).
2. Étape 1 : choisissez le fichier `RTMS-cle-privee-EDITEUR.pem`.
3. Étape 2 : collez le code d’activation reçu (il commence par `RTMS-ACT1.`), le nom du client, l’offre, le nombre maximum d’utilisateurs et la durée (1 mois à 2 ans, définitive ou jusqu’à une date).
4. « Générer la clé de licence », puis « Copier » ou « Enregistrer en fichier .txt », et envoyez-la au client.

La clé ne fonctionne **que sur le poste** dont vous avez reçu le code. Collée sur un autre ordinateur, elle est refusée avec le message « cette licence a été établie pour un autre ordinateur ».

## Sécurité de la clé privée

- Faites **deux copies** de la clé privée (clé USB rangée à part, et un second support). Si vous la perdez, il faudra livrer une nouvelle version de RTMS avec une nouvelle clé publique, et réactiver tous les clients.
- Ne l’envoyez jamais par e-mail ou WhatsApp, ne la mettez pas dans le dossier du projet (le fichier `.gitignore` l’exclut par précaution), ne la donnez pas avec l’installateur.
- L’application ne contient que la **clé publique** (`apps/desktop/src/license-public-key.pem`) : elle sert seulement à vérifier une licence, pas à en créer.

## Fonctionnement technique

- Début de l’essai : date du premier démarrage du serveur local (ligne `installation`, colonne `created_at`).
- Reculer l’horloge du PC ne rallonge pas l’essai : le serveur mémorise la date la plus récente vue (`installation.clock_high_water`, migration 0006) et la réévalue toutes les 5 minutes, donc la fin de l’essai s’applique même sans redémarrage.
- Licence : jeton `RTMS1.<données>.<signature Ed25519>`, lié à l’identifiant d’installation et à l’empreinte du poste (identifiant machine Windows + installation), option « hors ligne » (aucune vérification sur Internet), date de fin.
- Bloqué (réponse 402 `licence_requise`) : toutes les routes métier. Restent ouverts : connexion, état et activation de la licence, première installation, sauvegardes.
- Une licence arrivée à sa date de fin bloque de la même façon, jusqu’à l’activation d’une nouvelle clé.

## Limites à connaître

- Réinstaller le poste principal **en effaçant ses données** recrée une installation, donc un nouvel essai de 14 jours, mais l’entreprise repart avec une base vide. Cela décourage le contournement, sans l’empêcher totalement.
- Restaurer une sauvegarde conserve la licence et la date d’essai de l’installation d’origine.
- Si le client change de poste principal (nouvel ordinateur), il faut lui fournir une nouvelle clé pour ce poste.
