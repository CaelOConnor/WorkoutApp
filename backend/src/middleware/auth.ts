import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenPayload } from '../validation';
import type { AuthUser } from '../types/models';

// process.env values are `string | undefined`. Returning only after the check means callers get a `string`.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Exported so the login route signs tokens with the same secret requireAuth verifies them with.
export const JWT_SECRET = requireEnv('JWT_SECRET');

// Middleware: runs before the route handler. Sending a response here stops the request;
// calling next() hands it on to the next handler in the chain.
export const requireAuth: RequestHandler = (req, res, next) => {
  // Header values are `string | undefined`; `?.` makes the whole check false when it's missing.
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // `let` declared outside the try so it's still in scope after it.
  let payload: unknown;
  try {
    // verify (unlike decode) checks the signature and `exp`, and throws if either is bad.
    // Pinning the algorithm stops a token's own header from choosing how it gets checked.
    payload = jwt.verify(header.slice('Bearer '.length), JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  if (!isTokenPayload(payload)) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // `user` exists on Request because of src/types/express.d.ts.
  req.user = { id: payload.userId };
  next();
};

// For handlers behind requireAuth. Throwing (instead of a `!` assertion) means a route that
// forgot requireAuth fails loudly with a 500 from the error handler, not a silent `undefined`.
export function getAuthUser(req: Request): AuthUser {
  if (!req.user) {
    throw new Error('getAuthUser called on a route without requireAuth');
  }
  return req.user;
}
