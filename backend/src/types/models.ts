// Shared types for the backend and the mobile app.
// Don't import server-only packages (express, pg) here because your phone cant run them and this file is imported in the app

export type WeightUnit = 'lb' | 'kg';

// ---------- Database rows ----------
// The shape of one row from each table

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: Date;
}

// What we send to clients: never the password hash.
export type PublicUser = Pick<User, 'id' | 'email'>;

export interface Exercise {
  id: number;
  name: string;
  muscle_group: string | null;
  created_by: number | null; // number is the user who created the exercise null = built in exercise
}

export interface Workout {
  id: number;
  user_id: number;
  date: string; // 'YYYY-MM-DD' used in pool.ts calandar day not Date
  notes: string | null;
}

export interface WorkoutSet {
  id: number;
  workout_id: number;
  exercise_id: number;
  set_number: number;
  reps: number;
  weight: number; // NUMERIC(6,2) in Postgres; pool.ts converts it from a string
  unit: WeightUnit;
}

export interface Template {
  id: number;
  user_id: number;
  name: string;
}

export interface TemplateExercise {
  template_id: number;
  exercise_id: number;
  position: number;
  set_count: number;
}

// ---------- Request bodies ----------
// The JSON the app sends for each request.

// No set_number: the server numbers sets in the order they're sent.
export interface NewSetInput {
  exercise_id: number;
  reps: number;
  weight: number;
  unit?: WeightUnit; // defaults to 'lb'
}

export interface CreateWorkoutBody {
  date?: string;
  notes?: string;
  sets: NewSetInput[];
}

// Any field left out stays as it is.
export interface UpdateWorkoutBody {
  date?: string;
  notes?: string | null; // null = clear the notes.
}

export type AddSetBody = NewSetInput;

// Can't change a set's exercise every other field is optional.
export type UpdateSetBody = Partial<Omit<NewSetInput, 'exercise_id'>>;

export interface ProgressQuery {
  unit?: WeightUnit; // defaults to the unit of your most recent set
  from?: string;
  to?: string;
}

export interface CreateExerciseBody {
  name: string;
  muscle_group?: string | null;
}

// Exercise order is the array order.
export interface TemplateBody {
  name: string;
  exercises: Pick<TemplateExercise, 'exercise_id' | 'set_count'>[];
}

export interface AuthBody {
  email: string;
  password: string;
}

// ---------- Auth ----------
// How the server knows who's making each request.

// What's stored inside the login token.
export interface TokenPayload {
  userId: number;
}

// Attached to req.user by requireAuth.
export type AuthUser = Pick<User, 'id'>;

// ---------- Responses ----------
// The JSON the server sends back for each request.

export interface ErrorResponse {
  error: string;
}

export interface CreateWorkoutResponse {
  id: number;
}

export type WorkoutDetailSet = Pick<WorkoutSet, 'id' | 'exercise_id' | 'set_number' | 'reps' | 'weight' | 'unit'> & {
  exercise_name: string;
};

// A workout with its sets nested, grouped by exercise.
export type WorkoutDetail = Pick<Workout, 'id' | 'date' | 'notes'> & {
  sets: WorkoutDetailSet[];
};

export type TemplateDetailExercise = Pick<TemplateExercise, 'exercise_id' | 'set_count'> & {
  exercise_name: string;
};

export type TemplateDetail = Pick<Template, 'id' | 'name'> & {
  exercises: TemplateDetailExercise[];
};

// One workout day of one exercise on the progress chart.
export interface ProgressPoint {
  date: string;
  top_weight: number;
  e1rm: number;
  volume: number; // sum of weight × reps
  sets: number;
}

export interface ExerciseProgress {
  exercise_id: number;
  exercise_name: string;
  unit: WeightUnit;
  points: ProgressPoint[];
}

export type LoggedExercise = Pick<Exercise, 'id' | 'name'> & {
  last_date: string;
  unit: WeightUnit;
};

// What the grey hints show: your sets from last time.
export interface ExerciseLastSets {
  exercise_id: number;
  date: string;
  sets: Pick<WorkoutSet, 'reps' | 'weight' | 'unit'>[];
}

export interface LoginResponse {
  token: string;
  email: string;
}