
const express = require('express');
const pool = require('./db/pool');
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('WorkoutApp API is alive');
});

app.get('/exercises', async (req, res) => {
  const result = await pool.query('SELECT * FROM exercises');
  res.json(result.rows);
});

app.post('/workouts', async (req, res) => {
  const { date, notes, sets } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const workoutResult = await client.query(
      'INSERT INTO workouts (user_id, date, notes) VALUES ($1, $2, $3) RETURNING id',
      [1, date || new Date(), notes || null]
    );
    const workoutId = workoutResult.rows[0].id;

    for (const set of sets) {
      await client.query(
        'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight, unit) VALUES ($1, $2, $3, $4, $5, $6)',
        [workoutId, set.exercise_id, set.set_number, set.reps, set.weight, set.unit || 'lb']
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: workoutId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/workouts', async (req, res) => {
  const result = await pool.query(
    `SELECT w.id, w.date, w.notes, s.exercise_id, e.name AS exercise_name, s.set_number, s.reps, s.weight, s.unit
     FROM workouts w
     JOIN sets s ON s.workout_id = w.id
     JOIN exercises e ON e.id = s.exercise_id
     ORDER BY w.date DESC, s.id ASC`
  );
  res.json(result.rows);
});

app.post('/auth/signup', async (req, res) => {
  const { email, password } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation on the email column
      return res.status(409).json({ error: 'Email already in use' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));