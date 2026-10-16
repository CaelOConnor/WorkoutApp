-- Up Migration
-- set_number now means a set's position within its exercise in a workout: 1..n per exercise,
-- with no gaps or duplicates (Squat 1-3, Bench 1-2). Before, the log screen numbered sets that
-- way, but "+ Add set" used the workout's highest + 1, and deletes left gaps. See ROADMAP.md.

-- 1. Renumber existing sets. ROW_NUMBER() is a window function: it numbers the rows of each
-- PARTITION (one workout's sets of one exercise) 1, 2, 3... in the ORDER BY given. Ordering by
-- the old set_number, then id, is the order the API showed them in, so no set moves.
-- Only rows whose number changes are written.
UPDATE sets s
SET set_number = numbered.n
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY workout_id, exercise_id ORDER BY set_number, id) AS n
  FROM sets
) numbered
WHERE s.id = numbered.id AND s.set_number <> numbered.n;

-- 2. One set per number per exercise in a workout. Added after the renumbering, which removed
-- any duplicates.
-- DEFERRABLE: Postgres checks a plain unique constraint after each row, so a statement that
-- shifts numbers by one (renumbering after a delete) can fail halfway, when one row reaches a
-- number the next row hasn't left yet. A DEFERRABLE constraint is checked once the statement
-- has finished. INITIALLY IMMEDIATE keeps that check at the end of each statement rather than
-- at COMMIT (which SET CONSTRAINTS ... DEFERRED could still ask for).
-- Its index (workout_id, exercise_id, set_number) also serves the "highest number for this
-- exercise" lookup when a set is added.
ALTER TABLE sets ADD CONSTRAINT sets_workout_exercise_set_number_key
  UNIQUE (workout_id, exercise_id, set_number) DEFERRABLE INITIALLY IMMEDIATE;

-- Down Migration
-- The old numbers aren't restored (nothing records them), but the old code accepts any numbers.

ALTER TABLE sets DROP CONSTRAINT sets_workout_exercise_set_number_key;
