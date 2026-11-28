-- Migration 002 : corrections et compléments du schéma initial.
--
-- Ce que cette migration ajoute ou corrige :
--   1. isolation des entreprises par Row-Level Security (RLS) dans PostgreSQL ;
--   2. comptes invités sans mot de passe, e-mail unique sans tenir compte de la casse ;
--   3. expiration des accès, double authentification (TOTP), sessions, jetons à usage unique ;
--   4. catalogue de permissions systématique « module.action » (10 actions par module) ;
--   5. journal d'audit en ajout seul, avec séquence et empreintes SHA-256 chaînées calculées par la base ;
--   6. journal système pour les événements sans entreprise (code inconnu, opérations techniques) ;
--   7. notifications ;
--   8. droits SQL minimaux pour le compte applicatif gc_app.
--
-- Prérequis : les rôles gc_owner et gc_app existent (voir sql/00-roles-postgresql.sql).

---------------------------------------------------------------------------
-- Utilitaires
---------------------------------------------------------------------------

-- Entreprise du contexte courant. Le serveur la fixe au début de chaque transaction
-- avec set_config('app.company_id', ..., true). Sans contexte : NULL, donc aucune ligne visible.
CREATE FUNCTION current_company_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

---------------------------------------------------------------------------
-- Entreprises
---------------------------------------------------------------------------

ALTER TABLE companies
  ADD CONSTRAINT companies_code_format CHECK (company_code ~ '^[A-Z0-9][A-Z0-9-]{3,31}$'),
  ADD COLUMN country_code char(2) NOT NULL DEFAULT 'CM',
  ADD COLUMN currency_code char(3) NOT NULL DEFAULT 'XAF',
  ADD COLUMN rccm text,
  ADD COLUMN niu text,
  ADD COLUMN address text,
  ADD COLUMN phone text,
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Retrouver une entreprise par son code avant l'authentification.
-- SECURITY DEFINER : s'exécute avec les droits du propriétaire (la table companies n'est pas en FORCE RLS).
-- Ne renvoie que l'identifiant d'une entreprise active.
CREATE FUNCTION company_id_by_code(p_code text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT id FROM companies WHERE company_code = upper(p_code) AND status = 'active' $$;
REVOKE ALL ON FUNCTION company_id_by_code(text) FROM PUBLIC;

---------------------------------------------------------------------------
-- Utilisateurs
---------------------------------------------------------------------------

-- Un compte invité n'a pas encore de mot de passe : il le choisit en acceptant l'invitation.
ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;

-- « locked » faisait doublon avec locked_until : le verrouillage est temporaire et porté par la date.
ALTER TABLE app_users DROP CONSTRAINT app_users_status_check;
ALTER TABLE app_users ALTER COLUMN status SET DEFAULT 'invited';
ALTER TABLE app_users ADD CONSTRAINT app_users_status_check
  CHECK (status IN ('invited', 'active', 'disabled'));
ALTER TABLE app_users ADD CONSTRAINT app_users_active_has_password
  CHECK (status <> 'active' OR password_hash IS NOT NULL);

-- Paul@x.cm et paul@x.cm désignent la même personne.
ALTER TABLE app_users DROP CONSTRAINT app_users_company_id_email_key;
CREATE UNIQUE INDEX app_users_company_email_ci ON app_users (company_id, lower(email));

ALTER TABLE app_users
  ADD COLUMN access_expires_at timestamptz,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_secret_enc text,
  ADD COLUMN mfa_pending_secret_enc text,
  ADD COLUMN mfa_last_step bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT app_users_mfa_secret CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL);

CREATE TRIGGER app_users_updated_at BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

---------------------------------------------------------------------------
-- Rôles et catalogue de permissions
---------------------------------------------------------------------------

ALTER TABLE roles
  ADD COLUMN description text,
  ADD COLUMN mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at timestamptz;

