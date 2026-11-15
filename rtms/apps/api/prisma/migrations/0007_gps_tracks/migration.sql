-- =====================================================================
-- RTMS 0007 — Suivi GPS des trajets, rattaché au parc automobile.
-- Un trajet = une trace GPS (points horodatés) d'un véhicule de la flotte,
-- éventuellement liée à une mission de transport. Les chiffres (distance,
-- temps de roulage, arrêts) sont calculés par le serveur à l'import.
-- Nouvelle table seulement : aucune donnée existante n'est modifiée.
-- =====================================================================
CREATE TABLE gps_tracks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES companies(id),
  vehicle_id    uuid        NOT NULL REFERENCES records(id),
  mission_id    uuid        REFERENCES records(id),
  driver        text        CHECK (length(driver) <= 120),
  label         text        CHECK (length(label) <= 200),
  source        text        NOT NULL CHECK (source IN ('gpx', 'kml', 'csv', 'telephone')),
  file_name     text        CHECK (length(file_name) <= 200),
  started_at    timestamptz(3) NOT NULL,
  ended_at      timestamptz(3) NOT NULL,
  point_count   integer     NOT NULL CHECK (point_count BETWEEN 2 AND 50000),
  distance_m    integer     NOT NULL CHECK (distance_m >= 0),
  moving_s      integer     NOT NULL CHECK (moving_s >= 0),
  max_speed_kmh numeric(6,1) NOT NULL CHECK (max_speed_kmh >= 0),
  stops         jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(stops) = 'array'),
  bbox          jsonb       NOT NULL CHECK (jsonb_typeof(bbox) = 'array'),
  -- [[secondes depuis le départ, latitude, longitude], …]
  points        jsonb       NOT NULL CHECK (jsonb_typeof(points) = 'array'),
  created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    uuid        NOT NULL REFERENCES users(id),
  cancelled_at  timestamptz(3),
  cancelled_by  uuid        REFERENCES users(id),
  cancel_reason text,
  CONSTRAINT gps_tracks_time_chk CHECK (ended_at >= started_at AND ended_at - started_at <= interval '7 days')
);
CREATE INDEX gps_tracks_vehicle_idx ON gps_tracks (company_id, vehicle_id, started_at DESC) WHERE cancelled_at IS NULL;
CREATE INDEX gps_tracks_mission_idx ON gps_tracks (company_id, mission_id) WHERE mission_id IS NOT NULL;

ALTER TABLE gps_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_gps_tracks ON gps_tracks
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE ON gps_tracks TO rtms_app;
GRANT SELECT ON gps_tracks TO rtms_readonly;

-- Même règle que les enregistrements : pas de suppression physique, la trace ne se modifie pas,
-- seule l'annulation (tracée) est permise.
CREATE OR REPLACE FUNCTION gps_tracks_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Suppression physique interdite : utiliser une annulation tracée'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Trajet annulé : modification interdite' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ROW(NEW.id, NEW.company_id, NEW.vehicle_id, NEW.started_at, NEW.ended_at, NEW.points, NEW.distance_m, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM ROW(OLD.id, OLD.company_id, OLD.vehicle_id, OLD.started_at, OLD.ended_at, OLD.points, OLD.distance_m, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'Trace GPS immuable (trajet %)', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gps_tracks_guard_trg BEFORE UPDATE OR DELETE ON gps_tracks
  FOR EACH ROW EXECUTE FUNCTION gps_tracks_guard();
