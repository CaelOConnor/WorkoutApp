import jwt from 'jsonwebtoken';
import { TEST_JWT_SECRET } from './test-env';

// A real signed token, like /auth/login returns, so tests about other things get past requireAuth.
export function authHeader(userId: number): string {
  return `Bearer ${jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '7d' })}`;
}