CREATE TABLE permission_modules (
    module_key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE TABLE permission_actions (
    action_key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

INSERT INTO permission_modules (module_key, label, sort_order) VALUES
 ('users',      'Utilisateurs', 10),
 ('roles',      'Rôles et permissions', 20),
 ('audit',      'Journal d''audit', 30),
 ('company',    'Paramètres de l''entreprise', 40),
 ('backups',    'Sauvegardes', 50),
 ('accounting', 'Comptabilité générale', 60),
 ('treasury',   'Trésorerie et banques', 70),
 ('cash',       'Caisse', 80),
 ('sales',      'Ventes et clients', 90),
 ('purchases',  'Achats et fournisseurs', 100),
 ('stock',      'Stocks', 110),
 ('hr',         'Ressources humaines', 120),
 ('payroll',    'Paie', 130),
 ('reports',    'Rapports et états financiers', 140);

INSERT INTO permission_actions (action_key, label, sort_order) VALUES
 ('read',    'Consulter', 1),
 ('create',  'Créer', 2),
 ('update',  'Modifier', 3),
 ('submit',  'Soumettre', 4),
 ('approve', 'Valider', 5),
 ('cancel',  'Annuler', 6),
 ('archive', 'Archiver', 7),
 ('print',   'Imprimer', 8),
 ('export',  'Exporter', 9),
 ('admin',   'Administrer', 10);

-- Les clés de la migration 001 (users.disable, finance.transactions.correct…) sont remplacées
-- par la grille module × action. Aucune n'est encore attribuée à un rôle sur une base neuve.
ALTER TABLE permissions
  ADD COLUMN module_key TEXT REFERENCES permission_modules(module_key),
  ADD COLUMN action_key TEXT REFERENCES permission_actions(action_key);

DELETE FROM permissions p
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id);

INSERT INTO permissions (permission_key, description, module_key, action_key)
SELECT m.module_key || '.' || a.action_key, m.label || ' : ' || lower(a.label), m.module_key, a.action_key
  FROM permission_modules m CROSS JOIN permission_actions a;

ALTER TABLE permissions
  ALTER COLUMN module_key SET NOT NULL,
  ALTER COLUMN action_key SET NOT NULL,
  ADD CONSTRAINT permissions_module_action_key UNIQUE (module_key, action_key),
  ADD CONSTRAINT permissions_key_matches CHECK (permission_key = module_key || '.' || action_key);

---------------------------------------------------------------------------
-- Sessions et jetons à usage unique
---------------------------------------------------------------------------

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE,          -- SHA-256 du jeton ; le jeton lui-même n'est jamais stocké
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,           -- durée maximale, quelle que soit l'activité
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    ip_address INET,
    user_agent TEXT,
    UNIQUE (id, company_id),
    FOREIGN KEY (user_id, company_id) REFERENCES app_users(id, company_id)
);
CREATE INDEX user_sessions_active ON user_sessions (company_id, user_id) WHERE revoked_at IS NULL;

CREATE TABLE user_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('invitation', 'password_reset')),
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, company_id) REFERENCES app_users(id, company_id),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id)
);

---------------------------------------------------------------------------
-- Notifications
---------------------------------------------------------------------------

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    recipient_user_id UUID,                    -- destinataire précis…
    required_permission TEXT REFERENCES permissions(permission_key),  -- …ou toute personne ayant ce droit
    kind TEXT NOT NULL CHECK (kind IN ('info', 'warning', 'security')),
    title TEXT NOT NULL,
    body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, company_id),
    CHECK (recipient_user_id IS NOT NULL OR required_permission IS NOT NULL),
    FOREIGN KEY (recipient_user_id, company_id) REFERENCES app_users(id, company_id)
);
CREATE INDEX notifications_company_time ON notifications (company_id, created_at DESC);

CREATE TABLE notification_reads (
    company_id UUID NOT NULL REFERENCES companies(id),
    notification_id UUID NOT NULL,
    user_id UUID NOT NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id),
    FOREIGN KEY (notification_id, company_id) REFERENCES notifications(id, company_id),
    FOREIGN KEY (user_id, company_id) REFERENCES app_users(id, company_id)
);

---------------------------------------------------------------------------
-- Journal d'audit : ajout seul, séquence par entreprise, empreintes chaînées
---------------------------------------------------------------------------

ALTER TABLE audit_events
  ADD COLUMN event_uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN sequence_no BIGINT,
  ADD COLUMN action TEXT,
  ADD COLUMN previous_value JSONB,
  ADD COLUMN new_value JSONB,
  ADD COLUMN reason TEXT,
  ADD COLUMN session_id UUID,
  ADD COLUMN ip_address INET,
  ADD CONSTRAINT audit_events_session_fk FOREIGN KEY (session_id, company_id)
      REFERENCES user_sessions(id, company_id);

-- Contenu couvert par l'empreinte. Toute modification d'un de ces champs est détectée.
CREATE FUNCTION audit_event_hash(e audit_events) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(digest(
    coalesce(e.previous_hash, '') || '|' || jsonb_build_array(
      e.event_uuid, e.company_id, e.sequence_no,
      to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      e.actor_user_id, e.session_id, e.event_type, e.action, e.object_type, e.object_id,
      e.outcome, e.event_details, e.previous_value, e.new_value, e.reason, host(e.ip_address)
    )::text, 'sha256'), 'hex')
$$;

