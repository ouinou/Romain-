# FINEXA PHARMA : sécurité, ce qui est en place et ce qui ne l'est pas

Ce document dit ce que le logiciel protège réellement, et où sont les limites. Il ne promet pas d'inviolabilité absolue.

Le socle de sécurité (comptes, sessions, double authentification, journal chaîné, sauvegardes chiffrées) est repris de FINEXA ERP 0.3.1, où il a été testé. Ce qui est propre à PHARMA est décrit dans la section « Stock : ce que la base garantit ».

## Stock : ce que la base garantit

- **Le stock d'un lot est la somme de ses mouvements.** Il n'existe pas de champ « quantité » modifiable : on ne peut pas « corriger » un stock sans laisser de mouvement.
- **Mouvements en ajout seul.** Un déclencheur refuse toute modification ou suppression d'un mouvement, même pour le propriétaire des tables. Une erreur se corrige par un ajustement motivé.
- **Pas de stock négatif.** La base refuse un mouvement qui ferait passer un lot sous zéro, avec un verrou par lot pour que deux postes ne vendent pas la même dernière boîte.
- **Numérotation continue** des mouvements (`MVT-AAAA-NNNNN`) et des inventaires (`INV-AAAA-NNN`), attribuée par la base.
- **Lots figés.** Numéro, produit, date de péremption et prix d'achat d'un lot enregistré ne se modifient pas ; seuls son statut (disponible, bloqué, rappelé), le motif et l'emplacement changent, et chaque changement est tracé.
- **Inventaire figé à la clôture.** Les lignes d'un inventaire validé ou annulé ne se modifient plus.
- **Opérations sensibles** (mot de passe ressaisi) : ajustement de stock, validation d'inventaire, levée d'un rappel de lot.
- **Valeur du stock** : affichée seulement aux rôles qui ont « Rapports : lire » ou « Stock : valider ». Le vendeur et le caissier ne la voient pas.
- **Séparation des droits** : le vendeur et le caissier consultent le stock mais n'y font aucune entrée ni aucun ajustement ; le gestionnaire de stock entre les lots et ajuste ; l'administrateur gère les comptes sans toucher au stock par défaut.

