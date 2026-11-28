-- 006 : profil d'entreprise (logo, couleurs, régime fiscal, patente) et signature des factures (code QR).

-- Logos : chaque envoi crée une version ; aucune n'est modifiée ni supprimée, pour qu'une facture
-- réimprimée garde le logo de la date de son émission. Le logo courant est désigné dans companies.settings.
CREATE TABLE company_logos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
    data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 524288),
    sha256 BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id)
);
CREATE TRIGGER company_logos_append_only BEFORE UPDATE OR DELETE ON company_logos FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER company_logos_no_truncate BEFORE TRUNCATE ON company_logos FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- Clé de signature Ed25519 des factures, une par entreprise, créée au premier besoin.
-- La clé privée est chiffrée par l'application (AES-256-GCM, GC_CLE_CHIFFREMENT) ; la clé publique est en clair.
-- Elle ne change pas : changer de clé rendrait invérifiables les factures déjà imprimées.
CREATE TABLE company_signing_keys (
    company_id UUID PRIMARY KEY DEFAULT current_company_id() REFERENCES companies(id),
    algorithm TEXT NOT NULL DEFAULT 'ed25519' CHECK (algorithm = 'ed25519'),
    public_key BYTEA NOT NULL,
    private_key_enc TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER company_signing_keys_append_only BEFORE UPDATE OR DELETE ON company_signing_keys FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER company_signing_keys_no_truncate BEFORE TRUNCATE ON company_signing_keys FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_logos', 'company_signing_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON company_logos, company_signing_keys TO gc_app;   -- ni UPDATE ni DELETE
GRANT SELECT ON company_logos, company_signing_keys TO gc_backup;
