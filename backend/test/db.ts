import bcrypt from 'bcrypt';
import pool from '../src/db/pool';
import type { PublicUser } from '../src/types/models';

// Empties every table and resets SERIAL ids to 1, so each test starts from a known state.
export async function resetDb(): Promise<void> {
  await pool.query('TRUNCATE users, exercises, workouts, sets RESTART IDENTITY CASCADE');
}

// Inserts a user directly (not through /auth/signup) so a login test doesn't depend on signup working.
export async function createUser(email: string, password: string): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query<PublicUser>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
    [email, passwordHash]
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error('createUser: insert returned no row');
  }
  return user;
}

export { pool };
