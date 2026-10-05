-- Up Migration
-- One exercise name per owner, so the seed can use ON CONFLICT DO NOTHING.
-- (created_by, name) rather than just name: later, two users may each have their own "Curl".
-- NULLS NOT DISTINCT (Postgres 15+): built-in exercises have created_by NULL, and by default
-- NULL never equals NULL, so two built-in "Squat" rows would otherwise both be allowed.

CREATE UNIQUE INDEX exercises_created_by_name_key ON exercises (created_by, name) NULLS NOT DISTINCT;

-- Down Migration

DROP INDEX exercises_created_by_name_key;
