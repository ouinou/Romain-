# Guide d'utilisation de FINEXA ERP (version 0.3)

Ce guide couvre ce qui existe aujourd'hui : l'accès, les utilisateurs, les rôles, le journal et les réglages de l'entreprise. Les modules de gestion (trésorerie, comptabilité, stocks…) auront leur propre chapitre quand ils seront livrés.

## 0. Se repérer dans le logiciel

L'écran est organisé comme un logiciel de bureau :

- **Barre de titre** (en haut) : logo et nom de l'entreprise, notifications, votre nom (ouvre *Mon compte*), *Déconnexion*.
- **Barre d'accès rapide** : tableau de bord, écran précédent, actualiser, imprimer la page, et le champ **Rechercher** (Ctrl+F) qui trouve un écran, une commande ou une facture par son numéro.
- **Ruban** : un onglet par module (Accueil, Ventes, Trésorerie, Comptabilité, États, Administration). Les commandes sont regroupées par fonction ; leur raccourci est indiqué dessous. Seules celles que votre rôle autorise apparaissent.
- **Fichier** : informations sur l'entreprise, exercice comptable, sauvegardes, raccourcis clavier, aide, déconnexion.
- **Menu latéral** : tous les écrans, par module ; cliquez sur un module pour le déplier.
- **Onglets des documents** : chaque écran ouvert reste disponible au-dessus de la zone de travail ; la croix le ferme.
- **Panneau de détail** (Écritures) : cliquez sur une ligne pour voir son détail à droite ; double-clic ou Entrée ouvre la fiche.
- **Tableau de bord** : synthèse du jour, courbe des ventes et des encaissements sur six mois (survolez un mois pour voir les montants), trésorerie par compte, brouillards à valider par journal, documents récents et détail de la facture choisie. Chaque bloc n'apparaît qu'avec les droits correspondants.
- **Barre d'état** (en bas) : entreprise, exercice, utilisateur, connexion au serveur, brouillards à valider, somme de la sélection, zoom de la zone de travail.

**Raccourcis** : Alt+N nouvelle facture, Alt+R règlement, Alt+D dépense, Alt+T transfert, Alt+E saisie d'écriture, Alt+B balance, Alt+G grand livre, Alt+L ventes en direct, Alt+V vérifier une facture, F9 valider la sélection (Écritures), Ctrl+F rechercher, F1 aide, Échap fermer. Dans un tableau, les flèches passent d'une ligne à l'autre et Entrée ouvre la ligne.

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

- **Ajouter** : nom, e-mail, rôles, et une date de fin d'accès si besoin (stagiaire, auditeur externe). Une **fiche d'accès** s'affiche **une seule fois** : adresse du serveur à ouvrir sur le poste du collaborateur, code entreprise, e-mail, code d'invitation (5 groupes de 4 caractères, sans 0, O, 1, I ni L) et date limite (72 heures). Imprimez-la ou recopiez-la et remettez-la en main propre. Le collaborateur n'installe rien sur son poste : il ouvre l'adresse du serveur dans son navigateur et choisit « J'ai reçu un code d'invitation ».
- Si le code est refusé, le message en donne la raison (déjà utilisé, remplacé par un code plus récent, expiré, code de réinitialisation saisi à la place) ou rappelle quoi vérifier, avec le nom du serveur interrogé.
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

## 6. Entreprise : profil, logo, couleurs et code maître

Menu **Entreprise** (administrateur). Le profil est la **seule source** des informations de l'entreprise : en-tête des factures, avoirs et reçus, en-tête des états imprimés (journal, grand livre, balance), barre de titre. Rien n'est écrit en dur ailleurs dans le logiciel.

Les informations sont réparties en rubriques :

