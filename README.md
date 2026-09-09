# AfriTrade Connect — Charte graphique web

Implémentation de la charte graphique et du design system web d'**AfriTrade Connect**, plateforme B2B qui met en relation fournisseurs, acheteurs et agences d'expédition.

> « Connecter les marchés, simplifier les échanges. »

Le dépôt est un site statique (HTML / CSS / JS, sans build) qui sert de base réutilisable pour l'ensemble de la plateforme : landing page, recherche, fiches produits/fournisseurs, profils, messagerie, tableaux de bord et suivi d'expédition partagent tous le même système de couleurs, typographies, boutons, cartes, badges, icônes et espacements.

## Voir la charte graphique

Ouvrir [`styleguide.html`](./styleguide.html) : c'est la référence vivante de tous les tokens (couleurs, typographie, boutons, badges, cartes, formulaires, icônes, rayons, espacements).

## Pages livrées

| Page | Fichier |
|---|---|
| Accueil (hero, catégories, fournisseurs, comment ça marche, expédition) | `index.html` |
| Charte graphique / design system | `styleguide.html` |
| Recherche avancée avec filtres | `recherche.html` |
| Fiche produit | `produit.html` |
| Profil fournisseur (onglets à propos / produits / services / avis / infos / contact) | `fournisseur-profil.html` |
| Tableau de bord fournisseur | `dashboard-fournisseur.html` |
| Tableau de bord acheteur | `dashboard-acheteur.html` |
| Tableau de bord agence d'expédition | `dashboard-agence.html` |
| Suivi d'expédition (timeline) | `suivi.html` |
| Messagerie | `messagerie.html` |
| Connexion | `connexion.html` |
| Créer un compte | `inscription.html` |
| À propos / FAQ / Contact | `a-propos.html` |

## Structure

```
assets/
  css/
    design-system.css   → tokens (couleurs, typo, radius, ombres, espacements), reset, boutons, formulaires, badges
    components.css       → navbar, footer, cartes, hero, sections marketing, dashboard, suivi, messagerie
  js/
    main.js               → menu mobile, onglets, icônes Lucide, révélation au scroll
  img/
    logo.svg, logo-inverse.svg, favicon.svg
```

## Design tokens principaux

- Bleu nuit `#002B5B` — navigation, titres, boutons principaux, footer
- Orange `#FF7A00` — CTA, actions, badges actifs
- Fond `#FFFFFF` / fond secondaire `#F4F6F8`
- Texte `#4B5563` / bordure `#E5E7EB`
- Succès `#16A34A` / erreur `#DC2626`
- Police **Inter**, rayons 6/8/12/16px, ombres très légères, espacements en multiples de 4/8px

## À noter

- Le logo est un placeholder généré en SVG (monogramme + wordmark) en attendant le logo officiel fourni par la marque — à remplacer dans `assets/img/`.
- Les images (fournisseurs, produits, hero, expédition) sont des photos de stock Unsplash à titre de démonstration ; à remplacer par des visuels réels de la plateforme.
- Les icônes utilisent [Lucide](https://lucide.dev) via CDN.
- Aucune logique métier n'est implémentée (formulaires, recherche, messagerie) : il s'agit d'une démonstration statique du design system, prête à être branchée sur un backend.

## Lancer en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```
