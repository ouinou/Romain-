-- =====================================================================
-- RTMS 0005 — Numérotation automatique des documents (factures).
-- Un compteur par société, par module et par année. L'incrément se fait
-- par INSERT … ON CONFLICT DO UPDATE : la ligne est verrouillée jusqu'à la
-- fin de la transaction, donc deux postes qui enregistrent au même moment
-- obtiennent deux numéros différents. Aucune donnée existante n'est modifiée.
-- =====================================================================
CREATE TABLE document_counters (
  company_id uuid    NOT NULL REFERENCES companies(id),
  module     text    NOT NULL,
  year       integer NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  last_value integer NOT NULL CHECK (last_value >= 0),
  PRIMARY KEY (company_id, module, year)
);

ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_document_counters ON document_counters
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE ON document_counters TO rtms_app;
GRANT SELECT ON document_counters TO rtms_readonly;

-- Prochain numéro. Au premier appel de l'année, le compteur part du plus grand
-- numéro déjà saisi au format PREFIXE-AAAA-NNNN (factures existantes ou importées),
-- pour ne jamais redonner un numéro déjà utilisé.
CREATE OR REPLACE FUNCTION next_document_number(p_company uuid, p_module text, p_prefix text, p_year integer)
RETURNS integer LANGUAGE sql VOLATILE AS $$
  INSERT INTO document_counters AS c (company_id, module, year, last_value)
  VALUES (p_company, p_module, p_year, 1 + COALESCE((
    SELECT max(substring(reference FROM '^' || p_prefix || '-' || p_year || '-(\d{1,9})$')::integer)
      FROM records
     WHERE company_id = p_company AND module = p_module
       AND reference ~ ('^' || p_prefix || '-' || p_year || '-\d{1,9}$')), 0))
  ON CONFLICT (company_id, module, year) DO UPDATE SET last_value = c.last_value + 1
  RETURNING last_value
$$;
GRANT EXECUTE ON FUNCTION next_document_number(uuid, text, text, integer) TO rtms_app;
