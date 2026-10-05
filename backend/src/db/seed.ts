import pool from './pool';

// A labeled tuple type: each entry is exactly [name, muscleGroup], both strings.
const exercises: [name: string, muscleGroup: string][] = [
  ['Bench Press', 'Chest'],
  ['Squat', 'Legs'],
  ['Deadlift', 'Back'],
  ['Overhead Press', 'Shoulders'],
  ['Barbell Row', 'Back'],
];

// Exported so tests can call it; it doesn't close the pool, because the caller owns it.
export async function seed(): Promise<void> {
  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
    ['test@example.com', 'placeholder']
  );

  for (const [name, muscleGroup] of exercises) {
    // A rerun hits the exercises_created_by_name_key unique index and skips the row.
    await pool.query(
      'INSERT INTO exercises (name, muscle_group) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [name, muscleGroup]
    );
  }
}

// In CommonJS, require.main is the file Node was started with. This is true for
// `npm run seed` but false when a test imports this file, so importing doesn't seed.
if (require.main === module) {
  seed()
    .then(() => console.log('Seeded exercises'))
    .catch((err: unknown) => {
      console.error('Seed failed:', err);
      process.exitCode = 1;
    })
    // Closing the pool lets Node exit on its own, instead of process.exit() cutting it off.
    .finally(() => pool.end());
}
