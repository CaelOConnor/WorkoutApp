-- Up Migration
-- Each workout's exercises, in a stored order. Before this, the order was worked out from the sets
-- (each exercise by its oldest surviving set), so deleting an exercise's first set could move its
-- whole card down the workout, below exercises added before its second set. A stored position
-- doesn't depend on which sets survive. (Templates will need an exercise order too.)

-- 1. One row per exercise in a workout. The primary key is the pair: an exercise is in a workout
-- at most once. position orders the exercises; gaps are fine (it's only compared, never shown),
-- so removing an exercise doesn't renumber the others. ON DELETE CASCADE on workout_id: deleting
-- a workout deletes its rows.
CREATE TABLE workout_exercises (
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (workout_id, exercise_id),
  CONSTRAINT workout_exercises_workout_id_position_key UNIQUE (workout_id, position)
);

-- 2. Rows for the existing sets, in the order the API showed them: by each exercise's oldest set.
-- GROUP BY gives one row per (workout, exercise); ROW_NUMBER then numbers those rows within each
-- workout, ordered by MIN(id), the aggregate of each group.
INSERT INTO workout_exercises (workout_id, exercise_id, position)
SELECT workout_id, exercise_id, ROW_NUMBER() OVER (PARTITION BY workout_id ORDER BY MIN(id))
FROM sets
GROUP BY workout_id, exercise_id;

-- 3. A set's (workout, exercise) must be one of the workout's exercises. A composite foreign key:
-- both columns together must match a workout_exercises row. ON DELETE CASCADE: removing an
-- exercise from a workout (deleting its row) deletes its sets too.
ALTER TABLE sets ADD CONSTRAINT sets_workout_exercise_fkey
  FOREIGN KEY (workout_id, exercise_id) REFERENCES workout_exercises (workout_id, exercise_id)
  ON DELETE CASCADE;

-- 4. The same visibility rule as sets (custom-exercises migration): only a built-in exercise or
-- one of the workout owner's. Its function only reads NEW.workout_id and NEW.exercise_id, which
-- this table has too, so it's reused, and a violation raises the same error the routes turn into
-- a 400. Checked here because a workout_exercises row is now written before its first set.
CREATE TRIGGER workout_exercises_exercise_visible
  BEFORE INSERT OR UPDATE OF exercise_id, workout_id ON workout_exercises
  FOR EACH ROW EXECUTE FUNCTION sets_check_exercise_visible();

-- Down Migration
-- The order goes back to being worked out from the sets.

DROP TRIGGER workout_exercises_exercise_visible ON workout_exercises;
ALTER TABLE sets DROP CONSTRAINT sets_workout_exercise_fkey;
DROP TABLE workout_exercises;
