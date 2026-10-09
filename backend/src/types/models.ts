// Shared data types for the WorkoutApp.
// This file must not import anything server-only (express, pg, ...) so the mobile app can reuse it later.

// ---------- Primitives ----------

// A union of string literals: only these exact strings are allowed.
export type WeightUnit = 'lb' | 'kg';

// ---------- Database rows (mirror backend/migrations/) ----------
// These describe what `pg` hands back for each table. Nullable columns are `T | null`.
// Note: `pg` turns DATE/TIMESTAMP columns into JS `Date` objects, but once sent through
// res.json() they become ISO strings on the client.

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
  date: Date;
  notes: string | null;
}

// Named WorkoutSet (not Set) to avoid clashing with JavaScript's built-in Set.
export interface WorkoutSet {
  id: number;
  workout_id: number;
  exercise_id: number;
  set_number: number;
  reps: number;
  // Postgres NUMERIC comes back from `pg` as a string (e.g. "135.00") so no precision is lost.
  // Left as string for now to match current API behavior; convert with Number() if needed.
  weight: string;
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

export interface LoginResponse {
  token: string;
  email: string;
}
