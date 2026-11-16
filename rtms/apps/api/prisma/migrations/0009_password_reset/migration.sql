-- =====================================================================
-- RTMS 0009 — Mot de passe oublié et changement obligatoire.
-- 1. users.must_change_password : mot de passe provisoire (nouvel
--    utilisateur) à remplacer à la première connexion. Les comptes
--    existants ne sont pas concernés (valeur par défaut false).
-- 2. password_resets : codes de réinitialisation donnés par
--    l'administrateur. Seule l'empreinte SHA-256 du code est stockée ;
--    usage unique, validité limitée (30 minutes, fixée par le serveur).
-- 3. auth_redeem_reset : consommation atomique d'un code, avant
--    connexion (donc sans contexte de société), comme auth_find_user.
-- Aucune donnée existante n'est modifiée.
-- =====================================================================
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- auth_find_user renvoie désormais aussi must_change_password (le type de retour change : DROP puis CREATE)
DROP FUNCTION auth_find_user(text);
CREATE FUNCTION auth_find_user(p_email text)
RETURNS TABLE (id uuid, company_id uuid, password_hash text, status text,
               locked_until timestamptz, mfa_enabled boolean, role_key text, full_name text,
               must_change_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.company_id, u.password_hash, u.status, u.locked_until, u.mfa_enabled, u.role_key, u.full_name, u.must_change_password
    FROM users u WHERE u.email = lower(p_email) LIMIT 1
$$;
REVOKE ALL ON FUNCTION auth_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO rtms_app;

CREATE TABLE password_resets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES companies(id),
  user_id     uuid        NOT NULL REFERENCES users(id),
  token_hash  text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz(3) NOT NULL,
  used_at     timestamptz(3),
  created_by  uuid        NOT NULL REFERENCES users(id),
  created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT password_resets_ttl_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id) WHERE used_at IS NULL;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_password_resets ON password_resets
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE ON password_resets TO rtms_app;

-- Consomme un code : il doit appartenir au compte de cet e-mail, ne pas être utilisé ni expiré.
-- L'UPDATE … RETURNING est atomique : deux essais simultanés ne peuvent pas utiliser le même code.
CREATE FUNCTION auth_redeem_reset(p_email text, p_token_hash text)
RETURNS TABLE (user_id uuid, company_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE password_resets r SET used_at = now()
    FROM users u
   WHERE r.token_hash = p_token_hash AND r.used_at IS NULL AND r.expires_at > now()
     AND u.id = r.user_id AND u.email = lower(p_email) AND u.status = 'active'
  RETURNING r.user_id, r.company_id
$$;
REVOKE ALL ON FUNCTION auth_redeem_reset(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_redeem_reset(text, text) TO rtms_app;
