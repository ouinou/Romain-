# Module Comptabilité générale (SYSCOHADA révisé), version 0.1

Ce document dit ce que le module applique, d'où vient chaque règle, et ce qui reste à vérifier. **Aucune règle de ce module n'a encore été validée par un expert-comptable inscrit à l'Ordre.** Cette validation est indispensable avant toute utilisation sur des comptes réels.

## 1. Sources

| Source | Statut |
|---|---|
| Acte uniforme relatif au droit comptable et à l'information financière (AUDCIF), adopté le 26 janvier 2017, applicable depuis le 1er janvier 2018 aux comptes personnels | Existence et dates vérifiées sur ohada.com et un commentaire Deloitte. **Texte intégral non consulté dans cette session.** |
| Système comptable OHADA (SYSCOHADA révisé) et Plan comptable général OHADA (PCGO), adopté avec l'AUDCIF | Existence vérifiée. **Nomenclature officielle des comptes non consultée** : elle est publiée dans des ouvrages payants. |
| Acte uniforme de 2000 (abrogé), article 19 : livres obligatoires (journal, grand livre avec balance générale, livre d'inventaire) | Lu dans un commentaire. **Numérotation et contenu à confirmer dans l'AUDCIF.** |

## 2. Règles appliquées

Les règles marquées « Base » sont garanties par PostgreSQL (migration `004_comptabilite.sql`). Elles s'appliquent même si une requête SQL contourne l'application.

| Règle | Où | Source et statut |
|---|---|---|
| Partie double : une écriture validée a au moins deux lignes et total débit = total crédit | Base | Principe universel de la comptabilité en partie double. Sûr. |
| Une ligne porte soit un débit, soit un crédit, strictement positif | Base | Pratique standard de tenue. Sûr. |
| Montants entiers en FCFA (0 décimale) | Base | Le franc CFA (XAF) n'a pas de subdivision en usage. Le nombre de décimales est un paramètre par devise (`currency_decimals`). |
| Imputation uniquement sur des comptes de 3 chiffres et plus ; les classes (1 chiffre) et comptes principaux (2 chiffres) servent au regroupement | Base | Usage courant des plans de comptes OHADA. **À vérifier** : le PCGO peut imposer d'imputer sur un niveau plus fin pour certains comptes. |
| Classe 9 (engagements hors bilan, comptabilité analytique) non imputable en comptabilité générale | Base | Pratique courante. **À vérifier.** |
| Date de l'écriture comprise dans un exercice ouvert | Base | Rattachement des opérations à l'exercice. Sûr. |
| Exercice de 12 mois, jusqu'à 24 mois toléré (premier exercice) ; pas de chevauchement | Base | **À vérifier dans l'AUDCIF** (durée de l'exercice et exceptions). |
| Numérotation continue, sans trou, par journal et par exercice, attribuée à la validation | Base | Exigence usuelle de chronologie et d'irréversibilité. **Article de l'AUDCIF à citer.** |
| Écriture validée intangible ; correction par extourne (contre-passation) motivée, puis nouvelle écriture | Base | Principe d'intangibilité des enregistrements validés. **Article de l'AUDCIF à citer.** |
| Une extourne ne s'extourne pas ; une écriture ne s'extourne qu'une fois | Base | Choix de conception, pour garder une piste d'audit simple. |
| Séparation saisie / validation, activée par défaut et réglable par l'entreprise | Base | Bonne pratique de contrôle interne (pas une obligation légale identifiée). Décision du porteur du projet. |
| Clôture d'exercice définitive, refusée s'il reste des brouillards | Base | Principe de clôture. **Les travaux de clôture (inventaire, résultat, à-nouveaux) ne sont pas encore automatisés.** |
| Référence de pièce justificative obligatoire | Application | Principe de justification des écritures. Le stockage des pièces viendra plus tard. |
| Brouillard enregistrable déséquilibré | Application | Décision du porteur du projet : on ne perd pas un travail en cours. |

## 3. Plan de comptes fourni

- **136 comptes** : les 9 classes, 74 comptes principaux (2 chiffres) et 53 comptes divisionnaires d'usage courant (3 chiffres).
- **Tous sont marqués « À vérifier »**, dans la base (`account_reference.to_verify`) et dans l'interface.
- La liste a été établie de mémoire professionnelle, sans le texte officiel. Points de vigilance connus :
  - certains intitulés ont évolué entre l'ancien et le nouveau SYSCOHADA, par exemple les classes 8 et 9, le compte 17 ou les comptes de dépréciation ;
  - le numéro 20 (ancien « charges immobilisées ») n'est volontairement pas repris ;
  - les sous-comptes de TVA (443x, 445x) sont simplifiés.
- **Pour charger le plan officiel :** menu *Plan comptable* → *Importer un plan (CSV)*, au format `numero;libelle`. L'import ajoute les comptes absents et ne modifie aucun compte existant.

## 4. Comptes protégés

Conformément au cahier des charges, le comptable n'accède pas d'office aux banques, aux salaires ni au résultat global. Ces groupes sont réglables par l'entreprise (*Exercices et paramètres*).

| Comptes commençant par | Permission exigée |
|---|---|
| 52 Banques, 56 Banques, crédits de trésorerie | `treasury.read` |
| 42 Personnel, 66 Charges de personnel | `payroll.read` |
| 13 Résultat net de l'exercice | `reports.read` |

**Effets pour un utilisateur sans la permission :**
- les lignes de ces comptes sont absentes du grand livre et de la balance ;
- les écritures qui les touchent sont absentes de la liste et introuvables par leur identifiant ;
- toute imputation sur ces comptes est refusée, et le refus est tracé ;
- le résultat de la période n'est pas affiché.

La balance porte alors la mention « partielle » : une balance filtrée n'est pas une balance comptable.

**Limite connue.** Le résultat peut se recalculer à partir des comptes de charges et de produits visibles. Protéger le résultat demande donc aussi de protéger les classes 6 et 7, ce que l'entreprise peut faire dans les paramètres.

## 5. États produits

- **Grand livre :** par compte, avec le solde au début de la période, les mouvements, le solde progressif et le solde final. Par défaut, seules les écritures validées sont prises en compte ; les brouillards peuvent être inclus pour un document de travail.
- **Balance générale :** mouvements et soldes par compte, sous-totaux par classe, contrôle d'équilibre, et résultat (classes 6 à 8) pour les personnes autorisées.
- **Exports CSV :** séparateur « ; », encodage UTF-8. Ils demandent la permission `accounting.export` et sont tracés dans le journal d'audit.

## 6. Hors du périmètre de cette version

- **À-nouveaux :** pas encore de report automatique des soldes de bilan à l'ouverture de l'exercice suivant. Le solde d'ouverture du grand livre ne couvre que l'exercice en cours.
- **Calcul et affectation du résultat de clôture**, et livre d'inventaire.
- **Pièces justificatives** jointes (stockage de fichiers et contrôle des formats).
- **Périodes mensuelles** verrouillables.
- **Comptes de tiers auxiliaires** (fournisseurs et clients nominatifs) et lettrage.
- **TVA et fiscalité camerounaise :** les taux ne sont pas codés en dur ; un module de paramètres fiscaux sera nécessaire, à alimenter depuis les textes en vigueur (loi de finances, Code général des impôts du Cameroun).
- **États financiers SYSCOHADA :** bilan, compte de résultat, tableau des flux de trésorerie, notes annexes.

## 7. Questions à poser à l'expert-comptable

1. Confirmer ou corriger la liste des 136 comptes, ou fournir le fichier officiel du PCGO à importer.
2. Niveau minimal d'imputation exigé (3 chiffres suffisent-ils ?).
3. Articles de l'AUDCIF sur la chronologie, l'intangibilité, la numérotation et la clôture, à citer dans le logiciel.
4. Durée maximale du premier exercice.
5. Traitement attendu des à-nouveaux et de l'affectation du résultat.
6. Liste des comptes à protéger par défaut (faut-il ajouter les classes 6 et 7 ?).
