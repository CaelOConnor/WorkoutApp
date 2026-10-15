// Shared data types for the WorkoutApp.
// This file must not import anything server-only (express, pg, ...) so the mobile app can reuse it later.

// ---------- Primitives ----------

// A union of string literals: only these exact strings are allowed.
export type WeightUnit = 'lb' | 'kg';

// ---------- Database rows (mirror backend/migrations/) ----------
// These describe what `pg` hands back for each table. Nullable columns are `T | null`.
// Note: `pg` turns TIMESTAMP columns into JS `Date` objects (ISO strings once sent through
// res.json()). DATE columns are the exception: db/pool.ts keeps them as 'YYYY-MM-DD' strings.
// NUMERIC columns (sets.weight) would be strings; db/pool.ts parses them to numbers.

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: Date;
}

// Utility type: pick a subset of another type's fields. Safe to send to clients (no password hash).
export type PublicUser = Pick<User, 'id' | 'email'>;

export interface Exercise {
  id: number;
  name: string;
  muscle_group: string | null;
  created_by: number | null;
}

export interface Workout {
  id: number;
  user_id: number;
  // A calendar day, 'YYYY-MM-DD', with no time or time zone (see db/pool.ts).
  date: string;
  notes: string | null;
}

// Named WorkoutSet (not Set) to avoid clashing with JavaScript's built-in Set.
export interface WorkoutSet {
  id: number;
  workout_id: number;
  exercise_id: number;
  set_number: number;
  reps: number;
  // NUMERIC(6,2) in Postgres. pg would return it as a string ('135.00'); db/pool.ts parses it
  // to a number, which holds every NUMERIC(6,2) value exactly. Trailing zeros are gone: 135, not 135.00.
  weight: number;
  unit: WeightUnit;
}

// ---------- API request bodies ----------

export interface NewSetInput {
  exercise_id: number;
  set_number: number;
  reps: number;
  weight: number;
  unit?: WeightUnit; // `?` = optional; the server defaults to 'lb'
}

export interface CreateWorkoutBody {
  date?: string;
  notes?: string;
  sets: NewSetInput[];
}

// PATCH /workouts/:id. Both optional: a missing key means "leave that column alone".
export interface UpdateWorkoutBody {
  date?: string;
  // `?` allows the key to be missing; `| null` allows an explicit null, which clears the notes.
  // date has no `| null` because the column is NOT NULL.
  notes?: string | null;
}

// POST /workouts/:id/sets. Omit drops set_number from NewSetInput, then it's added back as
// optional: when it's missing, the server uses the workout's highest set_number + 1.
export type AddSetBody = Omit<NewSetInput, 'set_number'> & { set_number?: number };

// PATCH /workouts/:id/sets/:setId. Partial<T> makes every field of T optional, which is exactly
// "send only what changes". NewSetInput's unit was already optional, so nothing else differs.
export type UpdateSetBody = Partial<NewSetInput>;

// GET /exercises/:id/progress query string. Every key is optional. A missing unit means the unit
// of the caller's most recent set of that exercise; a missing from/to leaves that end open.
export interface ProgressQuery {
  unit?: WeightUnit;
  from?: string; // 'YYYY-MM-DD', inclusive
  to?: string; // 'YYYY-MM-DD', inclusive
}

// POST /exercises: a custom exercise for the caller. Both are trimmed by the server; a missing,
// null or blank muscle_group is stored as null.
export interface CreateExerciseBody {
  name: string;
  muscle_group?: string | null;
}

export interface AuthBody {
  email: string;
  password: string;
}

// ---------- Auth ----------

// What /auth/login signs into the JWT, and what requireAuth reads back out.
export interface TokenPayload {
  userId: number;
}

// The logged-in user, as attached to req.user by requireAuth.
export type AuthUser = Pick<User, 'id'>;

// ---------- API responses ----------

export interface ErrorResponse {
  error: string;
}

export interface CreateWorkoutResponse {
  id: number;
}

// One set inside a WorkoutDetail. No workout_id: it's nested under its workout already.
export type WorkoutDetailSet = Pick<
  WorkoutSet,
  'id' | 'exercise_id' | 'set_number' | 'reps' | 'weight' | 'unit'
> & {
  exercise_name: string;
};

// One workout with its sets nested, ordered by set_number. GET /workouts/:id returns one;
// GET /workouts returns an array of them (sets: [] for a workout with no sets).
// No user_id: the caller can only ever see their own workouts, so it would add nothing.
export type WorkoutDetail = Pick<Workout, 'id' | 'date' | 'notes'> & {
  sets: WorkoutDetailSet[];
};

// One workout day of one exercise. Only sets with 1+ reps count, every weight is converted to the
// response's unit first, and each number is rounded to 1 decimal.
export interface ProgressPoint {
  date: string; // 'YYYY-MM-DD'; workouts on the same day are merged into one point
  top_weight: number; // heaviest set
  e1rm: number; // best estimated one-rep max (Epley: weight × (1 + reps/30); 1 rep = the weight)
  volume: number; // sum of weight × reps
  sets: number; // how many sets counted
}

// GET /exercises/:id/progress. points are oldest first; [] if nothing matches.
export interface ExerciseProgress {
  exercise_id: number;
  exercise_name: string;
  unit: WeightUnit; // the unit every number in points is in
  points: ProgressPoint[];
}

// One item of GET /exercises/logged: an exercise the caller has logged a set of 1+ reps for.
// unit is that most recent set's unit, which is also the progress endpoint's default.
export type LoggedExercise = Pick<Exercise, 'id' | 'name'> & {
  last_date: string; // 'YYYY-MM-DD'
  unit: WeightUnit;
};

export interface LoginResponse {
  token: string;
  email: string;
}
