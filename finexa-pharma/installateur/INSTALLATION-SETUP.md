# FINEXA PHARMA : installation avec le setup Windows

FINEXA PHARMA s'installe à part de FINEXA ERP. Les deux logiciels peuvent tourner sur le même serveur : chacun a son dossier (`C:\Program Files\FinexaPharma`, `C:\ProgramData\FinexaPharma`), sa base PostgreSQL privée, ses services Windows, ses sauvegardes et son port (8444 pour PHARMA, 8443 pour l'ERP). Désinstaller l'un ne touche pas à l'autre.

## Pour évaluer le logiciel (installation d'essai)

Faites l'essai sur un PC de test ou une machine virtuelle Windows 10/11, pas sur le poste qui gardera les données de l'officine.

1. Lancez le setup. À l'écran « Choisir les composants », cochez **Données de démonstration (évaluation)**.
2. À la fin, le logiciel s'ouvre dans sa propre fenêtre (Microsoft Edge en mode application). Un raccourci « FINEXA PHARMA » est posé sur le bureau.
3. Connectez-vous avec le code `PH-DEMO-2026` et le mot de passe `Demonstration-2026!`, en changeant de compte pour voir chaque rôle :
   - `aissatou.bello@demo.cm` (pharmacienne titulaire et administratrice) : paramètres de la pharmacie, utilisateurs, inventaire, ajustements ;
   - `esther.ngobassa@demo.cm` (gestionnaire de stock) : entrées de stock, lots, alertes ;
   - `clarisse.mbarga@demo.cm` (vendeuse) : consultation du catalogue et du stock, sans valeur du stock ni administration ;
   - `marc.eyinga@demo.cm` (pharmacien adjoint), `hamadou.bouba@demo.cm` (caissier).
   La liste est aussi dans le menu Démarrer, « Comptes de démonstration ».
4. Les produits de démonstration portent la mention « (démo) » : noms, lots, prix et dates sont inventés.

**Après l'essai** : désinstallez en acceptant la suppression des données. Le mot de passe de démonstration est connu de tous ; cette installation ne doit jamais recevoir de vraies données.

## Sur le poste serveur (une seule fois)

1. Choisissez le poste serveur : allumé pendant les heures d'ouverture, Windows 10/11 ou Windows Server 64 bits, 8 Go de mémoire, adresse IP fixe sur le réseau local (réservation sur la box ou le routeur). Dans une petite officine, c'est souvent le poste du back-office.
2. Lancez `FINEXA-PHARMA-Setup-<version>.exe` avec un compte administrateur Windows.
   Le fichier n'est pas encore signé numériquement : Windows peut afficher « Windows a protégé votre ordinateur ». Vérifiez son empreinte SHA-256 (fournie avec le fichier), puis « Informations complémentaires » et « Exécuter quand même ».
3. Le setup installe le logiciel, une base PostgreSQL privée, les services Windows, le certificat HTTPS, la règle de pare-feu (réseau privé seulement) et la sauvegarde de 20 h.
4. À la première ouverture, créez la pharmacie et son administrateur. Ce premier compte reçoit aussi le rôle « Pharmacien titulaire ». Deux codes s'affichent **une seule fois** :
   - le **code maître** : à imprimer et à remettre sous enveloppe scellée au pharmacien titulaire ;
   - le **code d'invitation** de l'administrateur : il sert à choisir son mot de passe.
   Activez ensuite la double authentification (application sur téléphone) : elle est demandée pour l'administrateur et les pharmaciens.
5. Dans *Administration › Pharmacie › Paramètres de la pharmacie*, réglez le délai d'alerte de péremption et saisissez les taux de TVA applicables. **Le logiciel n'en fournit aucun** : vérifiez-les avec votre expert-comptable.

## À faire juste après l'installation

