-- Check existing bills too, once every linked trip exists. A database seeded before step 10 gets its demo trips
-- from the next seed run; until then the key stays NOT VALID (still enforced for new and changed rows).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM purchases p WHERE p.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.id = p.trip_id)) THEN
    ALTER TABLE purchases VALIDATE CONSTRAINT purchases_trip_id_trips_id_fk;
  END IF;
END $$;
