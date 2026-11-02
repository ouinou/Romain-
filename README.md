# Site ITI – incubateurtech.tech

Site de l'Incubateur Technologique de l'Innovation (Douala).

## Publier un article ou modifier un texte

Sur **https://incubateurtech.tech/admin**, avec le mot de passe administrateur.
Les modifications sont enregistrées dans la base Supabase (projet `iti-website`)
et apparaissent sur le site en temps réel, sans toucher au code.

## Mettre à jour le code du site

- `site-en-ligne/` : le site publié par Netlify (version du 3 septembre, corrigée).
- Chaque modification de la branche `main` est publiée automatiquement par Netlify,
  une fois le projet Netlify relié à ce dépôt.
- `outils/sep3patch.py` : script qui a corrigé la version téléchargée depuis Netlify.
- `outils/securite-supabase.sql` : sécurisation de la base (à appliquer une fois).

## Anciennes publications

`publications/` et `a/` : les « Publications ITI » d'origine (non publiées par Netlify).
