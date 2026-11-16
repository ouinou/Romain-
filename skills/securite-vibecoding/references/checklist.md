# Les 25 points, un par un

Pour chaque point : **Vérifier** (ce qu'on lit dans le code), **Signes d'un problème**, **Corriger**. Les extraits de code complets sont dans `exemples.md`, référencés par leur numéro (ex. → E5).

Quand un point ne s'applique pas au projet (pas d'envoi de fichiers, pas de paiement…), le noter « sans objet » et passer au suivant.

---

## 1. Une vraie authentification

**Vérifier** : comment un utilisateur prouve qui il est, et où cette preuve est contrôlée.

**Signes d'un problème**
- Mot de passe comparé dans le JavaScript du navigateur (`if (pwd === "admin123")`).
- Utilisateur « connecté » parce qu'une valeur est dans `localStorage` (`isAdmin = true`), sans contrôle côté serveur.
- Jeton maison (base64 de l'id, timestamp) au lieu d'une session signée ou d'un JWT vérifié.
- JWT décodé mais jamais vérifié (`jwt.decode` au lieu de `jwt.verify`), ou algorithme `none` accepté.

**Corriger**
- Utiliser le système d'authentification du framework ou un fournisseur : Supabase Auth, Auth.js (NextAuth), Clerk, Firebase Auth, Django auth, Laravel Breeze/Sanctum, Devise.
- Chaque route protégée vérifie la session **côté serveur** à chaque requête.
- Si JWT : vérifier la signature, l'algorithme attendu, l'expiration (`exp`) et l'émetteur. Durée courte (15 min–1 h) + jeton de rafraîchissement.

## 2. Cacher les clés d'API

**Vérifier** : chercher les clés dans le code envoyé au navigateur (`src/`, `public/`, bundle compilé `dist/`, `build/`, `.next/static`).

**Signes d'un problème**
- Clé secrète en dur dans un fichier front (`sk_live_`, `sk-`, `AKIA`, `service_role`, `ghp_`…).
- Variable secrète préfixée pour être exposée au client : `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `NUXT_PUBLIC_`, `EXPO_PUBLIC_`. Tout ce qui porte ces préfixes finit dans le JavaScript public.
- Appel direct à OpenAI, Stripe (clé secrète), Resend, etc. depuis le navigateur.

**Corriger**
- Toute clé secrète reste côté serveur : route API, fonction serverless, Edge Function. Le navigateur appelle ta route, ta route appelle le service. → E1
- Distinguer clé publique (prévue pour le navigateur : clé `anon` Supabase, clé publiable Stripe `pk_`) et clé secrète (jamais côté client).
- Si une clé secrète a été exposée, même quelques minutes en ligne : elle est compromise → point 25.

## 3. Sécuriser la base de données

**Vérifier** : qui peut lire / écrire chaque table, avec quelle clé.

**Signes d'un problème**
- **Supabase** : tables sans RLS (`alter table ... enable row level security` absent), ou politiques `using (true)` sur des données privées. Clé `service_role` utilisée côté client.
- **Firebase** : règles `allow read, write: if true;` ou règles de test expirées prolongées.
- Base (Postgres, MySQL, Mongo) accessible depuis Internet avec mot de passe par défaut, ou chaîne de connexion avec l'utilisateur `root`/`postgres`.
- MongoDB sans authentification, ou IP `0.0.0.0/0` autorisée sur Atlas sans raison.

**Corriger**
- Supabase : RLS activée sur **toutes** les tables du schéma `public`, politiques basées sur `auth.uid()`. Lancer les « Security Advisors » du tableau de bord. → E2
- Firebase : règles qui vérifient `request.auth.uid`.
- Base classique : utilisateur applicatif avec droits minimaux (pas de `DROP`, pas superuser), accès réseau restreint, sauvegardes automatiques activées et testées.

## 4. Imposer le HTTPS

**Vérifier** : config de l'hébergeur, du reverse proxy, de l'app.

**Signes d'un problème**
- Le site répond en `http://` sans rediriger.
- Appels vers des API en `http://` dans le code (contenu mixte).
- Pas d'en-tête `Strict-Transport-Security`.

**Corriger**
- Vercel, Netlify, Render, Cloudflare Pages : HTTPS automatique, vérifier que la redirection forcée est activée.
- VPS : Nginx/Caddy + Let's Encrypt, redirection 301 de tout le port 80 vers 443.
- Ajouter HSTS (point 14). Express derrière un proxy : `app.set('trust proxy', 1)` sinon les cookies `secure` ne partent pas.

## 5. Hasher les mots de passe

**Vérifier** : comment les mots de passe sont stockés.

**Signes d'un problème**
- Mot de passe en clair dans la base.
- MD5, SHA-1, SHA-256 « tout court », même avec un sel maison. Ces fonctions sont rapides, donc faciles à attaquer par force brute.
- Chiffrement réversible (AES) au lieu d'un hachage.

**Corriger**
- Argon2id (premier choix), bcrypt (coût ≥ 12) ou scrypt. → E3
- Si on passe d'un ancien hachage à un nouveau : re-hacher au prochain login réussi, ou forcer une réinitialisation.
- Si on utilise un fournisseur d'auth (point 1), il s'en charge déjà : ne pas stocker de mot de passe soi-même.

## 6. Valider les formulaires côté serveur

**Vérifier** : chaque route qui reçoit des données (`POST`, `PUT`, `PATCH`, paramètres d'URL, en-têtes utilisés).

**Signes d'un problème**
- Validation uniquement dans le formulaire HTML (`required`, `maxlength`) ou en React. N'importe qui peut envoyer une requête sans passer par le formulaire.
- `req.body` passé directement à la base (`User.create(req.body)`) : l'attaquant peut ajouter `role: "admin"` (*mass assignment*).

**Corriger**
- Schéma de validation côté serveur : Zod, Valibot, Joi (Node), Pydantic (Python), Form Requests (Laravel), forms/serializers (Django). → E4
- Liste blanche des champs acceptés. Limites de longueur, types, formats.
- Refuser (400) plutôt que « nettoyer en silence ».

## 7. Se protéger des failles XSS

**Vérifier** : partout où du contenu venant d'un utilisateur est affiché.

**Signes d'un problème**
- `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML` avec des données utilisateur.
- `dangerouslySetInnerHTML` (React), `v-html` (Vue), `{@html}` (Svelte), `|safe` / `mark_safe` (Django/Jinja), `{!! !!}` (Blade).
- Liens construits avec une URL fournie par l'utilisateur (`href={user.website}`) sans refuser `javascript:`.
- Markdown rendu en HTML sans assainissement.

**Corriger**
- Laisser le framework échapper (le comportement par défaut de React, Vue, Django, Blade est sûr). Utiliser `textContent` au lieu de `innerHTML`.
- Si du HTML riche est vraiment nécessaire : DOMPurify (navigateur), `sanitize-html` ou `isomorphic-dompurify` (serveur), `bleach`/`nh3` (Python). → E5
- Ajouter une Content-Security-Policy (point 14), qui limite les dégâts si une faille passe.

## 8. Enregistrer et surveiller les activités suspectes

**Vérifier** : y a-t-il des journaux, et contiennent-ils les événements de sécurité ?

**À journaliser** : connexions réussies et échouées, réinitialisations de mot de passe, changements de rôle, actions admin, refus d'accès (401/403), dépassements de limite (429), erreurs de validation en rafale, échecs de paiement / webhooks invalides.

**Ne jamais journaliser** : mots de passe, jetons, clés, numéros de carte, contenu complet des cookies.

**Corriger**
- Journal structuré (JSON) avec date, IP, identifiant utilisateur, action, résultat. → E6
- Envoyer les journaux hors du serveur : Sentry, Better Stack, Axiom, Datadog, Logtail, ou les logs de l'hébergeur.
- Une alerte simple au minimum : X échecs de connexion en Y minutes sur un compte ou une IP.

## 9. Verrouiller les routes admin

**Vérifier** : toutes les routes et pages `/admin`, `/dashboard`, `/api/admin/*`, actions de suppression, d'export, de changement de rôle.

**Signes d'un problème**
- La page admin est seulement « cachée » (pas de lien dans le menu) mais accessible si on connaît l'URL.
- Le contrôle du rôle se fait dans le composant React, pas dans l'API.
- Le rôle vient d'une donnée modifiable par l'utilisateur (`localStorage`, champ de formulaire, claim non vérifié).
- L'API admin vérifie qu'on est connecté, mais pas qu'on est admin.

**Corriger**
- Middleware serveur qui vérifie le rôle **lu en base ou dans une session signée**, appliqué à toutes les routes admin. → E7
- Vérifier aussi l'appartenance des objets : un utilisateur qui modifie `/api/orders/123` doit être propriétaire de la commande 123 (faille IDOR, très courante).
- Idéalement : 2FA pour les comptes admin.

## 10. Utiliser des requêtes paramétrées

**Vérifier** : toute requête SQL ou NoSQL qui contient une variable.

**Signes d'un problème**
- Concaténation ou template string : `` `SELECT * FROM users WHERE email = '${email}'` ``, `"... WHERE id = " + id`, f-strings Python, `.format()`.
- `sequelize.query`, `prisma.$queryRawUnsafe`, `knex.raw`, `cursor.execute(f"...")`, `DB::raw` avec des données utilisateur.
- MongoDB : objet de requête construit directement depuis `req.body` (injection d'opérateurs `$ne`, `$gt`).

**Corriger**
- Paramètres liés : `$1`, `?`, `%s` avec tableau de valeurs, ou l'ORM. `prisma.$queryRaw` en template tag est paramétré, `$queryRawUnsafe` ne l'est pas. → E8
- Noms de colonnes / tri dynamiques : liste blanche, jamais la valeur brute.
- Mongo : valider les types (point 6) pour qu'un champ attendu comme chaîne ne puisse pas être un objet.

## 11. Vérifier les variables d'environnement

**Vérifier** : `.env*`, `.gitignore`, config de l'hébergeur, code de démarrage.

**Signes d'un problème**
- `.env` suivi par Git, ou absent du `.gitignore`.
- Valeurs par défaut dangereuses dans le code : `process.env.JWT_SECRET || "secret"`, `SECRET_KEY = os.getenv("SECRET_KEY", "dev")`.
- L'app démarre même si une variable obligatoire manque, et se comporte bizarrement en prod.

**Corriger**
- `.env`, `.env.local`, `.env.*.local` dans `.gitignore`. Fournir un `.env.example` sans valeurs réelles.
- Valider les variables au démarrage et planter si une manque (Zod, `envalid`, `@t3-oss/env`, Pydantic Settings). → E9
- Secrets de prod uniquement dans le gestionnaire de l'hébergeur, jamais dans le dépôt.

## 12. Ajouter une limite de requêtes

**Vérifier** : routes de connexion, inscription, mot de passe oublié, envoi d'e-mail/SMS, appels à une API payante (IA !), recherche, formulaire de contact.

**Signes d'un problème** : aucune limite. Une boucle peut tester des milliers de mots de passe, ou vider ton crédit OpenAI en une nuit.

**Corriger**
- `express-rate-limit`, `@upstash/ratelimit` (serverless), `slowapi` (FastAPI), `django-ratelimit`, `throttle` (Laravel). → E10
- Limites plus strictes sur l'authentification (ex. 5 essais / 15 min par IP **et** par compte).
- En serverless, le stockage en mémoire ne marche pas (chaque instance a son compteur) : utiliser Redis/Upstash ou la protection de l'hébergeur (Vercel Firewall, Cloudflare).
- Plafond de dépense configuré chez les fournisseurs d'API payantes.

## 13. Restreindre les réglages CORS

**Vérifier** : config CORS du serveur ou des fonctions.

**Signes d'un problème**
- `Access-Control-Allow-Origin: *` sur une API qui utilise des cookies ou renvoie des données privées.
- Origine renvoyée en miroir (`origin: true`, ou on recopie l'en-tête `Origin` reçu) avec `credentials: true`.
- Liste qui accepte `localhost` en production.

**Corriger**
- Liste blanche explicite des domaines du front, différente entre dev et prod. → E11
- `credentials: true` seulement si nécessaire, et jamais avec une origine joker.
- Rappel : CORS protège les utilisateurs dans le navigateur, pas l'API. Un script ou `curl` l'ignore. Ce n'est pas un contrôle d'accès.

## 14. Ajouter des en-têtes de sécurité

**Vérifier** : réponses HTTP du site (`curl -sI https://ton-site`), config de l'hébergeur ou middleware.

**En-têtes attendus**
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (ajouter `preload` seulement si on est sûr).
- `Content-Security-Policy` adaptée au site (commencer en `Content-Security-Policy-Report-Only` pour ne rien casser).
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY` ou `frame-ancestors 'none'` dans la CSP.
- `Permissions-Policy` pour couper caméra, micro, géolocalisation si inutiles.
- Retirer `X-Powered-By`.

**Corriger** : Helmet (Express), `headers()` dans `next.config.js`, `netlify.toml` / `_headers`, `vercel.json`, `django-csp` + `SecurityMiddleware`. → E12

Vérifier ensuite avec securityheaders.com ou l'observatoire de Mozilla.

## 15. Sécuriser les cookies de session

**Vérifier** : où sont posés les cookies (`res.cookie`, `cookies().set`, `Set-Cookie`, config de session).

**Attributs attendus** : `HttpOnly` (JavaScript ne peut pas le lire), `Secure` (HTTPS uniquement), `SameSite=Lax` ou `Strict`, `Path=/`, durée raisonnable. Préfixe `__Host-` si possible.

**Signes d'un problème**
- Jeton de session stocké dans `localStorage` : lisible par n'importe quel script injecté (XSS).
- Secret de session faible ou par défaut (`"keyboard cat"` dans les exemples Express).
- L'identifiant de session ne change pas après la connexion (fixation de session).

**Corriger** → E13. Régénérer la session à la connexion et la détruire côté serveur à la déconnexion.

## 16. Ajouter une protection CSRF

**S'applique quand** : l'authentification passe par des cookies (sessions, cookies de NextAuth, etc.). Si l'API n'utilise qu'un en-tête `Authorization: Bearer` posé par le JavaScript, le risque CSRF est faible.

**Vérifier** : routes qui modifient des données (`POST`, `PUT`, `PATCH`, `DELETE`) et routes en `GET` qui modifient quelque chose (à corriger dans tous les cas).

**Corriger**
- Utiliser la protection intégrée : Django (`CsrfViewMiddleware`), Laravel (`@csrf`), Rails, SvelteKit (vérification d'origine), Next.js Server Actions (vérification d'origine intégrée).
- Express / API maison : jeton CSRF (double-submit cookie, `csrf-csrf`) + `SameSite=Lax` + vérification de l'en-tête `Origin`. → E14
- Jamais d'action qui modifie des données en `GET`.

## 17. Faire expirer les liens de réinitialisation

**Vérifier** : le flux « mot de passe oublié ».

**Signes d'un problème**
- Jeton prévisible (id utilisateur, timestamp, `Math.random()`).
- Pas d'expiration, ou plusieurs jours.
- Jeton réutilisable après usage, ou anciens jetons toujours valides après une nouvelle demande.
- Jeton stocké en clair en base.
- Message différent selon que l'e-mail existe ou non (énumération des comptes).

**Corriger** → E15
- Jeton aléatoire cryptographique (32 octets), stocké **haché** en base, durée 15 à 60 minutes, usage unique.
- Invalider les autres jetons et les sessions ouvertes après le changement de mot de passe.
- Même réponse que l'e-mail existe ou non. Limite de requêtes (point 12).

## 18. Limiter le type et la taille des fichiers envoyés

**Vérifier** : toute route d'upload, et les buckets de stockage (S3, Supabase Storage, Firebase Storage, Cloudinary).

**Signes d'un problème**
- Type vérifié seulement par l'extension ou par le `Content-Type` envoyé par le client.
- Pas de taille max.
- Fichier enregistré avec le nom fourni par l'utilisateur (`../../`, écrasement), dans un dossier servi publiquement et exécutable.
- SVG ou HTML acceptés et servis depuis le même domaine (XSS).
- Bucket public en écriture.

**Corriger** → E16
- Taille max côté serveur (et côté bucket). Liste blanche de types vérifiés par la signature du fichier (`file-type`, `python-magic`).
- Renommer avec un identifiant aléatoire. Stocker hors du dossier web ou sur un stockage objet, servir avec `Content-Disposition: attachment` si ce n'est pas une image.
- Politiques de stockage : écriture réservée aux utilisateurs connectés, dans leur propre dossier.
- Images : les ré-encoder (sharp, Pillow) retire aussi les métadonnées EXIF (position GPS).

## 19. Vérifier les prix et les paiements

**Vérifier** : création de commande, panier, code promo, abonnement, webhook de paiement.

**Signes d'un problème**
- Le prix ou le total vient du navigateur (`amount: req.body.price`).
- La commande est marquée payée parce que le front a été redirigé vers `/success`.
- Webhook Stripe / PayPal / mobile money accepté sans vérifier la signature.
- Quantités négatives ou décimales acceptées, code promo cumulable à l'infini.
- Même webhook traité deux fois (double livraison).

**Corriger** → E17
- Le serveur recalcule le prix à partir de l'identifiant produit, lu en base. Le client n'envoie que l'id et la quantité.
- Le statut « payé » n'est posé que par le webhook, après vérification de la signature (`stripe.webhooks.constructEvent`) et du montant reçu.
- Idempotence : enregistrer l'id de l'événement et ignorer les doublons.
- Utiliser Stripe Checkout / Payment Links plutôt qu'un formulaire de carte maison : la carte ne touche jamais ton serveur.

## 20. Désactiver le mode debug en production

**Vérifier** : `DEBUG = True` (Django), `app.run(debug=True)` / `FLASK_DEBUG=1`, `APP_DEBUG=true` (Laravel), `NODE_ENV` absent ou `development`, source maps publiées, pages d'erreur qui affichent la pile d'appels, routes de test (`/api/test`, `/seed`, `/debug`) restées en place, `console.log` de données sensibles.

**Corriger**
- Valeur de debug tirée d'une variable d'environnement, fausse par défaut.
- Gestionnaire d'erreurs qui renvoie un message générique au client et le détail dans les logs. → E18
- Supprimer les routes de test. `productionBrowserSourceMaps: false` (Next.js) ou source maps envoyées seulement à Sentry.
- Le debugger Werkzeug (Flask) exposé en ligne permet d'exécuter du code sur le serveur : c'est critique.

## 21. Mettre à jour les dépendances vulnérables

**Vérifier** : `npm audit` / `pnpm audit` / `yarn npm audit`, `pip-audit`, `composer audit`, `bundle audit`, `govulncheck`, `cargo audit`.

**Corriger**
- Traiter d'abord les vulnérabilités `critical` et `high` des dépendances réellement utilisées en production.
- `npm audit fix` sans `--force` d'abord. `--force` peut passer des versions majeures et casser l'app : tester après.
- Activer Dependabot ou Renovate sur le dépôt pour la suite.
- Lockfile (`package-lock.json`, `poetry.lock`…) commité.

## 22. Supprimer les paquets inutilisés

**Vérifier** : `npx depcheck` (Node), `pip-autoremove` / `deptry` (Python), `composer-unused`.

**Prudence** : ces outils se trompent (paquets chargés par la config, plugins, CLI utilisés dans les scripts, types). Vérifier chaque paquet par une recherche dans le code avant de le retirer, et relancer le build après.

**Pourquoi** : chaque paquet est du code tiers qui tourne avec tes droits. Moins il y en a, moins il y a de surface d'attaque. Vérifier aussi les noms : une IA peut inventer un paquet qui n'existe pas, et quelqu'un peut l'avoir enregistré depuis avec du code malveillant (*slopsquatting*). Pour tout paquet peu connu, regarder sa page npm/PyPI : date, téléchargements, dépôt source.

## 23. Chercher les fichiers exposés

**Vérifier** : ce qui est réellement servi publiquement.

**Fichiers à ne jamais servir** : `.env*`, `.git/`, `*.sql`, `*.sqlite`, `*.db`, `*.bak`, `*.old`, `*.zip` de sauvegarde, `*.log`, `config.php.bak`, `phpinfo.php`, `id_rsa`, `*.pem`, `*.key`, `credentials.json`, `serviceAccountKey.json`, `docker-compose.yml` avec mots de passe, `.DS_Store`, source maps avec code serveur.

**Corriger**
- Sur un site statique, le dossier publié ne doit contenir que ce qui doit l'être (`public/`, `dist/`).
- Test en ligne : `curl -s -o /dev/null -w "%{http_code}" https://ton-site/.env` doit renvoyer 404 (idem pour `/.git/config`). → E19
- Bloquer explicitement les fichiers cachés dans la config Nginx/Apache.
- Vérifier aussi `robots.txt` : il ne doit pas lister les chemins sensibles (il les annonce).

## 24. Scanner l'historique Git pour trouver des secrets

**Pourquoi** : supprimer un `.env` dans un nouveau commit ne l'efface pas. Il reste dans l'historique, et sur GitHub n'importe qui peut le lire si le dépôt est (ou a été) public.

**Vérifier**
- `gitleaks detect --source . --log-opts="--all"` (le plus fiable), ou `trufflehog git file://. --only-verified`.
- À défaut : le script `scripts/audit.sh` fait une recherche par motifs sur `git log -p --all`.
- Sur GitHub : onglet *Security → Secret scanning* si disponible.

**Corriger**
1. **D'abord révoquer la clé** (point 25). C'est la seule mesure qui protège vraiment : la clé a pu être copiée.
2. Ensuite seulement, nettoyer l'historique si on le souhaite : `git filter-repo --invert-paths --path .env` ou BFG Repo-Cleaner. **Demander l'accord avant** : ça réécrit tous les commits, impose un `push --force`, et tous les collaborateurs doivent recloner. Les forks et les caches existants garderont l'ancienne version.
3. Ajouter un garde-fou pour la suite : hook `pre-commit` avec gitleaks, et protection *push protection* de GitHub. → E20

## 25. Révoquer et remplacer les clés compromises

**Une clé est compromise si** : elle a été commitée (même dans un dépôt privé, même supprimée ensuite), envoyée au navigateur, collée dans un chat, une capture d'écran, un ticket, ou affichée dans des logs.

**Procédure, dans cet ordre**
1. Générer une nouvelle clé chez le fournisseur.
2. La mettre dans les variables d'environnement de l'hébergeur (et en local dans `.env`).
3. Redéployer et vérifier que l'app fonctionne avec la nouvelle clé.
4. **Révoquer l'ancienne** chez le fournisseur.
5. Regarder les journaux d'utilisation du fournisseur sur la période d'exposition (facturation OpenAI, logs Stripe, CloudTrail AWS, logs Supabase) pour voir si elle a servi.

**Où ça se passe** (l'utilisateur doit le faire lui-même, connecté à son compte) :
- Stripe : Dashboard → Developers → API keys → *Roll key*.
- OpenAI / Anthropic : page API keys de la console → supprimer et recréer.
- Supabase : Project Settings → API (clés JWT / API keys) → régénérer. Attention, régénérer le secret JWT déconnecte tous les utilisateurs.
- AWS : IAM → utilisateur → Security credentials → désactiver puis supprimer la clé d'accès.
- GitHub : Settings → Developer settings → Personal access tokens.
- Google Cloud / Firebase : APIs & Services → Credentials, et restreindre la clé par domaine / API.
- Base de données : changer le mot de passe de l'utilisateur et la chaîne de connexion.

Donner à l'utilisateur la liste des clés concernées et l'ordre ci-dessus. Ne pas considérer le point comme réglé tant qu'il n'a pas confirmé la révocation.
