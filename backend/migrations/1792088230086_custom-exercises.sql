-- Up Migration
-- Custom exercises (POST /exercises).

-- 1. One name per owner, ignoring case: "Cable Fly" and "cable fly" can't both be the same user's.
-- This is an expression index on lower(name), and it replaces the case-sensitive one, since any
-- pair it rejects the old one rejected too. The seed's ON CONFLICT DO NOTHING has no target, so
-- it works with either. (Clashing with a built-in name is checked by the route: the built-in has
-- created_by NULL, a different owner, so no per-owner index can see it.)
DROP INDEX exercises_created_by_name_key;
CREATE UNIQUE INDEX exercises_created_by_lower_name_key
  ON exercises (created_by, lower(name)) NULLS NOT DISTINCT;

-- 2. A set may only use an exercise its workout's owner can see: a built-in one, or their own.
-- The foreign key only checks that the exercise exists, so without this any user could log
-- another user's custom exercise by its id. A CHECK constraint can't do this (it can't read other
-- tables), and sets has no user_id for a composite foreign key, so a trigger checks each row.
-- It raises a foreign_key_violation (23503) with its own constraint name, which the routes
-- already turn into the same 400 as an exercise that doesn't exist, so the id reveals nothing.
-- workouts.user_id and exercises.created_by never change, so checking sets is enough.
CREATE FUNCTION sets_check_exercise_visible() RETURNS trigger AS $$
BEGIN
  -- NEW is the row being inserted, or the row as it will be after the UPDATE.
  IF NOT EXISTS (
    SELECT 1
    FROM exercises e
    JOIN workouts w ON w.id = NEW.workout_id
    WHERE e.id = NEW.exercise_id AND (e.created_by IS NULL OR e.created_by = w.user_id)
  ) THEN
    RAISE EXCEPTION 'exercise % is not available to the owner of workout %',
      NEW.exercise_id, NEW.workout_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'sets_exercise_visible';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- FOR EACH ROW: runs once per row actually written, so a statement that matches no row (another
-- user's workout or set, a 404) never reaches the check. UPDATE OF: only when one of these
-- columns is in the SET list, so editing reps doesn't recheck the exercise.
CREATE TRIGGER sets_exercise_visible
  BEFORE INSERT OR UPDATE OF exercise_id, workout_id ON sets
  FOR EACH ROW EXECUTE FUNCTION sets_check_exercise_visible();

-- Down Migration

DROP TRIGGER sets_exercise_visible ON sets;
DROP FUNCTION sets_check_exercise_visible();
DROP INDEX exercises_created_by_lower_name_key;
CREATE UNIQUE INDEX exercises_created_by_name_key ON exercises (created_by, name) NULLS NOT DISTINCT;
