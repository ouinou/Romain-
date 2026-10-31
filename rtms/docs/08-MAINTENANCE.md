# Recommandations pour la maintenance

## Routine

| Fréquence | Tâche |
|---|---|
| Chaque jour | Regarder Grafana (erreurs 5xx, latence, échecs de connexion) et les alertes Wazuh. Vérifier que la sauvegarde de la nuit a réussi. |
| Chaque semaine | Lire le rapport du test de restauration automatique. Traiter les PR Dependabot de sécurité. |
| Chaque mois | Mettre à jour les images de base (Node, PostgreSQL, Redis, Caddy) via une version de correctif. Revoir la liste des utilisateurs actifs et leurs profils. Lancer « Vérifier l'intégrité du journal ». |
| Chaque trimestre | Restauration complète sur une machine de test, chronométrée. Revue des permissions par profil avec la direction. Test k6 sur l'environnement de test. |
| Chaque année | Rotation des clés de chiffrement et des mots de passe des rôles PostgreSQL. Audit de sécurité externe (test d'intrusion). Révision de la politique de conservation. |

## Quand quelque chose ne va pas

- **Un utilisateur est verrouillé** : le verrou tombe seul après le délai. Pour le lever plus tôt : Administration › Utilisateurs › « Déverrouiller ». Regarder d'abord le journal : ce n'est pas toujours la personne elle-même qui a fait les tentatives.
- **Téléphone perdu (MFA)** : utiliser un code de secours ; sinon l'administrateur utilise Administration › Utilisateurs › « Réinitialiser MFA », ce qui ferme toutes les sessions de la personne.
- **« Jeton CSRF invalide »** : la session a expiré ou a été remplacée par une reconnexion dans un autre onglet. Recharger la page.
- **Erreur 500** : le message donne une référence ; la retrouver dans Loki (`{container=~".*api.*"} |= "<référence>"`) ou Sentry.
- **Licence en consultation seule** : vérifier l'accès Internet du serveur vers le serveur de licences, puis l'état de l'abonnement.
- **Intégrité du journal en échec** : traiter comme un incident de sécurité. Ne rien modifier, sauvegarder l'état, prévenir la direction.

## Faire évoluer le code

- Toute modification de structure passe par une **nouvelle** migration dans `prisma/migrations/`. Ne jamais modifier une migration déjà déployée.
- Toute nouvelle route déclare sa permission (`requirePermission`) et passe par `withTenant()` pour bénéficier de la RLS.
- Toute écriture métier appelle `audit()` dans la même transaction.
- Ajouter le test qui casse avant de corriger un bogue.

## Prochaines étapes recommandées, par priorité

1. **Facture conforme au modèle RAHA** (PDF A4, montant en lettres, avances, numérotation automatique par exercice). C'est le critère de recette le plus visible du CdC. Il faut d'abord récupérer le modèle original et faire valider les mentions légales (RCCM, NIF, adresses, taux de TVA).
2. **Modèle relationnel** pour transport → facture → règlement → trésorerie, et pour les mouvements de stock. Migration des enregistrements génériques actuels vers ces tables.
3. **Pièces jointes** (gestion documentaire) avec stockage chiffré et contrôle d'accès, incluses dans la sauvegarde Restic (`RTMS_EXTRA_PATHS`).
4. **Écran de modification** des enregistrements (l'API existe déjà, avec verrou optimiste).
5. Décision sur l'**interface ruban type Word/Excel** demandée par l'addendum du CdC.
6. **Application de bureau** (Electron) pointant vers le serveur central, et installateurs Windows/macOS signés.
7. Script de ré-chiffrement pour la rotation des clés.
