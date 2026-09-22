const express = require('express');
const pool = require('./db/pool');

const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.send('WorkoutApp API is alive');
});

app.get('/exercises', async (req, res) => {
  const result = await pool.query('SELECT * FROM exercises');
  res.json(result.rows);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));