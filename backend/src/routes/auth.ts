import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { DatabaseError } from 'pg';
import pool from '../db/pool';
import { JWT_SECRET } from '../middleware/auth';
import { isAuthBody } from '../validation';
import type { ErrorResponse, LoginResponse, PublicUser, User } from '../types/models';
import type { NoParams } from './types';

// Mounted at /auth in app.ts, so '/signup' here is /auth/signup. No requireAuth: these
// routes are how a user gets a token in the first place.
const authRouter = Router();

authRouter.post(
  '/signup',
  async (
    req: Request<NoParams, PublicUser | ErrorResponse, unknown>,
    res: Response<PublicUser | ErrorResponse>
  ) => {
    if (!isAuthBody(req.body)) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const { email, password } = req.body;

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await pool.query<PublicUser>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash]
      );
      const user = result.rows[0];
      if (!user) {
        throw new Error('User insert returned no row');
      }
      return res.status(201).json(user);
    } catch (err: unknown) {
      // instanceof narrows `unknown` to pg's DatabaseError, which has a `code` property.
      // 23505 = unique_violation (the email column is UNIQUE).
      if (err instanceof DatabaseError && err.code === '23505') {
        return res.status(409).json({ error: 'Email already in use' });
      }
      console.error('POST /auth/signup failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

authRouter.post(
  '/login',
  async (
    req: Request<NoParams, LoginResponse | ErrorResponse, unknown>,
    res: Response<LoginResponse | ErrorResponse>
  ) => {
    if (!isAuthBody(req.body)) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const { email, password } = req.body;

    try {
      const result = await pool.query<User>('SELECT * FROM users WHERE email = $1', [email]);
      const user = result.rows[0]; // User | undefined

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      // From here on, TypeScript knows `user` is a User.

      const passwordMatches = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: '7d',
      });

      return res.json({ token, email: user.email });
    } catch (err: unknown) {
      console.error('POST /auth/login failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default authRouter;
