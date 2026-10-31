# Sauvegarde, restauration et continuité

## Deux niveaux complémentaires

| | pgBackRest | Restic |
|---|---|---|
| Nature | copie physique du cluster + archivage continu des WAL | export logique `pg_dump` + pièces jointes et configuration |
| Sert à | revenir à une minute précise (erreur de manipulation, panne disque) | restaurer sur une autre machine, une autre version, ou une seule table |
| Chiffrement | AES-256-CBC (mot de passe du dépôt dans Vault) | AES-256 (Restic) |
| Rétention | 4 complètes, 14 différentielles | 7 quotidiennes, 4 hebdomadaires, 12 mensuelles |
| État dans cette livraison | configuré, **non exécuté** | **exécuté et vérifié** |

Au moins une copie doit sortir du bâtiment (dépôt S3 ou disque emporté). Un incendie ou un vol de serveur ne doit pas emporter les sauvegardes avec lui.

## Planification proposée (cron de l'hôte)

```cron
# pgBackRest : complète le dimanche, différentielle les autres jours
30 1 * * 0   docker compose -f /opt/rtms/infra/compose.prod.yml exec -T postgres pgbackrest --stanza=rtms --type=full backup
30 1 * * 1-6 docker compose -f /opt/rtms/infra/compose.prod.yml exec -T postgres pgbackrest --stanza=rtms --type=diff backup
# Restic : export logique chiffré, hors site
15 2 * * *   /opt/rtms/infra/backup/backup.sh >> /var/log/rtms-backup.log 2>&1
# Test de restauration automatique chaque lundi
0 5 * * 1    /opt/rtms/infra/backup/restore-test.sh >> /var/log/rtms-restore-test.log 2>&1 || /usr/local/bin/alerte-rtms "Test de restauration en échec"
```

_[À compléter : moyen d'alerte réel — e-mail, SMS, Slack — et la personne qui la reçoit.]_

## Ce que vérifie `restore-test.sh`

1. récupère le dernier instantané Restic et contrôle son empreinte SHA-256 ;
2. restaure dans une base jetable (`rtms_restore_test`) avec arrêt à la première erreur ;
3. compte les lignes des tables principales ;
4. liste les migrations appliquées ;
5. vérifie la chaîne d'audit de chaque société ;
6. supprime la base jetable.

Résultat obtenu le 31/10/2026 après le test de charge :

```
  companies : 1 ligne(s)
  users : 101 ligne(s)
  records : 1278 ligne(s)
  audit_log : 1379 ligne(s)
  migrations : 0001_init,0002_security,0003_audit_chain_order
RESTAURATION VÉRIFIÉE : rtms-20261031T160100Z.dump
```

Ce test a d'ailleurs révélé le défaut de chaînage d'audit corrigé par la migration 0003 : c'est exactement son rôle.

## Restauration en cas d'incident

**Retour à un instant précis (pgBackRest)** — serveur arrêté :

```bash
pgbackrest --stanza=rtms --delta --type=time "--target=2026-11-02 14:30:00+01" --target-action=promote restore
```

**Restauration logique (Restic)** :

```bash
restic restore latest --tag rtms --target /tmp/restore
```

```bash
pg_restore --clean --if-exists --no-owner --dbname=rtms /tmp/restore/.../rtms-AAAAMMJJTHHMMSSZ.dump
```

Après toute restauration : vérifier l'intégrité du journal (Paramètres → Journal d'audit → Vérifier), prévenir les utilisateurs de la période perdue, et noter l'incident.

Objectifs proposés, **à valider avec la direction** : perte de données maximale (RPO) 5 minutes avec pgBackRest, 24 h avec Restic seul ; remise en service (RTO) 4 heures.

## Réplication

Pour un seul site et quelques dizaines d'utilisateurs, un serveur avec sauvegardes testées suffit. La réplication en flux (`max_wal_senders` déjà configuré) devient utile si l'arrêt du logiciel pendant une restauration n'est pas acceptable. Elle suppose un second serveur ; à décider selon le budget.

## Politique de conservation

| Donnée | Durée proposée | Mécanisme |
|---|---|---|
| Factures, écritures financières | **10 ans** (Acte uniforme OHADA relatif au droit comptable — **à faire confirmer par le comptable**) | jamais purgées automatiquement ; annulation tracée au lieu de suppression |
| Journal d'audit | durée de vie de l'application | immuable ; archivé via les sauvegardes |
| Sessions | 12 h max | expiration Redis |
| Journaux techniques (Loki) | 90 jours | `retention_period` |
| Événements du serveur de licences | 2 ans (sauf révocations et suspensions) | `npm run retention` |
| Sauvegardes Restic | 12 mois glissants | `restic forget` |

_[À compléter : obligations légales tchadiennes spécifiques, durée de conservation des données du personnel, procédure de demande d'accès ou de suppression par une personne concernée.]_
