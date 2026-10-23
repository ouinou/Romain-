# Gestionnaire Comptable : installation avec le setup Windows

## Sur le poste serveur (une seule fois)

1. Choisissez le poste qui servira de serveur : allumé pendant les heures de travail, Windows 10/11 ou Windows Server 64 bits, 8 Go de mémoire, adresse IP fixe sur le réseau local (réservation sur la box ou le routeur).
2. Lancez `GestionnaireComptable-Setup-<version>.exe` avec un compte administrateur.
   Le fichier n'est pas encore signé numériquement : Windows peut afficher « Windows a protégé votre ordinateur ». Vérifiez son empreinte SHA-256 (fournie avec le fichier), puis cliquez sur « Informations complémentaires », puis sur « Exécuter quand même ».
3. Le setup installe tout : le logiciel, une base PostgreSQL privée, les services Windows, le certificat HTTPS, le pare-feu (réseau privé seulement) et les sauvegardes de 20 h.
4. À la fin, le logiciel s'ouvre dans le navigateur. Créez votre entreprise et son administrateur. Deux codes s'affichent **une seule fois** :
   - le **code maître** : à imprimer et à remettre sous enveloppe scellée au dirigeant ;
   - le **code d'invitation** de l'administrateur : il sert à choisir son mot de passe.
   L'administrateur active ensuite la double authentification (application sur téléphone).

## À faire juste après l'installation

- **Mettre la clé de sauvegarde en lieu sûr.** Elle se trouve dans `C:\ProgramData\GestionnaireComptable\config\serveur.env`, à la ligne `GC_CLE_SAUVEGARDE`. Sans elle, les sauvegardes sont illisibles. Recopiez-la sur papier, sous scellé, hors du serveur. Faites de même pour `GC_CLE_CHIFFREMENT`.
- **Copier les sauvegardes ailleurs.** Elles sont créées chaque soir dans `C:\ProgramData\GestionnaireComptable\sauvegardes`. Copiez-les régulièrement sur un disque externe ou un NAS.
- Ne donnez à personne d'autre que l'administrateur technique l'accès au dossier `C:\ProgramData\GestionnaireComptable`.

## Brancher un autre poste

Rien à installer, il suffit d'un navigateur (Edge, Chrome ou Firefox).

1. Sur l'autre poste, ouvrez `https://NOM-DU-SERVEUR:8443/certificat-autorite.crt` (remplacez NOM-DU-SERVEUR par le nom ou l'adresse IP du serveur). Le navigateur prévient que la connexion n'est pas encore sécurisée : c'est normal, cette page sert justement à la sécuriser.
2. Ouvrez le fichier téléchargé, puis choisissez « Installer le certificat… », « Ordinateur local », « Placer tous les certificats dans le magasin suivant », puis « Autorités de certification racines de confiance ».
3. Fermez et rouvrez le navigateur, puis allez sur `https://NOM-DU-SERVEUR:8443/` et ajoutez la page aux favoris.

Le port est indiqué dans `C:\ProgramData\GestionnaireComptable\adresse.txt` sur le serveur (8443, sauf s'il était déjà pris).

## Mise à jour

Lancez le setup de la nouvelle version sur le serveur. Il arrête les services, remplace le programme, met la base à niveau et redémarre. Les données et la configuration sont conservées. Faites une sauvegarde avant, par précaution.

## Désinstallation

Panneau de configuration, « Programmes », puis « Gestionnaire Comptable ». Par défaut, la base et les sauvegardes sont **conservées** dans `C:\ProgramData\GestionnaireComptable`. Elles ne sont effacées que si vous le confirmez deux fois.

## En cas de problème

- Le journal de l'installation se trouve dans `C:\ProgramData\GestionnaireComptable\journaux\installation.log`.
- Les journaux du serveur sont dans le même dossier.
- Services Windows : « Gestionnaire Comptable - serveur » (`GestionnaireComptable-Serveur`) et la base (`GestionnaireComptable-Base`).