Limite : ces garanties tiennent tant que personne ne contrôle à la fois le compte `postgres` et le logiciel (voir le journal d'audit ci-dessous). Une sauvegarde d'un autre logiciel FINEXA (signature `FXPH1` propre à PHARMA) est refusée à la restauration.

## Licence

La licence de FINEXA PHARMA n'est pas encore en place (étape prévue après la validation du socle). Elle sera indépendante de celle de FINEXA ERP. Règle déjà fixée : **l'expiration d'une licence ne supprimera jamais les données** de la pharmacie. La conception prévoit, à l'expiration, un passage en consultation seule ; ce comportement reste à valider.

## Authentification

| Mesure | Détail |
|---|---|
| Mots de passe | Argon2id. Au moins 12 caractères, sans l'e-mail ni le nom. Pas de règle « 1 majuscule + 1 symbole », qui pousse à des mots de passe prévisibles (NIST SP 800-63B). |
| Énumération des comptes | Même message et temps de calcul comparable pour « pharmacie inconnue », « compte inconnu » et « mauvais mot de passe ». |
| Tentatives répétées | 5 échecs consécutifs → compte bloqué 15 min, trace et notification aux administrateurs. 30 essais par adresse IP sur 10 min, tous comptes confondus. |
| Double authentification | TOTP à 6 chiffres. Obligatoire par défaut pour l'administrateur, le pharmacien titulaire, le pharmacien adjoint et l'auditeur. Un code déjà utilisé est refusé. Le secret est chiffré en AES-256-GCM. |
| Sessions | Jeton aléatoire de 256 bits dans un cookie HttpOnly et SameSite=Strict ; seule son empreinte est stockée. Fermeture après 15 min d'inactivité ou 10 h au total. |
| Codes d'invitation et de réinitialisation | 20 caractères tirés parmi 31 (environ 99 bits), présentés en 5 groupes de 4, sans caractères ambigus, pour être recopiés à la main. Usage unique, 72 h (invitation) ou 30 min (réinitialisation), tentatives limitées par adresse ; seule l'empreinte est stockée. Un code refusé n'indique jamais si la pharmacie existe ; le détail (déjà utilisé, remplacé, expiré, mauvais type) n'est donné qu'à qui présente un vrai code. |
| Révocation | Immédiate lors d'une désactivation, d'un changement ou d'une réinitialisation de mot de passe, ou sur demande d'un administrateur. |
| Invitations et réinitialisations | Codes à usage unique (72 h pour une invitation, 30 min pour une réinitialisation), remis en main propre. Aucun serveur de messagerie n'est nécessaire. |
| Accès temporaires | Date de fin d'accès par utilisateur (stagiaire, auditeur externe). |
| Comptes inutilisés | Désactivés automatiquement à la tentative de connexion après 90 jours sans usage (réglable, 0 = jamais). Le dernier administrateur actif n'est jamais désactivé ainsi. |
| Opérations sensibles | Mot de passe, et code MFA s'il est actif, ressaisis dans les 5 dernières minutes : désactivation, réactivation, déverrouillage, changement de rôles ou de permissions, réinitialisation, fermeture de sessions, export du journal, paramètres de sécurité, nouveau code maître. Les échecs comptent pour le verrouillage. |
| Code maître | Secret de récupération propre à la pharmacie (environ 119 bits), haché en Argon2id, affiché une seule fois. Il rétablit l'accès d'un administrateur actif et rien d'autre : il réinitialise sa MFA, ferme ses sessions et délivre un code de réinitialisation de 30 min. Usage unique, 5 essais puis blocage d'une heure, notification à tous les administrateurs. Ce n'est pas une porte dérobée : l'éditeur ne le connaît pas, il n'est pas dans le code et il ne donne accès à aucune donnée. |
| Comportement inhabituel | Connexion depuis une adresse IP jamais utilisée par ce compte en 90 jours → événement `unusual_login` et notification. |
| CSRF | SameSite=Strict, plus un en-tête `X-GC-Requete` exigé sur toute requête qui modifie. |

## Journal d'audit

**Ce qui est enregistré :** connexions, déconnexions, échecs, verrouillages, accès refusés, créations et désactivations de comptes, changements de rôles et de permissions (avant/après), paramètres, exports, vérifications d'intégrité, tentatives de modification du journal. Le catalogue et le stock ajoutent les leurs : création et modification de produit (prix avant/après), changement de statut, entrée de stock, ajustement avec motif, blocage ou rappel de lot, ouverture, validation et annulation d'inventaire, exports CSV, import de catalogue, paramètres de la pharmacie.

**Pour chaque événement :** identifiant unique, numéro de séquence par pharmacie, date et heure du serveur, entreprise, utilisateur, session, adresse IP, type, action, objet, résultat, valeur avant, valeur après, motif, empreinte précédente et empreinte propre.

**Protections, de la plus simple à la plus forte :**

1. Le compte applicatif `gc_app` n'a ni UPDATE, ni DELETE, ni TRUNCATE sur la table.
2. Un déclencheur refuse toute modification ou suppression, même pour le propriétaire des tables.
3. La base impose elle-même l'horodatage, la séquence et l'empreinte : le serveur ne peut pas les falsifier.
4. Chaque empreinte inclut la précédente. Modifier ou supprimer un événement au milieu rompt la chaîne, et la vérification (`GET /api/audit/integrite` ou `npm run journal:verifier`) le signale.
5. **Ancrages** : `journal:verifier` note la dernière séquence et son empreinte dans un fichier hors de la base. À la vérification suivante, la suppression des derniers événements, ou un recalcul complet de la chaîne, est détectée.
6. **Copie externe** : avec `GC_DOSSIER_COPIE_JOURNAL`, le même outil recopie chaque nouvel événement (fichiers JSONL, un par pharmacie) sur un support distinct. Il vérifie aussi que le dernier événement copié est toujours identique en base.

**Ce qui n'est jamais écrit dans les journaux :** mots de passe (justes ou faux), jetons de session, codes d'invitation ou de réinitialisation, code maître, secrets MFA. Un test automatisé le vérifie.

**Limite à connaître.** Un superutilisateur PostgreSQL, ou quelqu'un qui a un accès administrateur au serveur Windows, peut désactiver les déclencheurs, réécrire la table et recalculer toutes les empreintes. Les points 1 à 4 ne l'arrêtent pas. Seuls les points 5 et 6 le révèlent, **à condition que les ancrages et la copie soient conservés ailleurs** : clé USB rangée, autre machine, ou impression signée après chaque inventaire. Les sauvegardes externes jouent le même rôle. C'est pour cela que le mot de passe `postgres` et le compte administrateur Windows ne doivent pas être détenus par les mêmes personnes que l'administration fonctionnelle du logiciel.

## Séparation des responsabilités

| Rôle | Qui | Ce qu'il peut faire |
|---|---|---|
| Administration fonctionnelle | Rôle « Administrateur » dans le logiciel | Comptes, rôles, paramètres. Lit le journal, ne peut pas le modifier. Consulte le catalogue ; ne touche pas au stock par défaut. |
| Consultation du journal | Administrateur, pharmacien titulaire, auditeur | Lecture et export (tracés). |
| Administration technique | Personne qui détient le compte Windows et `postgres` | Installation, mises à jour, sauvegardes, restaurations. Ne devrait pas avoir de compte dans le logiciel. |

## Logo

PNG ou JPEG uniquement, 512 Kio au plus, type vérifié sur les premiers octets du fichier. Le SVG est refusé, car il peut contenir du script. Les versions successives sont conservées en ajout seul.

## Sauvegardes

Sauvegarde complète avec `pg_dump`, faite par un rôle en lecture seule, puis chiffrée en AES-256-GCM et accompagnée de son empreinte SHA-256. La restauration vérifie l'empreinte, le chiffrement authentifié rejette tout fichier modifié, et elle refuse d'écrire dans une base non vide.

La clé `GC_CLE_SAUVEGARDE` doit être conservée hors du serveur. Si elle est perdue, les sauvegardes sont illisibles. Si elle est volée en même temps qu'une sauvegarde, les données sont exposées.

## Ce qui n'est pas encore en place

- HTTPS est configuré par le setup Windows. Une installation manuelle sans certificat ferait circuler les mots de passe en clair sur le réseau local.
- Les sauvegardes couvrent toute la base. Une pharmacie par installation est le cas prévu.
- La détection de comportements inhabituels se limite au nouveau poste et aux échecs répétés. Les connexions hors horaires et les volumes d'export anormaux sont à ajouter.
- Le journal système (événements sans entreprise) est en ajout seul, mais pas chaîné.
- Aucun audit de sécurité externe n'a été réalisé. Il est recommandé avant toute utilisation sur des données réelles.