- **Identité** : raison sociale (obligatoire), nom commercial, sigle, slogan, forme juridique, capital social, date de création.
- **Coordonnées** : adresse, quartier, arrondissement ou commune, ville, boîte postale, région, téléphones, e-mail, site web. Le pays est fixé à la création de l'espace.
- **Juridique et fiscal** : RCCM, NIU, numéro de contribuable, patente, autres identifiants (CNPS…), régime fiscal, numéro de TVA, référentiel comptable. La rubrique rappelle aussi la devise, le taux de TVA et l'exercice en cours, qui se règlent dans *Comptabilité › Exercices et paramètres*.
- **Banque et paiement** (facultatif) : banque, titulaire, RIB ou IBAN, moyens de paiement acceptés.
- **Documents** : logo, cachet ou signature scannée, couleurs, mention d'en-tête, pied de page, format de papier (A4 ou Lettre US), et ce qu'il faut imprimer (téléphones, e-mail, site, slogan, banque, moyens de paiement, cachet). La raison sociale, le NIU et le RCCM s'impriment toujours lorsqu'ils sont renseignés.
- **Sécurité** : double authentification obligatoire, délai d'inactivité, code maître.

Tous les champs sauf la raison sociale sont facultatifs. Un champ vide n'est pas imprimé : le logiciel n'invente jamais de numéro ni de lien. Les formats sont contrôlés à l'enregistrement (e-mail, téléphone de 6 à 15 chiffres, site web) ; le champ en erreur est signalé en rouge et sa rubrique s'ouvre.

Un seul bouton **Enregistrer le profil** enregistre toutes les rubriques. Si la raison sociale, le NIU, le RCCM ou la forme juridique changent, le logiciel demande une confirmation. À droite, l'**aperçu** montre l'en-tête et le pied d'un document émis aujourd'hui.

Le **logo** et le **cachet** sont enregistrés dès leur envoi (PNG ou JPEG, réduits automatiquement à 300 pixels). Ils sont conservés dans la base de l'entreprise : ils restent après la fermeture du logiciel ou un redémarrage de l'ordinateur.

**Documents déjà émis.** Chaque facture, avoir ou reçu garde l'identité de l'entreprise du jour de son émission (nom, coordonnées, logo, couleurs). Modifier le profil ne change donc que les **nouveaux** documents ; réimprimer une ancienne facture reproduit l'ancien en-tête. C'est voulu : un document remis à un client ou à l'administration ne doit pas changer après coup.

Les autres utilisateurs voient le nouveau nom dès qu'ils changent d'écran, sans se reconnecter.

Le **code maître** sert uniquement à rétablir l'accès d'un administrateur bloqué, depuis l'écran de connexion (« Administrateur bloqué : utiliser le code maître »). Il est à usage unique : générez-en un nouveau après chaque utilisation. Conservez-le imprimé, sous enveloppe scellée, chez le dirigeant.

## 7. Comptabilité générale

Menu **Comptabilité**, visible avec le droit de consultation comptable. Voir aussi `COMPTABILITE.md` pour les règles et leurs limites.

- **Saisir une écriture** : *Écritures* → *Nouvelle écriture*. Choisissez le journal, la date, la référence de la pièce et le libellé, puis les lignes (compte, débit ou crédit). Les totaux et l'écart se mettent à jour en direct ; *Reporter l'écart* complète la dernière ligne vide. L'écriture est enregistrée en **brouillard**, même déséquilibrée.
- **Valider** : une autre personne habilitée (par défaut le DAF) ouvre le brouillard et clique sur *Valider*. Il faut un écart nul et la ressaisie du mot de passe. L'écriture reçoit alors le numéro suivant du journal et ne peut plus être modifiée.
- **Corriger une écriture validée** : *Extourner*, avec un motif. Une écriture inverse annule l'effet de l'originale, qui reste dans les livres. Saisissez ensuite l'écriture correcte.
- **Grand livre** et **Balance générale** : filtrez par exercice, période, compte (début de numéro) ou journal. Une balance complète doit être équilibrée. Si des comptes protégés vous sont masqués, la balance est signalée « partielle ».
- **Plan comptable** : la liste fournie est restreinte et marquée « À vérifier ». Le DAF peut ajouter des sous-comptes, archiver un compte ou importer le plan officiel en CSV.
- **Exercices et paramètres** : création et clôture (définitive) des exercices, séparation saisie / validation, comptes protégés.

