import type { NextFunction, Request, Response } from 'express';

import * as config from '@/config';
import { getCounter, getServerSpan } from '@/utils/instrumentation';
import rateLimiter from '@/utils/rateLimiter';

export const LOGIN_MAX_FAILED_ATTEMPTS = 10;
// Short, because anyone who knows an email can lock that account out for this
// long.
const LOGIN_RATE_LIMIT_WINDOW_MS = 2 * 60 * 1000;

const loginRateLimitedCounter = getCounter('hyperdx.api.login.rate_limited', {
  description:
    'Count of password logins refused because the email had too many recent failed attempts.',
});

// passport-local reads the email from the body, then the query string.
const getLoginEmail = (req: Request) => {
  const email = req.body?.email || req.query.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
};

// Only rejected credentials count, not server errors such as the database being
// down. Every outcome answers 303, and req.user is already set for a signed-in
// session, so markRejectedLogin flags the rejection instead. The key is the
// email, not the IP: behind the app's /api proxy, req.ip is the proxy or
// whatever X-Forwarded-For the client sends.
export const loginRateLimiter = rateLimiter({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  max: LOGIN_MAX_FAILED_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.locals.loginRejected !== true,
  keyGenerator: req => getLoginEmail(req) || req.ip || 'unknown',
  handler: (req, res) => {
    loginRateLimitedCounter.add(1);
    getServerSpan()?.setAttribute('hyperdx.login.rate_limited', true);
    // The app's login page submits a form; the CLI posts JSON.
    if (req.is('application/json')) {
      res.status(429).json({
        error: 'tooManyAttempts',
        message:
          'Too many failed login attempts. Please wait a few minutes and try again.',
      });
      return;
    }
    res.redirect(
      303,
      `${config.FRONTEND_REDIRECT_BASE}/login?err=tooManyAttempts`,
    );
  },
});

// passport passes on wrong credentials as an AuthenticationError and server
// errors as they are.
export function markRejectedLogin(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  res.locals.loginRejected = err.name === 'AuthenticationError';
  next(err);
}
