import jwt from 'jsonwebtoken';
import { TEST_JWT_SECRET } from './test-env';

// Builds an Authorization header with a real signed token, the same shape /auth/login returns,
// so tests about other things (like validation) get past requireAuth.
export function authHeader(userId: number): string {
  return `Bearer ${jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '7d' })}`;
}
