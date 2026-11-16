# securite-vibecoding

Un skill pour Claude Code qui passe une application web au crible avant sa mise en ligne, en 25 points : authentification, mots de passe, clés d'API, base de données, HTTPS, en-têtes, CORS, CSRF, XSS, cookies, limites de requêtes, routes admin, envoi de fichiers, paiements, mode debug, dépendances, fichiers exposés, secrets dans l'historique Git et rotation des clés.

Il a été pensé pour les projets montés vite avec une IA : l'app marche, mais personne n'a vérifié ce qui se passe quand quelqu'un essaie de la casser.

## Ce qu'il fait, et ce qu'il ne fait pas

Il lit le projet, lance un audit automatique en lecture seule, passe les 25 points un par un, corrige ce qui peut l'être dans le code, puis donne un rapport : ce qui a été corrigé, ce que tu dois faire toi-même (révoquer une clé, régler l'hébergeur), et ce qu'il n'a pas pu vérifier.

Il ne réécrit pas ton historique Git, ne supprime pas de paquets et ne touche pas à ta base en production sans te demander. Il ne remplace pas non plus un vrai test d'intrusion : si ton app manipule de l'argent ou des données personnelles sensibles, fais-la relire par quelqu'un dont c'est le métier.

## Installation

Copier le dossier `securite-vibecoding` dans :

- `~/.claude/skills/` pour l'avoir dans tous tes projets ;
- ou `.claude/skills/` à la racine d'un projet pour ce projet seulement.

```bash
# exemple, depuis ce dépôt
mkdir -p ~/.claude/skills
cp -r skills/securite-vibecoding ~/.claude/skills/
```

Puis, dans Claude Code : « sécurise mon app avant la mise en prod », « fais un audit de sécurité », « j'ai commité ma clé Stripe, aide-moi »… Le skill se déclenche tout seul sur ce genre de demande.

## Utiliser le script seul, sans Claude

```bash
bash ~/.claude/skills/securite-vibecoding/scripts/audit.sh /chemin/vers/ton/projet
```

Le script ne modifie rien. Il marche mieux si ces outils sont installés (facultatifs) : [gitleaks](https://github.com/gitleaks/gitleaks), `pip-audit`, `depcheck` (`npm i -g depcheck`). Sans eux, il retombe sur des recherches par motifs, plus approximatives.

Ses alertes sont des pistes, pas des verdicts : il y a des faux positifs, et l'absence d'alerte ne veut pas dire qu'il n'y a pas de faille.

## Contenu

```
securite-vibecoding/
├── SKILL.md                  la démarche suivie par Claude
├── references/
│   ├── checklist.md          les 25 points : quoi vérifier, signes d'un problème, correctif
│   └── exemples.md           extraits de code prêts à adapter (Node, Next.js, Python, Supabase, Stripe…)
└── scripts/
    └── audit.sh              audit automatique en lecture seule
```

## Licence

MIT — utilise, modifie, partage.
