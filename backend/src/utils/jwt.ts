import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
}

/**
 * 签发 JWT Token
 */
export function signToken(payload: JwtPayload): string {
  const expiresIn = config.jwt.expiresIn as string;
  return jwt.sign(payload as object, config.jwt.secret, {
    expiresIn: expiresIn,
  } as jwt.SignOptions);
}

/**
 * 验证 JWT Token
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.secret) as JwtPayload;
}
