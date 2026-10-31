# Application Windows et démonstration

## Ce que c'est

L'application Windows (`apps/desktop`, Electron 44) est une fenêtre de bureau qui affiche RTMS servi par le **serveur central de l'entreprise**. Elle ne contient ni base de données ni mot de passe : chaque poste se connecte au serveur en HTTPS, comme le demande le cahier des charges (§9 : « les postes clients ne doivent pas accéder directement à PostgreSQL »).

Au premier lancement, l'utilisateur choisit :
- **Se connecter au serveur de l'entreprise** : il saisit l'adresse fournie par l'administrateur (ex. `https://rtms.raha-transport.cm`). L'application vérifie que c'est bien un serveur RTMS avant de l'enregistrer.
- **Essayer la démonstration** : le logiciel s'ouvre avec des données fictives, sans serveur, enregistrées sur ce poste uniquement.

Le choix est mémorisé. Il se change par le menu **Fichier › Changer de serveur**.

## Fichiers produits

| Fichier | Usage |
|---|---|
| `RTMS-Setup-2.2.0.exe` | installateur (assistant en français, sans droits administrateur, raccourcis Bureau et menu Démarrer, désinstallation dans « Applications installées ») |
| `RTMS-Portable-2.2.0.zip` | version sans installation : décompresser puis lancer `RAHA TRANSPORT RTMS.exe` |
| `SHA256SUMS.txt` | empreintes pour vérifier que les fichiers n'ont pas été modifiés |

Installation : dossier `%LOCALAPPDATA%\Programs\RAHA TRANSPORT RTMS`. Réglages du poste : `%APPDATA%\RAHA TRANSPORT RTMS\config.json` (conservés à la désinstallation).

## Ce que l'application de bureau ajoute

- Vrai **fichier PDF A4** pour « Exporter PDF » (facture au modèle RAHA, documents de transport), enregistré où l'utilisateur le choisit puis ouvert.
- Fenêtre native : réduire, agrandir, fermer, taille et position mémorisées, une seule instance.
- Écran « Serveur injoignable » avec **Réessayer** et **Changer de serveur**.

## Sécurité de la fenêtre

- La page n'a aucun accès à Windows ni à Node.js (`contextIsolation`, `sandbox`, pas de `nodeIntegration`). Seules sept actions sont exposées (test du serveur, choix du serveur, démonstration, PDF…), et seulement aux pages du serveur choisi.
- Navigation limitée au serveur choisi ; tout autre lien s'ouvre dans le navigateur.
- Adresse en `http://` refusée hors réseau local ; certificats TLS non contournés.
- Aucune permission matérielle (caméra, micro, position).
- Outils de développement désactivés dans la version installée.

## Construire

Sous Linux ou Windows, avec Node.js 22 :

```bash
cd rtms/apps/desktop && npm ci && npm run dist:win
```

La construction n'a pas besoin de Wine : l'icône et la version de l'exécutable sont posées par `scripts/after-pack.js` (bibliothèque resedit), et l'installateur est compilé par `makensis` à partir de `installer/rtms.nsi`.

Tests :

```bash
npm test
```

```bash
xvfb-run -a node test/e2e-desktop.cjs /tmp http://localhost:3000
```

```bash
node test/check-build.mjs
```

## Limites connues, à traiter avant un déploiement large

- **Pas de signature de code.** Windows SmartScreen affichera « Windows a protégé votre ordinateur » : cliquer sur « Informations complémentaires » puis « Exécuter quand même ». Pour supprimer cet avertissement, il faut un certificat de signature de code au nom de RAHA TRANSPORT (environ 200 à 500 € par an), à intégrer dans la construction.
- **Pas de mise à jour automatique.** Une nouvelle version s'installe en relançant le nouvel installateur par-dessus l'ancien (les réglages sont conservés).
- **Testée sous Linux, pas encore sur un PC Windows réel.** Le même code a passé les tests automatiques (Electron sous écran virtuel), et l'exécutable a été contrôlé (format, icône, version, contenu), mais aucun essai n'a été fait sur Windows 10 ou 11. À faire sur un poste pilote.
- **Serveur en HTTPS obligatoire** pour l'usage réel : sur un réseau local sans nom de domaine, il faut un certificat interne installé sur les postes (voir `05-DEPLOIEMENT.md`).

## Démonstration en ligne

La même démonstration est publiée comme page web (lien fourni séparément). Elle fonctionne entièrement dans le navigateur, avec un serveur simulé (`apps/web/src/demo/`) qui applique les règles principales du vrai serveur : champs obligatoires, listes fermées, références uniques, calculs de facture, montant en lettres. Dans la page en ligne, l'impression et le téléchargement de fichiers sont bloqués par le cadre d'affichage ; ils fonctionnent dans l'application Windows. La démonstration n'a **aucune sécurité** : elle ne doit jamais recevoir de données réelles.
