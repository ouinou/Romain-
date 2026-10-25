# Gestionnaire Comptable : analyse de la maquette admin (v0.4 → v0.5)

Fichiers : `original-v0.4.html` (version reçue), `index.html` (version corrigée).

## Défauts corrigés

| # | Problème dans la v0.4 | Effet | Correction v0.5 |
|---|---|---|---|
| 1 | La page Permissions cherchait « Non accordé » / « Interdit » dans le **titre** du droit, alors que ces mots sont dans la **description** | Tous les droits apparaissaient cochés, y compris « Supprimer les traces : Interdit » pour l'Auditeur | Chaque droit porte un état explicite : accordé, sous condition, non accordé |
| 2 | Rôle « Administrateur de l'entreprise » absent du formulaire utilisateur ; compteur « 8 rôles » écrit en dur alors qu'il y en a 9 | Incohérence visible | Une seule liste de rôles alimente le formulaire, la page et le compteur |
| 3 | Sous 700 px, la barre latérale est masquée et aucun menu ne la remplace | Navigation impossible sur téléphone | Menu déroulant dans la barre du haut |
| 4 | Le pied de page dit « données stockées dans le navigateur » alors que tout est perdu au rechargement | Texte faux | Sauvegarde locale réelle + bouton « Réinitialiser la démonstration » |
| 5 | Statut « En attente » affiché en rouge, comme « Désactivé » | Confusion | Orange, avec action « Valider l'accès » |
| 6 | Impossible de modifier un utilisateur (rôle, nom, e-mail) | Fonction manquante pour un admin | Bouton « Modifier », avec trace avant/après dans le journal |
| 7 | Déconnexion non journalisée ; code entreprise conservé | Trace d'audit incomplète | Déconnexion tracée, formulaire nettoyé |
| 8 | Limitation des tentatives et expiration de session annoncées mais absentes | Promesse non tenue dans la maquette | 5 essais puis blocage 30 s ; déconnexion après 10 min d'inactivité |
| 9 | Export CSV par téléchargement uniquement, URL révoquée immédiatement | Échoue sur certains navigateurs et dans un aperçu intégré | Panneau CSV avec « Copier » et « Télécharger » |
| 10 | Nom de l'entreprise modifiable mais affiché nulle part ; mode non conservé | Formulaire sans effet | Nom repris dans la barre latérale et le fil d'Ariane, paramètres conservés |
| 11 | Champs sans `for`/`id`, profils sélectionnables à la souris seulement, notifications non annoncées | Accessibilité clavier et lecteur d'écran faible | Libellés reliés, vrais boutons radio, `aria-live`, focus visible |
| 12 | Notifications qui se masquent trop tôt quand deux s'enchaînent | Détail d'ergonomie | Minuteur remis à zéro à chaque message |
| 13 | Pas de thème sombre, journal sans filtre | Confort | Thème sombre automatique, filtre du journal |

## Ce qui reste à faire (hors maquette)

Ces points ne peuvent pas être réglés dans une page HTML seule. Ils demandent un serveur et une base de données :

- authentification réelle (mots de passe hachés, idéalement double facteur pour les administrateurs) ;
- application des permissions côté serveur, à chaque requête ;
- isolation des données par entreprise ;
- journal d'audit non modifiable (table en ajout seul, ou signature des événements) ;
- invitation par e-mail et réinitialisation de mot de passe ;
- délégation fine : seuils de validation des dépenses, périmètres par service ;
- sauvegardes chiffrées et procédure de restauration testée ;
- règle « au moins un administrateur actif » pour éviter de se bloquer soi-même.

Le choix des codes de démonstration écrits dans la page est assumé : c'est une maquette. Ils ne doivent jamais servir de modèle pour la version réelle.
