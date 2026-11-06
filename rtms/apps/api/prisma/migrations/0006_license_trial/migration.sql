-- =====================================================================
-- RTMS 0006 — Période d'essai de la licence (installation locale).
-- Le début de l'essai est la date de création de la ligne « installation »
-- (premier démarrage). clock_high_water garde la date la plus récente vue
-- par le serveur : reculer l'horloge du PC ne rallonge pas l'essai.
-- Ajout d'une colonne facultative : aucune donnée existante n'est modifiée.
-- =====================================================================
ALTER TABLE installation ADD COLUMN clock_high_water timestamptz(3);
