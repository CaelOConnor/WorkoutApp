const pool = require('./pool');

const exercises = [
  ['Bench Press', 'Chest'],
  ['Squat', 'Legs'],
  ['Deadlift', 'Back'],
  ['Overhead Press', 'Shoulders'],
  ['Barbell Row', 'Back'],
];

async function seed() {
  // add to backend/db/seed.js, before the exercises loop
  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
    ['test@example.com', 'placeholder']
  );

  for (const [name, muscleGroup] of exercises) {
    await pool.query(
      'INSERT INTO exercises (name, muscle_group) VALUES ($1, $2)',
      [name, muscleGroup]
    );
  }
  console.log('Seeded exercises');
  process.exit(0);
}

seed();