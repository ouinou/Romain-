-- =====================================================================
-- RTMS 0002 — Sécurité de la base : rôles, RLS, intégrité, audit inviolable
-- Exécutée par le rôle propriétaire (rtms_owner), jamais par l'application.
-- Les mots de passe des rôles ne sont PAS ici : voir infra/postgres/init-roles.sh
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Rôles techniques (créés sans login ; le login est activé par l'exploitant) ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtms_app') THEN
    CREATE ROLE rtms_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtms_license') THEN
    CREATE ROLE rtms_license NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtms_readonly') THEN
    CREATE ROLE rtms_readonly NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Limites de sécurité côté serveur pour le rôle applicatif
ALTER ROLE rtms_app SET statement_timeout = '15s';
ALTER ROLE rtms_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE rtms_app SET lock_timeout = '5s';

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO rtms_app, rtms_license, rtms_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rtms_app, rtms_license, rtms_readonly;

-- Application : pas de DELETE sur les données métier, pas de UPDATE sur l'audit
GRANT SELECT, UPDATE                 ON companies        TO rtms_app;
GRANT SELECT, INSERT, UPDATE         ON users            TO rtms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO rtms_app;
GRANT SELECT, INSERT, UPDATE         ON records          TO rtms_app;
GRANT SELECT, INSERT                 ON audit_log        TO rtms_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq         TO rtms_app;
GRANT SELECT, INSERT, UPDATE         ON installation     TO rtms_app;

-- Serveur de licences : uniquement ses tables
GRANT SELECT, INSERT, UPDATE ON licenses, license_activations TO rtms_license;
GRANT SELECT, INSERT ON license_events TO rtms_license;
GRANT USAGE, SELECT ON SEQUENCE license_events_id_seq TO rtms_license;

-- Lecture seule (rapports / BI), soumise elle aussi à la RLS
GRANT SELECT ON companies, users, records TO rtms_readonly;

-- ---------- Contexte de session : société et utilisateur courants ----------
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

-- ---------- Row-Level Security : isolation stricte par société ----------
ALTER TABLE companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_companies ON companies
  USING (id = app_company_id()) WITH CHECK (id = app_company_id());
CREATE POLICY tenant_users ON users
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_role_permissions ON role_permissions
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_records ON records
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_audit_select ON audit_log FOR SELECT
  USING (company_id = app_company_id());
-- Les échecs de connexion d'un e-mail inconnu sont journalisés sans société
CREATE POLICY tenant_audit_insert ON audit_log FOR INSERT
  WITH CHECK (company_id IS NULL OR company_id = app_company_id());

-- ---------- Intégrité des enregistrements métier ----------
ALTER TABLE records ADD CONSTRAINT records_module_chk CHECK (module IN (
  'transport','transit','importexport','commerce','clients','fleet','staff',
  'maintenance','invoices','finance','documents'));
ALTER TABLE records ADD CONSTRAINT records_version_chk CHECK (version > 0);
ALTER TABLE records ADD CONSTRAINT records_data_obj_chk CHECK (jsonb_typeof(data) = 'object');
ALTER TABLE users   ADD CONSTRAINT users_status_chk CHECK (status IN ('active','disabled'));
ALTER TABLE records ADD CONSTRAINT records_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id);

-- Référence unique par module (numéro de facture, immatriculation, matricule...) hors annulés
CREATE UNIQUE INDEX records_reference_uq ON records (company_id, module, lower(reference))
  WHERE reference IS NOT NULL AND cancelled_at IS NULL;
-- Liste active (cas le plus fréquent)
CREATE INDEX records_active_idx ON records (company_id, module, created_at DESC)
  WHERE cancelled_at IS NULL;
-- Recherche approximative sur les VALEURS (pas les noms de champs), comme le prototype
ALTER TABLE records ADD COLUMN search_text text
  GENERATED ALWAYS AS (lower(jsonb_path_query_array(data, '$.*')::text)) STORED;
CREATE INDEX records_search_trgm ON records USING gin (search_text gin_trgm_ops);

CREATE OR REPLACE FUNCTION records_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Suppression physique interdite : utiliser une annulation tracée'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id <> OLD.id OR NEW.company_id <> OLD.company_id OR NEW.module <> OLD.module
     OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'Champs immuables modifiés sur records %', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Enregistrement annulé : modification interdite'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER records_guard_trg BEFORE UPDATE OR DELETE ON records
  FOR EACH ROW EXECUTE FUNCTION records_guard();

-- ---------- Journal d'audit chaîné (SHA-256) et immuable ----------
CREATE OR REPLACE FUNCTION audit_row_hash(prev text, r audit_log) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(
    coalesce(prev, '') || '|' || coalesce(r.company_id::text, '') || '|' ||
    coalesce(r.user_id::text, '') || '|' || r.action || '|' || r.entity || '|' ||
    coalesce(r.entity_id, '') || '|' || coalesce(r.before::text, '') || '|' ||
    coalesce(r.after::text, '') || '|' ||
    to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE last_hash text;
BEGIN
  -- Une chaîne par société ; le verrou sérialise les insertions concurrentes
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || coalesce(NEW.company_id::text, '-')));
  SELECT hash INTO last_hash FROM audit_log
   WHERE company_id IS NOT DISTINCT FROM NEW.company_id
   ORDER BY id DESC LIMIT 1;
  NEW.at := date_trunc('milliseconds', clock_timestamp());
  NEW.prev_hash := last_hash;
  NEW.hash := audit_row_hash(last_hash, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain_trg BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_chain();

CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en ajout seul' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_immutable_trg BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();
-- TRUNCATE contourne les triggers de ligne : on le bloque aussi
CREATE TRIGGER audit_no_truncate_trg BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();

-- Vérifie la chaîne d'une société ; renvoie l'id de la première ligne altérée (NULL si intègre)
CREATE OR REPLACE FUNCTION audit_verify(p_company uuid) RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE r audit_log; prev text := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_log WHERE company_id IS NOT DISTINCT FROM p_company ORDER BY id LOOP
    IF r.prev_hash IS DISTINCT FROM prev OR r.hash <> audit_row_hash(prev, r) THEN
      RETURN r.id;
    END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION audit_verify(uuid) TO rtms_app;

-- ---------- Authentification : recherche d'un compte avant de connaître la société ----------
-- SECURITY DEFINER : seule porte d'entrée hors RLS, ne renvoie que le strict nécessaire.
CREATE OR REPLACE FUNCTION auth_find_user(p_email text)
RETURNS TABLE (id uuid, company_id uuid, password_hash text, status text,
               locked_until timestamptz, mfa_enabled boolean, role_key text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.company_id, u.password_hash, u.status, u.locked_until, u.mfa_enabled, u.role_key, u.full_name
    FROM users u WHERE u.email = lower(p_email) LIMIT 1
$$;
REVOKE ALL ON FUNCTION auth_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO rtms_app;

ALTER TABLE users ADD CONSTRAINT users_email_lower_chk CHECK (email = lower(email));
