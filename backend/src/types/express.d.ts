// Adds `user` to Express's Request type. Interfaces with the same name merge,
// so this adds the field to every req in the app.
// declare global is needed so it applies outside this file.
import type { AuthUser } from './models';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser; // optional: only set on routes behind requireAuth
    }
  }
}