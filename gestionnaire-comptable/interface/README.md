# Gestionnaire Comptable : interface web

Application web (React 18 + TypeScript, compilée avec Vite) servie par le serveur applicatif. Les postes n'installent rien : un navigateur récent suffit.

## Commandes

| Commande | Rôle |
|---|---|
| `npm ci` | Installer les dépendances |
| `npm run build` | Compiler vers `dist/`, dossier que le serveur sert automatiquement |
| `npm run dev` | Développement : http://localhost:5173, appels `/api` relayés vers le serveur (`GC_API`, par défaut http://localhost:8443) |
| `npm run build:demo` | Version de démonstration en un seul fichier (`gestionnaire-comptable-demo.html`), avec un serveur **simulé** et des données fictives |
| `npm run test:parcours` | Parcours de bout en bout dans Chromium contre un vrai serveur (voir l'en-tête de `tests/parcours.mjs`) |

## Principes

- Toutes les données viennent du serveur. Rien de confidentiel n'est stocké dans le navigateur : la session est un cookie HttpOnly, et seul le code entreprise (qui n'est pas un secret) est mémorisé pour éviter de le ressaisir.
- Les menus et les boutons suivent les permissions de l'utilisateur, mais **la vraie barrière est le serveur** : le parcours de test appelle l'API directement avec une session de caissière et vérifie le refus (403).
- Quand le serveur répond « confirmation requise », une fenêtre demande le mot de passe (et le code MFA), puis la requête est rejouée.
- Pas de `dangerouslySetInnerHTML`, pas de script ni de style externe : l'interface respecte la politique de sécurité stricte du serveur (`default-src 'self'`).
- Le code de démonstration (`src/demo/`) est exclu de la version réelle à la compilation.
