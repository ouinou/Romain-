-- =====================================================================
-- RTMS 0003 — Correctif : ordre de la chaîne d'audit sous concurrence
-- Défaut détecté par le test de restauration après le test de charge k6 :
-- l'id (séquence) était attribué AVANT la prise du verrou dans le trigger.
-- Deux insertions concurrentes pouvaient donc être chaînées dans un ordre
-- différent de celui de leurs id, et audit_verify() signalait une rupture
-- sans qu'aucune donnée n'ait été falsifiée.
-- Correctif : l'id est (ré)attribué dans le trigger, APRÈS le verrou.
-- Les lignes déjà écrites ne sont pas modifiées (journal immuable).
-- =====================================================================
CREATE OR REPLACE FUNCTION audit_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || coalesce(NEW.company_id::text, '-')));
  -- Sous verrou : l'ordre des id reflète l'ordre de chaînage de chaque société
  NEW.id := nextval(pg_get_serial_sequence('audit_log', 'id'));
  SELECT hash INTO last_hash FROM audit_log
   WHERE company_id IS NOT DISTINCT FROM NEW.company_id
   ORDER BY id DESC LIMIT 1;
  NEW.at := date_trunc('milliseconds', clock_timestamp());
  NEW.prev_hash := last_hash;
  NEW.hash := audit_row_hash(last_hash, NEW);
  RETURN NEW;
END $$;
