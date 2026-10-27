import pool from './pool';

// The built-in exercises. Each entry is [name, muscle group].
const exercises: [name: string, muscleGroup: string][] = [
  ['Bench Press', 'Chest'],
  ['Squat', 'Legs'],
  ['Deadlift', 'Back'],
  ['Overhead Press', 'Shoulders'],
  ['Barbell Row', 'Back'],
];

// Safe to run again: existing rows are skipped. Doesn't close the pool, because tests reuse it.
export async function seed(): Promise<void> {
  for (const [name, muscleGroup] of exercises) {
    await pool.query(
      'INSERT INTO exercises (name, muscle_group) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [name, muscleGroup]
    );
  }
}

// Only seeds when run directly (npm run seed), not when a test imports this file.
if (require.main === module) {
  seed()
    .then(() => console.log('Seeded exercises'))
    .catch((err: unknown) => {
      console.error('Seed failed:', err);
      process.exitCode = 1;
    })
    // Close the connections so the script can exit.
    .finally(() => pool.end());
}