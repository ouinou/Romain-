# Publier sur le site ITI sans toucher au code

Le site incubateurtech.tech est hébergé gratuitement sur GitHub Pages. Les articles se publient depuis une page d'administration, comme sur un blog classique. Pas d'abonnement, pas de technicien.

---

## 1. Mise en route (une seule fois)

### a) Activer la publication automatique

Les fichiers du site sont sur la branche `claude/compassionate-turing-hmmii9`. Il faut les fusionner dans `main` (par une « Pull Request » sur GitHub). Dès que c'est fait, GitHub construit le site et le place sur la branche `gh-pages`.

### b) Régler GitHub Pages

Sur github.com/ouinou/Romain- → **Settings** → **Pages** :

1. **Source** : « Deploy from a branch », branche **gh-pages**, dossier **/ (root)**.
2. **Custom domain** : `incubateurtech.tech`, puis **Save**.
3. Cocher **Enforce HTTPS** dès que la case devient disponible (le certificat peut prendre jusqu'à 24 h).

### c) Faire pointer le domaine vers GitHub (chez LWS)

Dans l'espace client LWS → domaine incubateurtech.tech → **Zone DNS** :

| Action | Type | Nom | Valeur |
|---|---|---|---|
| Supprimer | A | @ | 75.2.60.5 (ancien hébergement Netlify) |
| Ajouter | A | @ | 185.199.108.153 |
| Ajouter | A | @ | 185.199.109.153 |
| Ajouter | A | @ | 185.199.110.153 |
| Ajouter | A | @ | 185.199.111.153 |
| Ajouter ou modifier | CNAME | www | ouinou.github.io. |

La prise en compte demande de quelques minutes à quelques heures.

### d) Activer le formulaire de contact

Envoyez un premier message depuis la page Contact. Un e-mail de FormSubmit arrive sur incubateur.th@gmail.com : cliquez sur le lien d'activation. Les messages suivants arriveront directement dans cette boîte.

### e) Créer votre clé de publication

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

- **L'article n'apparaît pas après 5 minutes** : sur GitHub, onglet **Actions**, ouvrez « Publier le site ». Une croix rouge signale une erreur ; le détail est affiché. Relancer : bouton « Re-run jobs ».
- **/admin refuse la connexion** : la clé a expiré ou n'a pas le droit « Contents: Read and write ». Créez-en une nouvelle (étape 1e).

---

## Pour la personne technique

- `site/` : le site (gabarit HTML, JS, CSS, photo du PDG).
- `content/articles/*.md` : les articles (Markdown + en-tête YAML) écrits depuis /admin.
- `content/images/` : les images envoyées depuis /admin, publiées sous `/images/uploads/`.
- `admin/` : l'éditeur Sveltia CMS et sa configuration (`config.yml`).
- `scripts/build.mjs` : construit `_site/` (une page HTML par adresse avec ses balises SEO, `content.json`, sitemap, robots, CNAME).
- `.github/workflows/deploy.yml` : à chaque modification de `main`, construit et publie sur la branche `gh-pages`.
- `publications/` et `a/` : les publications ITI déjà existantes, servies sur `/publications`.
- `outils/patch.py` : le script qui a corrigé l'export Manus d'origine.

Test en local : `npm ci && npm run build`, puis servir le dossier `_site/`.