- **Mettre la clé de sauvegarde en lieu sûr.** Elle se trouve dans `C:\ProgramData\FinexaPharma\config\serveur.env`, ligne `GC_CLE_SAUVEGARDE`. Sans elle, les sauvegardes sont illisibles. Recopiez-la sur papier, sous scellé, hors du serveur. Même chose pour `GC_CLE_CHIFFREMENT`.
- **Copier les sauvegardes ailleurs.** Elles sont créées chaque soir dans `C:\ProgramData\FinexaPharma\sauvegardes`. Copiez-les régulièrement sur un disque externe ou un NAS.
- Ne donnez l'accès au dossier `C:\ProgramData\FinexaPharma` qu'à l'administrateur technique.

## Utiliser le logiciel à plusieurs

- **un seul poste installe FINEXA PHARMA** : le serveur, qui garde la base de toute l'officine ;
- **les autres postes n'installent rien** : comptoir, caisse ou réserve ouvrent l'adresse du serveur dans Edge ou Chrome, chacun avec son propre compte ;
- les droits dépendent des rôles attribués par l'administrateur (vendeur, caissier, gestionnaire de stock, pharmacien…).

Si le setup est lancé sur un poste de travail, il le demande dès le début (« Ce poste doit-il devenir le SERVEUR ? ») : répondez **Non**, rien n'est installé.

**Créer le compte d'un collaborateur** : *Administration › Utilisateurs › Ajouter un utilisateur*. Le logiciel affiche une **fiche d'accès** à remettre en main propre : adresse du serveur, code de la pharmacie, adresse e-mail, code d'invitation (5 groupes de 4 caractères), valable 72 heures. Rien ne passe par e-mail : le logiciel fonctionne sans Internet.

**Mot de passe oublié** : l'administrateur génère un code de réinitialisation depuis la fiche de l'utilisateur (30 minutes). Administrateur bloqué : code maître, depuis l'écran de connexion.

## Brancher un autre poste

1. Sur l'autre poste, ouvrez `https://NOM-DU-SERVEUR:8444/certificat-autorite.crt`. Le navigateur prévient que la connexion n'est pas encore sécurisée : c'est normal, cette page sert à la sécuriser.
2. Ouvrez le fichier, « Installer le certificat… », « Ordinateur local », « Placer tous les certificats dans le magasin suivant », « Autorités de certification racines de confiance ».
3. Rouvrez le navigateur sur `https://NOM-DU-SERVEUR:8444/` et ajoutez la page aux favoris. Dans Edge, « Applications › Installer ce site en tant qu'application » crée un raccourci dans sa propre fenêtre.
4. En bas de l'écran de connexion, « Serveur : NOM » confirme le poste auquel vous êtes relié.

Le port réel est écrit dans `C:\ProgramData\FinexaPharma\adresse.txt` sur le serveur : 8444, sauf s'il était déjà pris au moment de l'installation (le setup prend alors le suivant libre).

Une douchette (lecteur de code-barres USB) qui se comporte comme un clavier fonctionne sans pilote : dans la recherche du catalogue ou de l'entrée de stock, elle « tape » le code puis Entrée.

## Mise à jour

Lancez le setup de la nouvelle version sur le serveur. Il arrête les services, fait une **sauvegarde chiffrée de la base** (la mise à jour s'arrête si elle échoue), remplace le programme, met la base à niveau et redémarre. Données et configuration sont conservées.

## Désinstallation

Panneau de configuration, « Programmes », puis « FINEXA PHARMA ». Par défaut, la base et les sauvegardes sont **conservées** dans `C:\ProgramData\FinexaPharma`. Elles ne sont effacées que si vous le confirmez deux fois.

## En cas de problème

- Journal de l'installation : `C:\ProgramData\FinexaPharma\journaux\installation.log`. Les journaux du serveur sont dans le même dossier.
- Services Windows : « FINEXA PHARMA - serveur » (`FinexaPharma-Serveur`) et la base (`FinexaPharma-Base`).
- **« Une base existe déjà … mais sa configuration est absente »** : le dossier `base` contient une base alors que `config\serveur.env` a disparu. Le setup s'arrête sans rien toucher. Restaurez le fichier de configuration, ou, pour une base d'essai sans valeur, déplacez le dossier `base` puis relancez le setup.
- Une sauvegarde de FINEXA ERP ne se restaure pas dans FINEXA PHARMA (et inversement) : les fichiers portent une signature différente et sont refusés.