CREATE FUNCTION audit_genesis_hash(p_company uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS
$$ SELECT encode(digest('GC-GENESIS:' || p_company::text, 'sha256'), 'hex') $$;

-- Avant chaque insertion : la base impose l'horodatage serveur, le numéro de séquence et l'empreinte.
-- Le verrou consultatif sérialise les insertions d'une même entreprise pour garder une chaîne linéaire.
CREATE FUNCTION audit_events_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit_events:' || NEW.company_id::text, 0));
  SELECT a.sequence_no, a.event_hash INTO last_seq, last_hash
    FROM audit_events a
   WHERE a.company_id = NEW.company_id
   ORDER BY a.sequence_no DESC
   LIMIT 1;
  NEW.event_uuid    := gen_random_uuid();
  NEW.occurred_at   := clock_timestamp();
  NEW.sequence_no   := coalesce(last_seq, 0) + 1;
  NEW.previous_hash := coalesce(last_hash, audit_genesis_hash(NEW.company_id));
  NEW.event_hash    := audit_event_hash(NEW);
  RETURN NEW;
END $$;

CREATE TRIGGER audit_events_chain BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_chain();

CREATE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul : % refusé.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- Déclencheur au niveau de l'instruction : il se déclenche même si aucune ligne n'est visible ou ciblée.
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

ALTER TABLE audit_events
  ALTER COLUMN sequence_no SET NOT NULL,
  ALTER COLUMN action SET NOT NULL,
  ALTER COLUMN previous_hash SET NOT NULL,
  ALTER COLUMN event_hash SET NOT NULL,
  ADD CONSTRAINT audit_events_company_sequence UNIQUE (company_id, sequence_no);

-- Recalcule toute la chaîne d'une entreprise et liste les anomalies (aucune ligne = chaîne intacte).
-- Limite connue : la suppression des derniers événements ne casse pas la chaîne restante.
-- Elle est détectée en comparant avec les ancrages exportés hors de la base (voir journal:verifier).
CREATE FUNCTION audit_verify_chain(p_company uuid) RETURNS TABLE (seq bigint, problem text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_events;
  expected_prev text := audit_genesis_hash(p_company);
  expected_seq bigint := 1;
BEGIN
  FOR r IN SELECT * FROM audit_events a WHERE a.company_id = p_company ORDER BY a.sequence_no LOOP
    IF r.sequence_no <> expected_seq THEN
      seq := r.sequence_no;
      problem := format('événements %s à %s absents', expected_seq, r.sequence_no - 1);
      RETURN NEXT;
    END IF;
    IF r.previous_hash IS DISTINCT FROM expected_prev THEN
      seq := r.sequence_no; problem := 'chaînage rompu avec l''événement précédent'; RETURN NEXT;
    END IF;
    IF r.event_hash IS DISTINCT FROM audit_event_hash(r) THEN
      seq := r.sequence_no; problem := 'contenu modifié après enregistrement'; RETURN NEXT;
    END IF;
    expected_prev := r.event_hash;
    expected_seq := r.sequence_no + 1;
  END LOOP;
END $$;

---------------------------------------------------------------------------
-- Journal système : événements sans entreprise identifiée et opérations techniques
---------------------------------------------------------------------------

CREATE TABLE system_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    event_type TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET
);
CREATE TRIGGER system_events_append_only BEFORE UPDATE OR DELETE ON system_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER system_events_no_truncate BEFORE TRUNCATE ON system_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

---------------------------------------------------------------------------
-- Isolation des entreprises (Row-Level Security)
---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_users', 'roles', 'user_roles', 'role_permissions', 'audit_events',
                           'user_sessions', 'user_tokens', 'notifications', 'notification_reads'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT current_company_id()', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I
                      USING (company_id = current_company_id())
                      WITH CHECK (company_id = current_company_id())', t);
  END LOOP;
END $$;

-- companies : RLS active pour gc_app, mais pas forcée pour le propriétaire,
-- afin que company_id_by_code() puisse résoudre un code avant la connexion.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_self ON companies
  USING (id = current_company_id()) WITH CHECK (id = current_company_id());

---------------------------------------------------------------------------
-- Droits SQL du compte applicatif (moindre privilège)
---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gc_app;

GRANT SELECT ON companies TO gc_app;
GRANT UPDATE (legal_name, rccm, niu, address, phone, settings) ON companies TO gc_app;
GRANT SELECT ON permissions, permission_modules, permission_actions TO gc_app;
GRANT SELECT, INSERT, UPDATE ON app_users, roles, user_sessions, user_tokens TO gc_app;
GRANT SELECT, INSERT, DELETE ON user_roles, role_permissions TO gc_app;
GRANT SELECT, INSERT ON notifications, notification_reads TO gc_app;
GRANT SELECT, INSERT ON audit_events TO gc_app;   -- ni UPDATE, ni DELETE, ni TRUNCATE
GRANT INSERT ON system_events TO gc_app;           -- écriture seule

GRANT EXECUTE ON FUNCTION company_id_by_code(text) TO gc_app;

-- Rôle de sauvegarde : lecture seule de toutes les tables (BYPASSRLS est porté par le rôle lui-même).
GRANT USAGE ON SCHEMA public TO gc_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gc_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO gc_backup;
GRANT INSERT ON system_events TO gc_backup;      -- pour tracer ses propres sauvegardes
