// Adds `user` to Express's Request type ("declaration merging").
//
// @types/express declares an empty global `Express.Request` interface, and Express's own
// Request type extends it. TypeScript merges every `interface` declaration with the same name,
// so declaring it again here adds our field to every `req` in the app.
//
// `declare global` is needed because this file is a module (it has an import), and a module's
// declarations are otherwise local to the file.
import type { AuthUser } from './models';

declare global {
  namespace Express {
    interface Request {
      // Optional: on routes without requireAuth, nothing sets it.
      user?: AuthUser;
    }
  }
}
