# Guide d'utilisation (version 0.1)

Ce guide couvre ce qui existe aujourd'hui : l'accès, les utilisateurs, les rôles, le journal et les réglages de l'entreprise. Les modules de gestion (trésorerie, comptabilité, stocks…) auront leur propre chapitre quand ils seront livrés.

## 1. Se connecter

Ouvrez l'adresse du serveur dans le navigateur, par exemple `https://192.168.1.10:8443`. Saisissez :

- le **code entreprise** (il est mémorisé sur le poste ensuite) ;
- votre **adresse e-mail** et votre **mot de passe** ;
- le **code à 6 chiffres** de votre application d'authentification, si la double authentification est activée.

Après 5 erreurs, le compte est bloqué 15 minutes et l'administrateur est prévenu. La session se ferme après 15 minutes sans activité.

**Premier accès.** Votre administrateur vous remet un code d'invitation. Sur l'écran de connexion, choisissez « J'ai reçu un code d'invitation », puis votre mot de passe : au moins 12 caractères, sans votre nom ni votre e-mail. Une phrase de quelques mots convient très bien.

**Mot de passe oublié.** Demandez un code de réinitialisation à votre administrateur. Il est valable 30 minutes.

## 2. Double authentification

Les rôles sensibles (administrateur, direction, auditeur, RH) l'exigent. Le logiciel vous guide à la première connexion :

1. installez sur votre téléphone une application comme Google Authenticator, Microsoft Authenticator ou FreeOTP ;
2. cliquez sur « Générer ma clé » et scannez le QR code ;
3. saisissez le code affiché.

En cas de perte du téléphone, un autre administrateur ou le code maître permet de rétablir l'accès (voir 6).

## 3. Gérer les utilisateurs (administrateur)

Menu **Utilisateurs** :

- **Ajouter** : nom, e-mail, rôles, et une date de fin d'accès si besoin (stagiaire, auditeur externe). Un code d'invitation s'affiche **une seule fois** : remettez-le en main propre.
- Cliquez sur une personne pour **modifier**, changer ses **rôles**, la **désactiver** ou la **réactiver**, **réinitialiser** son mot de passe, **fermer ses sessions** ou consulter son **historique de connexions**.
- Les opérations sensibles demandent un **motif**, conservé dans le journal, puis la **ressaisie de votre mot de passe**. Celle-ci reste valable 5 minutes.
- Vous ne pouvez pas modifier vos propres rôles ni désactiver votre propre compte : c'est volontaire, un autre administrateur doit le faire.
- Un compte qui ne s'est pas connecté depuis 90 jours est désactivé automatiquement (durée réglable dans **Entreprise**).

## 4. Rôles et permissions

Chaque rôle est une grille de 14 modules × 10 actions (consulter, créer, modifier, soumettre, valider, annuler, archiver, imprimer, exporter, administrer).

- Les **rôles système** (Comptable, Caissier…) servent de modèles et ne se modifient pas.
- Pour adapter un profil : **Créer un rôle**, en partant éventuellement d'un rôle existant, puis cochez ou décochez dans la grille et **Enregistrer** avec un motif. Le changement s'applique immédiatement.
- Le rôle Comptable n'a, par défaut, accès ni aux comptes bancaires, ni à la paie, ni aux résultats globaux. Accordez ces droits explicitement si votre organisation le prévoit.

## 5. Journal d'audit

Menu **Journal d'audit** :

- toutes les actions importantes y figurent, avec la date, la personne, le poste, le résultat, le motif, et les valeurs avant et après ;
- filtrez par type, résultat, période ou mot-clé, et cliquez sur une ligne pour voir le détail ;
- **Vérifier l'intégrité** recalcule la chaîne d'empreintes. En cas d'anomalie, ne touchez à rien et prévenez le responsable sécurité ;
- **Exporter (CSV)** demande une confirmation, et l'export est lui-même tracé.

Personne ne peut modifier ou supprimer un événement depuis le logiciel.

## 6. Entreprise et code maître

Menu **Entreprise** : raison sociale, RCCM, NIU, adresse et téléphone. Les réglages de sécurité (double authentification obligatoire, délai d'inactivité) demandent une confirmation.

Le **code maître** sert uniquement à rétablir l'accès d'un administrateur bloqué, depuis l'écran de connexion (« Administrateur bloqué : utiliser le code maître »). Il est à usage unique : générez-en un nouveau après chaque utilisation. Conservez-le imprimé, sous enveloppe scellée, chez le dirigeant.

## 7. Mon compte

Changez votre mot de passe (vos autres sessions sont alors fermées), activez la double authentification et fermez les sessions que vous ne reconnaissez pas.