## 8. Ventes, factures et caisse

Menu **Ventes et trésorerie**. C'est ici que s'enregistrent les opérations de tous les jours, sans connaître le plan comptable.

- **Vendre ou facturer une prestation** : *Nouvelle vente*. Choisissez *Vente de marchandises* ou *Prestation de services* (une même facture peut mélanger les deux, ligne par ligne). Saisissez le client (ou laissez « Client comptant »), les lignes, puis le mode de paiement : *Payé maintenant* dans une caisse, ou *À crédit*. Les totaux HT, TVA et TTC se calculent en direct.
- **Imprimer la facture** : après *Émettre la facture*, la fiche s'ouvre ; *Imprimer la facture* ouvre directement la boîte d'impression avec le PDF. *Ouvrir le PDF* permet de l'enregistrer ou de l'envoyer.
- **Une facture émise ne se modifie pas.** Son numéro est définitif. Une erreur, un retour de marchandise ou une annulation se traitent par un **avoir** (voir plus bas).
- **Encaisser une facture à crédit** : sur la fiche de la facture, *Enregistrer un règlement* (paiement partiel possible).
- **Dépenses et autres recettes** : *Caisses et banques* → *Dépense* ou *Encaissement*. On choisit une catégorie (fournitures, transport, loyer…) : le compte comptable est déduit. La TVA récupérable se saisit sur les dépenses qui y sont soumises.
- **Transfert** entre caisse, banque et mobile money : *Transfert*.
- **Erreur sur un mouvement** : le DAF l'annule avec un motif. Le mouvement d'origine reste visible avec son annulation.
- **Caissier** : il ne voit et n'utilise que la caisse qui lui est attribuée (par le DAF, *Caissiers* sur la carte de la caisse). Une caisse ne peut pas passer en négatif.

**Avoirs** : sur la fiche de la facture, *Établir un avoir* (réservé au directeur financier par défaut, droit « Ventes : annuler »). On indique, ligne par ligne, la quantité à créditer (le bouton *Tout le reste* annule ce qui reste de la facture), le motif et la date. Le logiciel affiche le montant HT, la TVA et le total de l'avoir. Si le client a déjà payé plus que ce qu'il doit après l'avoir, on peut le rembourser depuis une caisse ou une banque ; sinon, l'avoir réduit simplement ce qu'il doit. L'avoir reçoit son propre numéro (AV-AAAA-NNNNN), s'imprime comme une facture (logo, en-tête, code QR) et se retrouve dans *Ventes → Avoirs*. On ne peut jamais créditer plus que ce qui a été facturé.

**Côté comptabilité** : chaque vente et chaque mouvement produit une écriture en brouillard. Dans *Écritures*, filtrez *Origine : Ventes et trésorerie*, cochez les brouillards et cliquez sur *Valider la sélection*. Ces écritures ne se modifient pas à la main : on corrige l'opération d'origine.

**Ventes en direct** : la liste des factures du jour, toutes caisses confondues, avec le chiffre d'affaires, l'encaissé et le crédit. Elle se met à jour seule toutes les 5 secondes ; une nouvelle facture apparaît surlignée.

**Vérifier une facture** : scannez le code QR imprimé sur une facture ou un avoir, avec la caméra du poste (en HTTPS), avec une douchette USB (cliquer dans le champ puis scanner) ou en collant le code. Le résultat dit si la facture est authentique, et sinon pourquoi (montant modifié, faux code, autre entreprise).

**Paramètres fiscaux** (*Exercices et paramètres*) : TVA applicable ou non, taux, mentions imprimées sur les factures. Le taux de la démonstration (19,25 %) est à vérifier dans la loi de finances en vigueur.

## 9. Mon compte

Changez votre mot de passe (vos autres sessions sont alors fermées), activez la double authentification et fermez les sessions que vous ne reconnaissez pas.
