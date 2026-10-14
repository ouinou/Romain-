# Sécurité : ce qui est en place, et ce qui ne l'est pas

Ce document dit ce que le logiciel protège réellement, et où sont les limites. Il ne promet pas d'inviolabilité absolue.

## Authentification

| Mesure | Détail |
|---|---|
| Mots de passe | Argon2id. Au moins 12 caractères, sans l'e-mail ni le nom. Pas de règle « 1 majuscule + 1 symbole », qui pousse à des mots de passe prévisibles (NIST SP 800-63B). |
| Énumération des comptes | Même message et temps de calcul comparable pour « entreprise inconnue », « compte inconnu » et « mauvais mot de passe ». |
| Tentatives répétées | 5 échecs consécutifs → compte bloqué 15 min, trace et notification aux administrateurs. 30 essais par adresse IP sur 10 min, tous comptes confondus. |
| Double authentification | TOTP à 6 chiffres. Obligatoire par défaut pour les rôles sensibles (administrateur, DG, DAF, auditeur, RH). Un code déjà utilisé est refusé. Le secret est chiffré en AES-256-GCM. |
| Sessions | Jeton aléatoire de 256 bits dans un cookie HttpOnly et SameSite=Strict ; seule son empreinte est stockée. Fermeture après 15 min d'inactivité ou 10 h au total. |
| Révocation | Immédiate lors d'une désactivation, d'un changement ou d'une réinitialisation de mot de passe, ou sur demande d'un administrateur. |
| Invitations et réinitialisations | Codes à usage unique (72 h pour une invitation, 30 min pour une réinitialisation), remis en main propre. Aucun serveur de messagerie n'est nécessaire. |
| Accès temporaires | Date de fin d'accès par utilisateur (stagiaire, auditeur externe). |
| Comportement inhabituel | Connexion depuis une adresse IP jamais utilisée par ce compte en 90 jours → événement `unusual_login` et notification. |
| CSRF | SameSite=Strict, plus un en-tête `X-GC-Requete` exigé sur toute requête qui modifie. |

## Journal d'audit

**Ce qui est enregistré :** connexions, déconnexions, échecs, verrouillages, accès refusés, créations et désactivations de comptes, changements de rôles et de permissions (avant/après), paramètres, exports, vérifications d'intégrité, tentatives de modification du journal. Les modules métier ajouteront leurs propres événements (écritures, validations, annulations…).

**Pour chaque événement :** identifiant unique, numéro de séquence par entreprise, date et heure du serveur, entreprise, utilisateur, session, adresse IP, type, action, objet, résultat, valeur avant, valeur après, motif, empreinte précédente et empreinte propre.

**Protections, de la plus simple à la plus forte :**

1. Le compte applicatif `gc_app` n'a ni UPDATE, ni DELETE, ni TRUNCATE sur la table.
2. Un déclencheur refuse toute modification ou suppression, même pour le propriétaire des tables.
3. La base impose elle-même l'horodatage, la séquence et l'empreinte : le serveur ne peut pas les falsifier.
4. Chaque empreinte inclut la précédente. Modifier ou supprimer un événement au milieu rompt la chaîne, et la vérification (`GET /api/audit/integrite` ou `npm run journal:verifier`) le signale.
5. **Ancrages** : `journal:verifier` note la dernière séquence et son empreinte dans un fichier hors de la base. À la vérification suivante, la suppression des derniers événements, ou un recalcul complet de la chaîne, est détectée.

**Limite à connaître.** Un superutilisateur PostgreSQL, ou quelqu'un qui a un accès administrateur au serveur Windows, peut désactiver les déclencheurs, réécrire la table et recalculer toutes les empreintes. Les points 1 à 4 ne l'arrêtent pas. Seul le point 5 le révèle, **à condition que le fichier d'ancrages soit conservé ailleurs** : clé USB rangée, autre machine, ou impression signée lors des clôtures. Les sauvegardes externes jouent le même rôle. C'est pour cela que le mot de passe `postgres` et le compte administrateur Windows ne doivent pas être détenus par les mêmes personnes que l'administration fonctionnelle du logiciel.

## Séparation des responsabilités

| Rôle | Qui | Ce qu'il peut faire |
|---|---|---|
| Administration fonctionnelle | Rôle « Administrateur de l'entreprise » dans le logiciel | Comptes, rôles, paramètres. Lit le journal, ne peut pas le modifier. Aucun accès financier par défaut. |
| Consultation du journal | Administrateur, auditeur, DG | Lecture et export (tracés). |
| Administration technique | Personne qui détient le compte Windows et `postgres` | Installation, mises à jour, sauvegardes, restaurations. Ne devrait pas avoir de compte dans le logiciel. |

## Sauvegardes

Sauvegarde complète avec `pg_dump`, faite par un rôle en lecture seule, puis chiffrée en AES-256-GCM et accompagnée de son empreinte SHA-256. La restauration vérifie l'empreinte, le chiffrement authentifié rejette tout fichier modifié, et elle refuse d'écrire dans une base non vide.

La clé `GC_CLE_SAUVEGARDE` doit être conservée hors du serveur. Si elle est perdue, les sauvegardes sont illisibles. Si elle est volée en même temps qu'une sauvegarde, les données sont exposées.

## Ce qui n'est pas encore en place

- HTTPS est pris en charge, mais le certificat est à générer à l'installation (voir le guide). Sans lui, les mots de passe circulent en clair sur le réseau local.
- Les sauvegardes couvrent toute la base, pas une seule entreprise. Une restauration par entreprise demandera un outil dédié.
- La détection de comportements inhabituels se limite au nouveau poste et aux échecs répétés. Les connexions hors horaires et les volumes d'export anormaux sont à ajouter.
- Le journal système (événements sans entreprise) est en ajout seul, mais pas chaîné.
- Aucun audit de sécurité externe n'a été réalisé. Il est recommandé avant toute utilisation sur des données réelles.
