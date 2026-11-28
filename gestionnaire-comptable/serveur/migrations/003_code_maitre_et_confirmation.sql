-- Migration 003 : code maître de l'entreprise et confirmation des opérations sensibles.
--
-- Code maître : secret de récupération détenu par l'entreprise (pas par l'éditeur, pas par le serveur).
--   • généré à la création de l'entreprise, affiché une seule fois ;
--   • seul son hachage Argon2id est stocké ;
--   • il sert uniquement à rétablir l'accès d'un administrateur (mot de passe ou téléphone MFA perdu) ;
--   • usage unique : après emploi, il doit être régénéré ;
--   • tentatives limitées, chaque usage est journalisé et notifié à tous les administrateurs.
--
-- Confirmation : un administrateur ressaisit son mot de passe (et son code MFA) avant une opération
-- sensible. La confirmation est valable quelques minutes pour la session courante uniquement.

ALTER TABLE companies
  ADD COLUMN master_code_hash TEXT,
  ADD COLUMN master_code_created_at TIMESTAMPTZ,
  ADD COLUMN master_code_failed_count INTEGER NOT NULL DEFAULT 0 CHECK (master_code_failed_count >= 0),
  ADD COLUMN master_code_locked_until TIMESTAMPTZ;

GRANT UPDATE (master_code_hash, master_code_created_at, master_code_failed_count, master_code_locked_until)
  ON companies TO gc_app;

ALTER TABLE user_sessions ADD COLUMN reauth_at TIMESTAMPTZ;

-- Désactivation automatique des comptes inutilisés : la date de réactivation remet le compteur à zéro,
-- sinon un compte réactivé serait aussitôt redésactivé à sa connexion suivante.
ALTER TABLE app_users ADD COLUMN reactivated_at TIMESTAMPTZ;
