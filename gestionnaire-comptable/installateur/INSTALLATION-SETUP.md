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

## Utiliser le logiciel à plusieurs

FINEXA ERP fonctionne comme un site interne à l'entreprise :

- **un seul poste installe FINEXA ERP** : le serveur. Il garde la base de données de toute l'entreprise ;
- **les autres postes n'installent rien** : chaque collaborateur ouvre l'adresse du serveur dans Edge ou Chrome et se connecte avec son propre compte ;
- les droits de chacun dépendent des rôles que l'administrateur lui attribue (caisse, comptabilité, direction…).

Si le setup est lancé sur un poste de travail, il le demande dès le début (« Ce poste doit-il devenir le SERVEUR ? ») : répondez **Non**, rien n'est installé. Un poste qui a déjà installé FINEXA ERP par erreur a sa propre base, vide : elle ne connaît ni l'entreprise du serveur ni ses codes d'invitation. Le message « Code refusé par le serveur « NOM » » donne le nom du poste interrogé, pour repérer ce cas. Désinstallez FINEXA ERP de ce poste et utilisez l'adresse du serveur.

**Créer le compte d'un collaborateur** : *Administration › Utilisateurs › Ajouter un utilisateur*. Le logiciel affiche une **fiche d'accès** à imprimer ou à recopier : adresse du serveur, code entreprise, adresse e-mail, code d'invitation (5 groupes de 4 caractères, sans 0, O, 1, I ni L), date limite (72 heures). Rien n'est envoyé par e-mail : le logiciel fonctionne sans Internet. La fiche se remet en main propre. Le bouton « Copier le lien d'activation » donne un lien qui préremplit l'écran d'activation, à transmettre par une messagerie interne de confiance.

**Si le code est refusé**, le message dit pourquoi : code déjà utilisé (le compte est actif, il suffit de se connecter), remplacé par un code plus récent, expiré (avec la date), ou code de réinitialisation saisi à la place d'un code d'invitation. Sinon, vérifiez le code entreprise, le code, et que le poste ouvre bien l'adresse du serveur.

**Mot de passe oublié** : l'administrateur génère un code de réinitialisation depuis la fiche de l'utilisateur (valable 30 minutes). Administrateur bloqué : code maître, depuis l'écran de connexion.

## Brancher un autre poste

Rien à installer, il suffit d'un navigateur (Edge, Chrome ou Firefox).

1. Sur l'autre poste, ouvrez `https://NOM-DU-SERVEUR:8443/certificat-autorite.crt` (remplacez NOM-DU-SERVEUR par le nom ou l'adresse IP du serveur). Le navigateur prévient que la connexion n'est pas encore sécurisée : c'est normal, cette page sert justement à la sécuriser.
2. Ouvrez le fichier téléchargé, puis choisissez « Installer le certificat… », « Ordinateur local », « Placer tous les certificats dans le magasin suivant », puis « Autorités de certification racines de confiance ».
3. Fermez et rouvrez le navigateur, puis allez sur `https://NOM-DU-SERVEUR:8443/` et ajoutez la page aux favoris. Dans Edge, « Applications › Installer ce site en tant qu'application » crée un raccourci qui ouvre FINEXA ERP dans sa propre fenêtre.
4. En bas de l'écran de connexion, « Serveur : NOM » confirme le poste auquel vous êtes relié.

Le port est indiqué dans `C:\ProgramData\GestionnaireComptable\adresse.txt` sur le serveur (8443, sauf s'il était déjà pris).

## Mise à jour

Lancez le setup de la nouvelle version sur le serveur. Il arrête les services, fait une **sauvegarde chiffrée de la base** (depuis la version 0.3 ; la mise à jour s'arrête si elle échoue), remplace le programme, met la base à niveau et redémarre. Les données et la configuration sont conservées.

## Désinstallation

Panneau de configuration, « Programmes », puis « FINEXA ERP ». Par défaut, la base et les sauvegardes sont **conservées** dans `C:\ProgramData\GestionnaireComptable`. Elles ne sont effacées que si vous le confirmez deux fois.

## En cas de problème

- Le journal de l'installation se trouve dans `C:\ProgramData\GestionnaireComptable\journaux\installation.log`.
- Les journaux du serveur sont dans le même dossier.
- Services Windows : « FINEXA ERP - serveur » (`GestionnaireComptable-Serveur`) et la base (`GestionnaireComptable-Base`).
- **« Échec de initdb.exe … pw.tmp … Permission denied »** (setup 0.1.4 et antérieurs) : corrigé en 0.1.5. Windows relance l'outil de création de la base avec des droits réduits, qui ne permettaient pas de lire le fichier temporaire du mot de passe. Relancez simplement le setup 0.1.5 : aucune base n'avait été créée, rien n'est à nettoyer.
- **« Une base existe déjà … mais sa configuration est absente »** : le dossier `base` contient une base alors que `config\serveur.env` a disparu. Le setup s'arrête sans rien toucher. Restaurez le fichier de configuration (copie de sauvegarde), ou, s'il s'agit d'une base d'essai sans valeur, déplacez le dossier `base` puis relancez le setup.
