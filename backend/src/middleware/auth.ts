import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenPayload } from '../validation';
import type { AuthUser } from '../types/models';

// Crash at startup if a required variable is missing.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Shared with the login route, so tokens are signed and checked with the same secret.
export const JWT_SECRET = requireEnv('JWT_SECRET');

// Runs before protected routes. Responds with 401 and stops, or calls next() to continue.
export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let payload: unknown; // Declared outside the try so it's usable after. unknown = must check before using.
  try {
    // verify checks the signature and expiry.
    // Pinning the algorithm stops the token from choosing how it's checked.
    payload = jwt.verify(header.slice('Bearer '.length), JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  // Types are gone at runtime, so check the token's contents with code.
  if (!isTokenPayload(payload)) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = { id: payload.userId }; // req.user is declared in types/express.d.ts
  next();
};

// Throws instead of using `!`, so a route missing requireAuth fails loudly.
export function getAuthUser(req: Request): AuthUser {
  if (!req.user) {
    throw new Error('getAuthUser called on a route without requireAuth');
  }
  return req.user;
}