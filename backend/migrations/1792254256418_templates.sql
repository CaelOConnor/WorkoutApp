-- Up Migration
-- Workout templates (e.g. "Leg day"): a named list of exercises in order, each with a number of
-- sets. A template stores no reps or weights: starting a workout from one prefills the numbers
-- from the last time each exercise was logged. Starting a workout copies the template into an
-- ordinary POST /workouts, so workouts aren't linked to templates, and editing or deleting a
-- template never changes a past workout.

-- 1. One row per template. A name is unique per user, ignoring case (like custom exercises), via
-- an expression index on lower(name). Same owner column as workouts: no ON DELETE CASCADE, since
-- users are never deleted yet.
CREATE TABLE templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL
);
CREATE UNIQUE INDEX templates_user_id_lower_name_key ON templates (user_id, lower(name));

-- 2. A template's exercises, shaped like workout_exercises: the pair is the primary key (an
-- exercise at most once per template), and position orders them. Editing a template replaces all
-- of its rows inside one transaction, so a reorder never has to swap two positions in place and
-- the unique position doesn't need to be DEFERRABLE (unlike sets' set_number).
-- set_count: how many set rows the log screen starts that exercise with (1 to 20).
CREATE TABLE template_exercises (
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  set_count INTEGER NOT NULL CONSTRAINT template_exercises_set_count_check CHECK (set_count BETWEEN 1 AND 20),
  CONSTRAINT template_exercises_pkey PRIMARY KEY (template_id, exercise_id),
  CONSTRAINT template_exercises_template_id_position_key UNIQUE (template_id, position)
);

-- 3. The same visibility rule as sets and workout_exercises (custom-exercises migration): only a
-- built-in exercise or one of the template owner's. Without it, a template could hold another
-- user's custom exercise by id, and reading the template back would show that exercise's name.
-- sets_check_exercise_visible() can't be reused, since it finds the owner through NEW.workout_id;
-- this one goes through the template instead. It raises the same foreign_key_violation (23503),
-- so the routes can answer with the same 400 as an exercise that doesn't exist.
CREATE FUNCTION template_exercises_check_exercise_visible() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM exercises e
    JOIN templates t ON t.id = NEW.template_id
    WHERE e.id = NEW.exercise_id AND (e.created_by IS NULL OR e.created_by = t.user_id)
  ) THEN
    RAISE EXCEPTION 'exercise % is not available to the owner of template %',
      NEW.exercise_id, NEW.template_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'template_exercises_exercise_visible';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_exercises_exercise_visible
  BEFORE INSERT OR UPDATE OF exercise_id, template_id ON template_exercises
  FOR EACH ROW EXECUTE FUNCTION template_exercises_check_exercise_visible();

-- Down Migration
-- Dropping the table drops its trigger too; the function has to go separately.

DROP TABLE template_exercises;
DROP FUNCTION template_exercises_check_exercise_visible();
DROP TABLE templates;
