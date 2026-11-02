# Publier sur le site ITI sans toucher au code

Le site incubateurtech.tech reste hébergé sur Netlify, avec le même domaine et les mêmes réglages DNS. Les articles se publient depuis une page d'administration, comme sur un blog classique. Pas d'abonnement, pas de technicien.

---

## 1. Mise en route (une seule fois)

### a) Relier Netlify au dépôt GitHub (5 minutes, sans toucher au DNS)

Sur app.netlify.com, ouvrez le site relié à incubateurtech.tech :

1. **Site configuration** → **Build & deploy** → **Continuous deployment** → **Link repository** (ou « Link to Git provider »).
2. Choisissez **GitHub**, autorisez Netlify si c'est demandé, puis sélectionnez le dépôt **ouinou/Romain-**.
3. Branche à publier : **main**. Les autres réglages (commande `npm ci && npm run build`, dossier `_site`) sont lus automatiquement dans le fichier `netlify.toml`. Laissez les champs tels que Netlify les propose.
4. Validez. Netlify lance une première construction (1 à 2 minutes).

Le site actuel reste en ligne pendant la construction. Netlify ne remplace l'ancienne version qu'une fois la nouvelle prête. En cas de souci, l'onglet **Deploys** permet de revenir à la version précédente en un clic (« Publish deploy »).

Le DNS chez LWS ne change pas.

### b) Activer le formulaire de contact

Envoyez un premier message depuis la page Contact. Un e-mail de FormSubmit arrive sur incubateur.th@gmail.com : cliquez sur le lien d'activation. Les messages suivants arriveront directement dans cette boîte.

### c) Créer votre clé de publication

L'espace d'administration se connecte à GitHub avec une clé personnelle (un « jeton »).

1. GitHub → photo de profil → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Nom : « Publication site ITI ». Expiration : 1 an.
3. **Repository access** : « Only select repositories » → `ouinou/Romain-`.
4. **Permissions** → **Contents** : « Read and write ».
5. **Generate token**, puis copiez la clé (elle ne s'affiche qu'une fois).

Gardez cette clé comme un mot de passe. Chaque personne qui publie peut avoir la sienne.

---

## 2. Publier un article

1. Ouvrez **https://incubateurtech.tech/admin**.
2. Choisissez la connexion par jeton (« Sign In with Token ») et collez votre clé. Le navigateur s'en souvient.
3. **Articles du blog** → **Nouveau** (« New »).
4. Remplissez le titre, la date, la catégorie, l'image, le résumé et le contenu. Le contenu se met en forme avec les boutons de l'éditeur : titres, gras, listes, liens, images.
5. Cliquez sur **Enregistrer / Publier** (« Save »).

L'article apparaît sur le site 1 à 2 minutes plus tard, sur la page Blog. Il a sa propre adresse : `incubateurtech.tech/blog/titre-de-l-article`.

- **Modifier un article** : ouvrez-le dans la liste, changez ce qu'il faut, enregistrez.
- **Le mettre en brouillon** : décochez « Publié sur le site ».
- **Le supprimer** : bouton « Supprimer » dans l'article.

Conseils pratiques :

- Images au format paysage, en JPG ou WebP, de moins de 500 Ko (redimensionnez les photos de téléphone avant de les envoyer).
- Le résumé est ce que les gens voient quand le lien est partagé sur WhatsApp ou Facebook : soignez-le.

---

## 3. Ce qui se modifie depuis /admin, et ce qui ne l'est pas encore

| Contenu | Où le modifier |
|---|---|
| Articles du blog (actualités, tutoriels, événements) | /admin |
| Images des articles | /admin |
| Textes des pages (Accueil, Formations, FAQ, À propos…) | encore dans le code du site |
| Numéros de téléphone, e-mail, Orange Money | encore dans le code du site |

Rendre aussi les pages et les coordonnées modifiables depuis /admin est l'étape suivante possible.

---

## 4. En cas de problème

- **L'article n'apparaît pas après 5 minutes** : sur Netlify, onglet **Deploys**. Un déploiement en rouge (« Failed ») signale une erreur ; cliquez dessus pour lire le détail. Relancer : « Retry deploy ». Le site en ligne reste celui de la dernière construction réussie.
- **/admin refuse la connexion** : la clé a expiré ou n'a pas le droit « Contents: Read and write ». Créez-en une nouvelle (étape 1c).

---

## Pour la personne technique

- `site/` : le site (gabarit HTML, JS, CSS, photo du PDG).
- `content/articles/*.md` : les articles (Markdown + en-tête YAML) écrits depuis /admin.
- `content/images/` : les images envoyées depuis /admin, publiées sous `/images/uploads/`.
- `admin/` : l'éditeur Sveltia CMS et sa configuration (`config.yml`).
- `scripts/build.mjs` : construit `_site/` (une page HTML par adresse avec ses balises SEO, `content.json`, sitemap, robots).
- `netlify.toml` : réglages Netlify (construction, adresses, en-têtes). Netlify reconstruit à chaque modification de `main`.
- `publications/` et `a/` : les publications ITI déjà existantes, servies sur `/publications`.
- `outils/patch.py` : le script qui a corrigé l'export Manus d'origine.

Test en local : `npm ci && npm run build`, puis servir le dossier `_site/`.
