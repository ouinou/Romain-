-- =====================================================================
-- RTMS 0004 — Fonctions de conversion tolérantes pour le tri, les filtres
-- et les alertes de l'interface. Les données importées du prototype peuvent
-- contenir des dates ou nombres mal saisis : ces fonctions renvoient NULL
-- au lieu de faire échouer la requête. Aucune donnée n'est modifiée.
-- =====================================================================
CREATE OR REPLACE FUNCTION rtms_num(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v ~ '^\s*-?\d+(\.\d+)?\s*$' THEN v::numeric END
$$;

CREATE OR REPLACE FUNCTION rtms_date(v text) RETURNS date
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF v ~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN v::date; END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL; -- ex. 2026-02-31
END $$;

GRANT EXECUTE ON FUNCTION rtms_num(text), rtms_date(text) TO rtms_app, rtms_readonly;
