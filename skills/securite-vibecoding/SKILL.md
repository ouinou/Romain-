---
name: securite-vibecoding
description: Audit et sécurisation d'une application web codée vite (vibe coding) avant sa mise en ligne. Couvre 25 points - authentification, mots de passe, clés d'API et secrets, base de données et requêtes paramétrées, HTTPS, en-têtes de sécurité, CORS, CSRF, XSS, cookies de session, limite de requêtes, routes admin, validation serveur, envoi de fichiers, prix et paiements, mode debug, dépendances vulnérables ou inutiles, fichiers exposés, secrets dans l'historique Git, rotation des clés, journalisation des activités suspectes. Utiliser quand l'utilisateur demande de « sécuriser mon app », « audit de sécurité », « avant de mettre en prod », « cacher mes clés », « j'ai fuité une clé », ou cite un de ces points.
---

# Sécuriser une app avant la mise en ligne

Ce skill sert à passer une application au crible, point par point, puis à corriger ce qui doit l'être. Il vise surtout les projets montés rapidement avec une IA : ça marche, mais personne n'a vérifié ce qui se passe quand quelqu'un essaie de casser le site.

Deux règles avant de commencer :

- **On lit avant de corriger.** Chaque point commence par une vérification dans le code réel du projet. Pas de correctif appliqué « au cas où » sur un point qui est déjà bon.
- **Rien d'irréversible sans accord explicite.** Réécrire l'historique Git, supprimer des paquets, révoquer une clé, modifier une base en production : on montre ce qu'on va faire et on attend un oui.

## Étape 1 — Comprendre le projet

Avant toute chose, identifier :

1. Le langage et le framework (lire `package.json`, `requirements.txt`, `pyproject.toml`, `composer.json`, `go.mod`, `Gemfile`…).
2. Où tourne le code : serveur à soi (Express, Django, Flask, Laravel…), framework full-stack (Next.js, Nuxt, SvelteKit, Remix), site statique + BaaS (Supabase, Firebase, Appwrite), fonctions serverless.
3. Où est la base de données et comment on y accède (ORM, SQL brut, client Supabase depuis le navigateur…).
4. Comment le site est déployé (Vercel, Netlify, Render, Railway, VPS, Docker…).
5. S'il y a des paiements, un espace admin, de l'envoi de fichiers.

Résumer ça en 5 lignes à l'utilisateur. La suite dépend beaucoup de cette carte : un site statique branché sur Supabase ne se sécurise pas comme une API Express.

> Cas fréquent en vibe coding : **le navigateur parle directement à la base** (Supabase, Firebase). Dans ce cas, la vraie sécurité est dans les règles de la base (RLS, Security Rules), pas dans le code JavaScript, que n'importe qui peut lire et modifier.

## Étape 2 — Lancer l'audit automatique

Depuis la racine du projet :

```bash
bash <chemin-du-skill>/scripts/audit.sh
```

Le script ne modifie rien. Il cherche : secrets dans les fichiers et dans tout l'historique Git, fichiers sensibles exposés, `.env` suivi par Git, mode debug actif, dépendances vulnérables, paquets inutilisés, configuration CORS trop ouverte, requêtes SQL construites par concaténation, usages dangereux du HTML (`innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `|safe`), cookies sans attributs de sécurité.

Il utilise `gitleaks`, `npm audit`, `pip-audit`, `depcheck` s'ils sont disponibles, et retombe sur des recherches par motifs sinon. Les résultats par motifs donnent des faux positifs : **chaque alerte doit être confirmée en lisant le fichier** avant d'en parler comme d'un problème.

## Étape 3 — Passer les 25 points

Suivre `references/checklist.md`, dans l'ordre. Pour chaque point, le fichier donne : ce qu'on vérifie, à quoi ressemble un problème, et le correctif selon la stack. Les exemples de code sont dans `references/exemples.md`.

Ordre de priorité, du plus urgent au moins urgent :

| Priorité | Points |
|---|---|
| **Critique** — à traiter avant toute mise en ligne | Secrets fuités et rotation des clés (24, 25, 2), base de données ouverte (3), requêtes paramétrées (10), routes admin (9), authentification et mots de passe (1, 5), prix et paiements (19) |
| **Haute** | Validation serveur (6), XSS (7), CSRF (16), cookies de session (15), réinitialisation de mot de passe (17), envoi de fichiers (18), mode debug (20), fichiers exposés (23) |
| **Normale** | HTTPS (4), en-têtes (14), CORS (13), limite de requêtes (12), variables d'environnement (11), journalisation (8), dépendances (21, 22) |

Si un secret a fuité (point 24), on s'arrête et on traite ça d'abord : tant que la clé n'est pas révoquée, le reste ne sert pas à grand-chose.

## Étape 4 — Corriger

- Faire les corrections une par une, avec un commit par thème (`sécurité : en-têtes HTTP`, `sécurité : requêtes paramétrées`…). Ça permet de revenir en arrière proprement si une correction casse quelque chose.
- Préférer les outils éprouvés du framework (Helmet, `express-rate-limit`, `csurf`/double-submit, `bcrypt`/`argon2`, Zod/Joi/Pydantic, le middleware CSRF de Django…) plutôt que du code maison.
- Ne jamais coder sa propre authentification « from scratch » quand un fournisseur sérieux est déjà dans le projet (Supabase Auth, Auth.js/NextAuth, Clerk, Django auth, Laravel Breeze…). Le brancher correctement.
- Après chaque correction, relancer l'app ou les tests pour vérifier que rien n'est cassé.

Ce qu'on **ne fait pas soi-même** et qu'on demande à l'utilisateur :

- Révoquer une clé chez le fournisseur (Stripe, OpenAI, AWS, Supabase…) : seul le propriétaire du compte peut le faire. Donner le lien exact de la page et l'ordre des opérations.
- Réécrire l'historique Git et forcer le push : expliquer les conséquences (tous les clones doivent être refaits), puis attendre son accord.
- Changer la configuration d'un hébergeur ou d'une base en production.

## Étape 5 — Rendre compte

Terminer par un rapport court, en trois blocs :

1. **Corrigé** : ce qui a été changé, avec les fichiers.
2. **À faire par toi** : les actions que seul l'utilisateur peut faire (rotation de clés, réglages d'hébergeur, variables d'environnement à créer en production).
3. **Non vérifiable d'ici** : ce qui dépend de la prod ou d'un service externe (HTTPS réel, règles de la base en ligne, webhooks de paiement). Dire comment le vérifier.

Ne pas déclarer un projet « sécurisé ». Dire ce qui a été vérifié et ce qui reste. Un audit de ce type ne remplace pas un test d'intrusion fait par quelqu'un dont c'est le métier, surtout dès qu'il y a de l'argent ou des données personnelles en jeu.
