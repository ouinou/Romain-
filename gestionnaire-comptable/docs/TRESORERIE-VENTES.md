# Ventes, factures et trésorerie : règles appliquées et points à vérifier (v0.1)

Ce module enregistre les opérations courantes (ventes, prestations, dépenses, transferts) et en tire les écritures comptables. **Ses choix comptables et fiscaux n'ont pas encore été validés par un expert-comptable.** Ils sont listés ici pour cette validation.

## 1. Ce que garantit la base de données (migration `005_tresorerie_ventes.sql`)

| Règle | Statut |
|---|---|
| Un mouvement de trésorerie ne se modifie ni ne se supprime ; une erreur se corrige par une annulation motivée | Choix de conception (piste d'audit). |
| Une caisse ne peut pas avoir un solde négatif | Règle de bon sens de contrôle interne. Les banques peuvent l'être (découvert). |
| Une facture émise ne se modifie pas ; ses lignes ne s'ajoutent qu'au moment de l'émission | Principe d'intangibilité. **Texte fiscal camerounais à citer.** |
| Numérotation continue des factures par entreprise et par année (FAC-AAAA-NNNNN) | Exigence usuelle de numérotation chronologique sans trou. **Article du CGI à citer.** |
| Total HT = somme des lignes ; TVA = HT × taux, arrondie à l'unité (demi vers le haut) | Choix d'arrondi **à confirmer** (par ligne ou sur le total ?). |
| Une écriture générée ne se modifie pas à la main | Choix de conception : la comptabilité reste le reflet de l'opération. |

## 2. Schémas d'écritures produits (en brouillard)

| Opération | Écriture | À vérifier |
|---|---|---|
| Vente (facture) | Débit 411 Clients (TTC) ; crédit 701 Ventes de marchandises et/ou 706 Services vendus (HT) ; crédit 443 TVA facturée | Sous-comptes de TVA (4431…) selon le PCGO. |
| Règlement comptant ou ultérieur | Débit caisse 571x ou banque 521x ; crédit 411 | — |
| Dépense | Débit compte de charge de la catégorie (HT) ; débit 445 TVA récupérable ; crédit caisse ou banque | Correspondance catégories / comptes (fichier `serveur/src/domaine/tresorerie/categories.ts`). Déductibilité de la TVA selon la nature de la charge. |
| Transfert | Débit compte destinataire ; crédit compte d'origine | Faut-il passer par un compte de virements internes (585) ? |
| Annulation | Écriture inverse de l'écriture d'origine | — |

## 3. Points fiscaux et juridiques à vérifier

1. **Taux de TVA.** Aucun taux n'est codé en dur. La démonstration utilise 19,25 % (taux couramment cité pour le Cameroun, TVA et centimes additionnels compris) : **à confirmer dans la loi de finances en vigueur.**
2. **Mentions obligatoires de la facture** (NIU, RCCM, régime fiscal, centre des impôts, mentions d'exonération…) : la facture imprime celles qui sont renseignées et un texte libre (*Mentions imprimées sur les factures*). **Liste exacte à établir avec l'expert-comptable.**
3. **Facture normalisée / dispositifs de certification** : vérifier si l'administration fiscale impose un format, un timbre ou un dispositif de facturation certifié.
4. **Mobile money** : rattaché pour l'instant à un sous-compte de banque (521x). **Compte exact à confirmer** (52 ou 57 ?).
5. **Précompte, acompte d'impôt sur le revenu (AIR) et autres retenues** : non gérés.

## 4. Limites connues

- Pas d'**avoir** : une facture erronée ne peut pas encore être corrigée dans le logiciel.
- Pas de **rapprochement bancaire** ni d'import de relevés.
- Pas de **clôture de caisse journalière** (comptage, billetage, écart de caisse).
- La **démonstration en ligne** imprime l'aperçu HTML de la facture ; le PDF n'est produit que par le logiciel installé.
