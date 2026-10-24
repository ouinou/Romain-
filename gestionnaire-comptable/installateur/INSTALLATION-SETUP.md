# FINEXA ERP : installation avec le setup Windows

> FINEXA ERP s'appelait « Gestionnaire Comptable » jusqu'à la version 0.1.5. Les dossiers techniques (`C:\Program Files\GestionnaireComptable`, `C:\ProgramData\GestionnaireComptable`) et les noms des services gardent l'ancien nom : une installation existante se met à jour sur place, sans perte de données.

## Pour évaluer le logiciel (installation d'essai)

Faites l'essai sur un PC de test ou une machine virtuelle Windows 10/11, pas sur un poste qui contient des données importantes.

1. Lancez le setup. À l'écran « Choisir les composants », cochez **Données de démonstration (évaluation)**.
2. À la fin, le logiciel s'ouvre dans sa propre fenêtre (Microsoft Edge en mode application, sans barre d'adresse). Un raccourci « FINEXA ERP » est aussi posé sur le bureau.
3. Connectez-vous avec le code entreprise `GC-DEMO-2026` et le mot de passe `Demonstration-2026!`, en changeant de compte pour voir chaque rôle :
   - `amina.mahamat@demo.cm` (caissière) : faites une vente, imprimez la facture, enregistrez une dépense ;
   - `ousmane.djibrine@demo.cm` (DAF) : suivez les ventes en direct, validez les écritures par lots, vérifiez une facture ;
   - `paul.ngaro@demo.cm` (comptable), `joseph.atangana@demo.cm` (DG), `mariam.saleh@demo.cm` (administratrice : logo, couleurs, utilisateurs).
   La liste est aussi dans le menu Démarrer, « Comptes de démonstration ».
4. Pour essayer depuis un autre poste du réseau, voir « Brancher un autre poste » plus bas.

**Après l'essai** : désinstallez en acceptant la suppression des données. Le mot de passe de démonstration étant connu, cette installation ne doit jamais recevoir de vraies données.

## Sur le poste serveur (une seule fois)

1. Choisissez le poste qui servira de serveur : allumé pendant les heures de travail, Windows 10/11 ou Windows Server 64 bits, 8 Go de mémoire, adresse IP fixe sur le réseau local (réservation sur la box ou le routeur).
2. Lancez `FINEXA-ERP-Setup-<version>.exe` avec un compte administrateur.
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

Panneau de configuration, « Programmes », puis « FINEXA ERP ». Par défaut, la base et les sauvegardes sont **conservées** dans `C:\ProgramData\GestionnaireComptable`. Elles ne sont effacées que si vous le confirmez deux fois.

## En cas de problème

- Le journal de l'installation se trouve dans `C:\ProgramData\GestionnaireComptable\journaux\installation.log`.
- Les journaux du serveur sont dans le même dossier.
- Services Windows : « FINEXA ERP - serveur » (`GestionnaireComptable-Serveur`) et la base (`GestionnaireComptable-Base`).
- **« Échec de initdb.exe … pw.tmp … Permission denied »** (setup 0.1.4 et antérieurs) : corrigé en 0.1.5. Windows relance l'outil de création de la base avec des droits réduits, qui ne permettaient pas de lire le fichier temporaire du mot de passe. Relancez simplement le setup 0.1.5 : aucune base n'avait été créée, rien n'est à nettoyer.
- **« Une base existe déjà … mais sa configuration est absente »** : le dossier `base` contient une base alors que `config\serveur.env` a disparu. Le setup s'arrête sans rien toucher. Restaurez le fichier de configuration (copie de sauvegarde), ou, s'il s'agit d'une base d'essai sans valeur, déplacez le dossier `base` puis relancez le setup.
