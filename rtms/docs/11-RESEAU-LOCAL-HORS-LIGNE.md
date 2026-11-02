# RTMS en réseau local, sans Internet

Pensé pour une petite entreprise sans serveur ni service informatique : **un PC de bureau ordinaire**
fait office de « poste principal ». Les autres ordinateurs s'y connectent par la box (câble ou wifi).
Internet n'est jamais nécessaire, ni pour travailler ni pour la licence.

## Ce qu'il faut

- Un PC Windows 10 ou 11 (64 bits) qui reste allumé pendant les heures de travail : le poste principal.
  4 Go de RAM suffisent pour quelques utilisateurs ; prévoir 2 Go d'espace disque libre au départ.
- Les postes de travail Windows, sur la même box.
- Une clé USB pour les copies de sauvegarde (conseillé).

Rien d'autre à installer : la base de données (PostgreSQL 16) est fournie dans l'installateur et
ne répond qu'au PC lui-même (127.0.0.1), jamais au réseau.

## Installation

### 1. Poste principal
1. Lancer `RTMS-Setup-2.3.0.exe`, puis RTMS.
2. Choisir **« Ce poste est le poste principal »**. Le premier démarrage prend environ une minute
   (création de la base).
3. Windows demande d'autoriser RTMS sur le réseau : accepter (réseaux **privés**). Sinon, icône RTMS
   près de l'horloge › « Autoriser RTMS dans le pare-feu Windows » (demande les droits administrateur ;
   la règle n'ouvre le port qu'aux appareils du réseau local).
4. Créer la société et le compte administrateur (12 caractères minimum), puis activer la double
   authentification demandée pour ce profil.
5. Administration › Utilisateurs : créer un compte par personne, avec son profil (Comptable, Responsable
   transport, Agent…). Chacun ne verra que les menus et actions autorisés par son profil.

Conseil : dans la box, réserver une adresse IP fixe au poste principal (bail DHCP statique). Ce n'est
pas obligatoire — les postes le retrouvent automatiquement — mais cela évite des lenteurs au démarrage.

### 2. Chaque poste de travail
1. Installer RTMS, choisir **« Se connecter au poste principal »**, puis « Rechercher le poste principal ».
2. Comparer l'**empreinte** affichée avec celle du poste principal (icône RTMS près de l'horloge ›
   « Afficher les informations de connexion »). Si elles sont identiques, confirmer.
3. Se connecter avec son propre compte.

L'empreinte est retenue. Si un autre appareil se fait passer pour le poste principal, la connexion est
bloquée avec un message explicite. Si le poste principal a été réinstallé, l'empreinte change :
reconnecter le poste en vérifiant la nouvelle.

## Au quotidien

- **Personnes connectées** : barre d'état en bas, « N connectés ». L'administrateur voit aussi le nom
  du poste et son adresse.
- **Factures** : le numéro (F-2026-0001, F-2026-0002…) et la date du jour sont attribués
  automatiquement à l'enregistrement. Deux postes qui enregistrent en même temps obtiennent deux numéros
  différents ; un numéro de facture annulée n'est jamais redonné ; le compteur repart à 1 chaque année.
- **Export des factures** : « Exporter en PDF (Bureau, clé USB…) », depuis une facture ou la liste
  (toutes les factures sélectionnées). Les PDF sont rangés dans un dossier « Factures RTMS » sur le
  Bureau, dans Documents, sur la clé USB détectée ou dans un autre dossier. Un fichier existant n'est
  jamais écrasé.

## Sauvegardes

- Automatique une fois par jour sur le poste principal (30 dernières conservées), plus « Sauvegarder
  maintenant » (icône RTMS ou Paramètres › Sauvegardes).
- Copie possible vers une clé USB ou un dossier : icône RTMS › « Copie des sauvegardes vers… ».
- Restauration : icône RTMS › « Restaurer une sauvegarde… ». L'ancienne base est conservée à côté,
  jamais effacée. L'intégrité du journal d'audit est contrôlée après restauration.

**À retenir** : une sauvegarde qui reste sur le même PC ne protège pas d'une panne de disque ou d'un vol.
Emporter régulièrement une copie hors des locaux.

## Licence hors ligne

L'éditeur produit un jeton de licence « hors ligne » (valable jusqu'à sa date de fin, sans vérification
en ligne) ; il se colle dans Administration › Licence.

## Limites connues

- Quand le poste principal est éteint, les autres postes ne peuvent pas travailler (message
  « Poste principal injoignable » avec bouton Réessayer).
- Au redémarrage du poste principal, chacun doit se reconnecter (sessions en mémoire).
- L'installateur n'est pas signé numériquement : Windows SmartScreen affiche un avertissement
  (« Informations complémentaires » › « Exécuter quand même »). Une signature de code est à prévoir.
- Le fonctionnement complet a été testé sous Linux (même code, même base intégrée). **Un essai réel sur
  deux PC Windows reliés à une box reste à faire avant la mise en service.**
