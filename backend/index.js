const express = require('express');
const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.send('WorkoutApp API is alive');
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));