# Installation sous Windows (réseau local)

Guide pour installer le serveur sur un poste Windows 10/11 ou Windows Server, accessible depuis les autres postes du réseau. Compter environ une heure la première fois.

> Les versions indiquées sont celles avec lesquelles le socle a été testé (Node.js 22, PostgreSQL 16). Vérifiez les versions stables du moment avant d'installer.

## 1. Choisir la machine

- Une machine allumée pendant les heures de travail, de préférence dédiée.
- 8 Go de RAM, SSD, onduleur conseillé : une coupure de courant pendant une écriture est le premier risque pour la base.
- Une adresse IP fixe sur le réseau local (réservation DHCP sur la box ou le routeur), par exemple `192.168.1.10`.

## 2. Installer PostgreSQL 16

1. Télécharger l'installateur Windows sur postgresql.org (distribution EDB).
2. Garder le port 5432. Choisir un mot de passe fort pour le compte `postgres`. Ce mot de passe revient à l'**administrateur technique** uniquement.
3. Laisser PostgreSQL écouter seulement en local : dans `postgresql.conf`, `listen_addresses = 'localhost'` (valeur par défaut). Les postes clients passent par le serveur applicatif, jamais directement par la base.
4. Dans `postgresql.conf`, activer la trace des erreurs : `log_min_error_statement = error`. Les tentatives SQL refusées sur le journal y apparaîtront.

## 3. Préparer la base

Ouvrir `sql\00-roles-postgresql.sql`, remplacer les trois mots de passe `A-REMPLACER-…`, puis dans une invite de commandes :

```bat
"C:\Program Files\PostgreSQL\16\bin\psql" -U postgres -f sql\00-roles-postgresql.sql
```

Cela crée la base `gestionnaire_comptable` et trois rôles : `gc_owner` (migrations), `gc_app` (serveur) et `gc_backup` (sauvegardes).

## 4. Installer Node.js et le serveur

1. Installer Node.js 22 LTS (installateur `.msi` de nodejs.org).
2. Copier les dossiers `serveur` et `interface` dans `C:\GestionnaireComptable\`.
3. Compiler l'interface (le serveur la servira automatiquement) :

```bat
cd C:\GestionnaireComptable\interface
npm ci
npm run build
```

4. Puis, dans `C:\GestionnaireComptable\serveur` :

```bat
npm ci
npm run build
copy .env.exemple .env
```

5. Éditer `.env` : chaînes de connexion, et deux clés générées avec
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   Imprimer ou copier la clé de sauvegarde et la ranger hors du serveur.
6. Restreindre les droits du fichier `.env` au compte qui exécute le service (clic droit → Propriétés → Sécurité).

## 5. Créer le schéma et la première entreprise

```bat
npm run migrer
npm run entreprise:creer -- --code GC-MONENTREPRISE --raison-sociale "Mon Entreprise SARL" --admin-email admin@monentreprise.cm --admin-nom "Prénom Nom" --niu M0123456789X --rccm RC/DLA/2026/B/0001
```

Deux secrets s'affichent, une seule fois chacun :

- **le code maître de l'entreprise** (`GCM-…`) : à imprimer et à remettre sous enveloppe scellée au dirigeant, rangée dans un coffre. Il ne doit pas rester chez l'administrateur informatique. Il sert seulement si l'administrateur perd l'accès (mot de passe oublié, téléphone perdu). Après usage, l'administrateur en génère un nouveau depuis le logiciel ;
- **le code d'invitation** de l'administrateur : à lui remettre en main propre. Il choisira son mot de passe, puis activera la double authentification.

## 6. Activer HTTPS sur le réseau local

Sans HTTPS, les mots de passe circulent en clair sur le réseau. Le plus simple pour un réseau local est `mkcert` :

```bat
mkcert -install
mkcert -cert-file C:\GestionnaireComptable\certificats\serveur.crt -key-file C:\GestionnaireComptable\certificats\serveur.key 192.168.1.10 gestion.local localhost
```

Puis installer le certificat racine de mkcert (`mkcert -CAROOT` indique où il se trouve) sur chaque poste client, et renseigner `GC_TLS_CERTIFICAT` et `GC_TLS_CLE` dans `.env`.

## 7. Lancer le serveur comme service Windows

Avec NSSM (outil libre qui transforme un programme en service) :

```bat
nssm install GestionnaireComptable "C:\Program Files\nodejs\node.exe" "--env-file=.env dist\src\index.js"
nssm set GestionnaireComptable AppDirectory C:\GestionnaireComptable\serveur
nssm set GestionnaireComptable Start SERVICE_AUTO_START
nssm start GestionnaireComptable
```

Ouvrir le port dans le pare-feu, uniquement pour le réseau privé :

```bat
netsh advfirewall firewall add rule name="Gestionnaire Comptable" dir=in action=allow protocol=TCP localport=8443 profile=private
```

Test depuis un autre poste : `https://192.168.1.10:8443/api/sante` doit répondre `{"statut":"ok"}`, et `https://192.168.1.10:8443/` doit afficher l'écran de connexion.

**Pour une simple évaluation** (jamais sur la base de production), une entreprise fictive peut être créée :
`set GC_MODE_DEMO=oui` puis `npm run demo:initialiser`. Les identifiants s'affichent à la fin.

## 8. Sauvegardes et contrôle du journal

Dans le Planificateur de tâches Windows, créer deux tâches qui s'exécutent dans `C:\GestionnaireComptable\serveur` :

| Tâche | Commande | Fréquence |
|---|---|---|
| Sauvegarde | `npm run sauvegarder` | chaque soir |
| Contrôle du journal | `npm run journal:verifier` | chaque soir, après la sauvegarde |

Renseigner `GC_DOSSIER_COPIE_JOURNAL` et `GC_FICHIER_ANCRAGES` vers un support que l'administrateur technique ne contrôle pas seul : partage réseau d'un autre poste, NAS, disque externe. Copier aussi régulièrement le dossier de sauvegardes sur un support séparé.

**Tester la restauration au moins une fois par trimestre**, dans une base neuve :

```bat
"C:\Program Files\PostgreSQL\16\bin\createdb" -U postgres gc_essai_restauration
npm run restaurer -- --fichier=D:\Sauvegardes\GestionnaireComptable\gc-2026-....gcsv --base-cible postgres://postgres:MOTDEPASSE@localhost/gc_essai_restauration --confirmer
```

## 9. Mises à jour

1. Sauvegarder (`npm run sauvegarder`).
2. Arrêter le service, remplacer les fichiers, `npm ci`, `npm run build`.
3. `npm run migrer` : les nouvelles migrations s'appliquent ; une migration déjà appliquée puis modifiée bloque la mise à jour.
4. Redémarrer le service, puis vérifier `/api/sante` et `npm run journal:verifier`.
