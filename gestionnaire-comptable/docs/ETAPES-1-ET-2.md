# Étapes 1 et 2 : examen de l'existant et choix techniques

## 1. Maquette d'administration (`index.html`, v0.4 → v0.5)

La maquette est utile pour fixer l'organisation des écrans et le style. Elle ne protège aucune donnée et ne doit jamais être présentée comme le logiciel.

| Lacune | Gravité | Traitement |
|---|---|---|
| Codes d'accès écrits dans le code de la page (`GC-ITI-2026`, `DEMO-2026`), lisibles par n'importe qui | Bloquant pour un usage réel | Remplacés côté serveur par des comptes individuels avec mot de passe haché (Argon2id) |
| Un « code administrateur » unique, donc partagé entre plusieurs personnes | Bloquant | Un compte par personne ; le **code maître** ne sert qu'à la récupération d'accès et reste sous enveloppe |
| Permissions vérifiées seulement dans la page | Bloquant | Vérifiées par le serveur à chaque requête, et isolation par la base (RLS) |
| Journal stocké dans le navigateur, modifiable par l'utilisateur | Bloquant | Journal en base, en ajout seul, chaîné, vérifiable, copiable sur un support externe |
| Droits « Interdit » affichés comme accordés (corrigé en v0.5) | Erreur fonctionnelle | Corrigé dans la maquette ; droits réels définis côté serveur |
| Pas de navigation sur téléphone (corrigé en v0.5) | Ergonomie | Corrigé dans la maquette |
| Pas de double authentification, pas d'expiration réelle de session | Important | Implémentés côté serveur |

## 2. Schéma PostgreSQL fourni

Le schéma est conservé tel quel comme `migrations/001_schema_initial.sql`. Ses clés étrangères composites `(id, company_id)` sont un bon choix et ont été gardées.

| Lacune | Correction (migrations 002 et 003) |
|---|---|
| Isolation entre entreprises confiée au seul code applicatif | Row-Level Security sur toutes les tables, compte applicatif sans contournement |
| `previous_hash` / `event_hash` jamais calculés, et facultatifs | Calculés par la base à chaque insertion ; séquence par entreprise ; heure du serveur imposée |
| Journal modifiable et supprimable | Droits SQL retirés + déclencheur qui bloque toute modification, même par le propriétaire |
| `password_hash` obligatoire, donc pas d'invitation possible | Facultatif tant que le compte n'est pas actif |
| E-mail unique mais sensible à la casse | Index unique sur `lower(email)` |
| Statut `locked` en doublon avec `locked_until` | Verrouillage porté uniquement par la date |
| Pas de sessions, de jetons, de MFA, d'expiration d'accès | Tables et colonnes ajoutées |
| Permissions ad hoc (`users.disable`, `finance.transactions.correct`…) | Grille systématique 14 modules × 10 actions |
| Pas de séparation des droits SQL | Trois rôles : `gc_owner` (migrations), `gc_app` (serveur), `gc_backup` (sauvegardes) |
| Pas de code maître, pas de confirmation avant les opérations sensibles | Migration 003 |

## 3. Pile technique proposée (à approuver)

| Besoin | Choix | Alternatives écartées, et pourquoi |
|---|---|---|
| Serveur applicatif | **Node.js 22 LTS + TypeScript + Fastify 5** | *Python/Django* : très solide, mais l'ORM et l'admin intégrés se marient mal avec la RLS et les droits SQL fins voulus ici. *.NET* : excellent sous Windows, mais plus lourd à installer et à faire évoluer pour une petite équipe. *PHP* : demande un serveur web en plus (IIS/Apache) sous Windows. |
| Base de données | **PostgreSQL 16** | Imposée ; c'est aussi le seul choix courant qui offre la RLS. |
| Accès aux données | **SQL paramétré** (pilote `pg`), sans ORM | Requêtes lisibles et auditables, pas de requête générée implicitement qui contournerait une règle. Toutes les valeurs passent en paramètres, ce qui ferme la porte aux injections SQL. |
| Interface | **À décider** à l'étape 7 (proposition : React + Vite, compilée et servie par le même serveur) | Rien n'est installé sur les postes : un navigateur suffit. |
| Installation Windows | Service Windows (NSSM) + PostgreSQL local + certificat HTTPS local | Un installateur automatique viendra à l'étape 10. |

**Pourquoi Node.js + TypeScript ici :**
- une seule langue pour le serveur et la future interface ;
- un typage strict qui attrape beaucoup d'erreurs avant l'exécution ;
- une installation simple sous Windows ;
- des versions LTS maintenues 30 mois ;
- un écosystème très documenté.

Ce choix est réversible tant que les modules métier n'existent pas. Il le sera beaucoup moins ensuite.

## 4. Décisions qui demandent ton approbation

1. **La pile technique ci-dessus.**
2. **Le fonctionnement du code maître** : il sert uniquement à rétablir l'accès d'un administrateur actif. Il est à usage unique, haché, limité à 5 essais par heure, et chaque usage est notifié à tous les administrateurs. Il ne donne accès à aucune donnée et ne contourne pas le mot de passe : il permet seulement d'en choisir un nouveau.
3. **La réinitialisation hors ligne** : l'administrateur remet un code à usage unique en main propre, sans envoi d'e-mail.
4. **Les droits par défaut de chaque rôle** (`serveur/src/domaine/roles-systeme.ts`). Ils sont à relire avec un comptable ou un DAF.
5. **Les délais par défaut** : 15 min d'inactivité, sessions de 10 h, confirmation valable 5 min, désactivation après 90 jours sans connexion, 5 échecs avant blocage de 15 min.
