import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * General API rate limiter: 100 requests per 15 minutes per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    error: 'Too many requests, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Strict limiter for auth endpoints: 10 requests per hour per IP.
 * Prevents brute-force attacks on login/register.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again in an hour',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Limiter for deployment triggers: 20 deployments per 10 minutes per IP.
 */
export const deployLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    error: 'Too many deployment requests, please slow down',
    code: 'DEPLOY_RATE_LIMIT_EXCEEDED',
  },
});
