import type { InstallationApiResponse } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import { createTeam, isTeamExisting } from '@/controllers/team';
import { handleAuthError, redirectToDashboard } from '@/middleware/auth';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user'; // TODO -> do not import model directly
import { setupTeamDefaults } from '@/setupDefaults';
import { getCounter, getServerSpan } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import passport from '@/utils/passport';
import rateLimiter from '@/utils/rateLimiter';
import { isMongoConnected, mongoReadyStateName } from '@/utils/readiness';
import { passwordSchema } from '@/utils/validators';

export const LOGIN_MAX_FAILED_ATTEMPTS = 10;

const loginRateLimitedCounter = getCounter('hyperdx.api.login.rate_limited', {
  description:
    'Count of password logins refused because the email had too many recent failed attempts.',
});

// passport-local reads the email from the body, then the query string.
const getLoginEmail = (req: express.Request) => {
  const email = req.body?.email || req.query.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
};

// Only failed logins count. Success and failure both answer 303, and req.user
// is already set for a signed-in session, so success is marked on the route
// after passport accepts the password. The key is the email, not the IP: behind
// the app's /api proxy, req.ip is the proxy or whatever X-Forwarded-For the
// client sends.
const loginRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: LOGIN_MAX_FAILED_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.locals.loginSucceeded === true,
  keyGenerator: req => getLoginEmail(req) || req.ip || 'unknown',
  handler: (req, res) => {
    loginRateLimitedCounter.add(1);
    getServerSpan()?.setAttribute('hyperdx.login.rate_limited', true);
    // The app's login page submits a form; the CLI posts JSON.
    if (req.is('application/json')) {
      res.status(429).json({ error: 'tooManyAttempts' });
      return;
    }
    res.redirect(
      303,
      `${config.FRONTEND_REDIRECT_BASE}/login?err=tooManyAttempts`,
    );
  },
});

const registrationSchema = z
  .object({
    email: z.string().email(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

const router = express.Router();

// Liveness: 200 whenever the process can serve HTTP. Deliberately checks no
// external dependencies — restarting the pod does not fix a Mongo outage.
router.get('/health', async (req, res) => {
  res.send({
    data: 'OK',
    version: config.CODE_VERSION,
    ip: req.ip,
    env: config.NODE_ENV,
  });
});

// Readiness: 503 unless MongoDB is connected. Nearly every route is
// Mongo-backed, so a pod without a Mongo connection cannot serve traffic and
// should be removed from Service endpoints (see utils/readiness.ts).
router.get('/ready', async (req, res) => {
  if (isMongoConnected()) {
    return res.send({
      data: 'OK',
      version: config.CODE_VERSION,
      env: config.NODE_ENV,
    });
  }
  res.status(503).send({
    status: 'unavailable',
    mongo: mongoReadyStateName(),
  });
});

type InstallationEspRes = express.Response<InstallationApiResponse>;
router.get('/installation', async (_, res: InstallationEspRes, next) => {
  try {
    const _isTeamExisting = await isTeamExisting();
    return res.json({
      isTeamExisting: _isTeamExisting,
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/login/password',
  loginRateLimiter,
  passport.authenticate('local', {
    failWithError: true,
    failureMessage: true,
  }),
  (_req, res, next) => {
    res.locals.loginSucceeded = true;
    next();
  },
  redirectToDashboard,
  handleAuthError,
);

router.post(
  '/register/password',
  validateRequest({ body: registrationSchema }),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      if (await isTeamExisting()) {
        return res.status(409).json({ error: 'teamAlreadyExists' });
      }

      (User as any).register(
        new User({ email }),
        password,
        async (err: Error, user: any) => {
          if (err) {
            logger.error(
              { err: serializeError(err) },
              'User registration error',
            );
            return res.status(400).json({ error: 'invalid' });
          }

          const team = await createTeam({
            name: `${email}'s Team`,
            collectorAuthenticationEnforced: true,
          });
          user.team = team._id;
          user.name = email;
          await user.save();

          // Set up default connections and sources for this new team
          try {
            await setupTeamDefaults(team._id.toString());
          } catch (error) {
            logger.error(
              { err: serializeError(error) },
              'Failed to setup team defaults',
            );
            // Continue with registration even if setup defaults fails
          }

          return passport.authenticate('local')(req, res, () => {
            if (req?.user?.team) {
              return res.status(200).json({ status: 'success' });
            }

            logger.error(
              { userId: req?.user?._id },
              'Password login for user failed, user or team not found',
            );
            return res.status(400).json({ error: 'invalid' });
          });
        },
      );
    } catch (e) {
      next(e);
    }
  },
);

router.get('/logout', (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect(`${config.FRONTEND_REDIRECT_BASE}/login`);
  });
});

// TODO: rename this ?
router.post('/team/setup/:token', async (req, res, next) => {
  try {
    const { password } = req.body;
    const { token } = req.params;

    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      // Emit one `reason` query param per failed requirement so the Join Team
      // page can render them as a readable list rather than one run-on line.
      const reasonParams = passwordResult.error.issues
        .map(issue => `reason=${encodeURIComponent(issue.message)}`)
        .join('&');
      return res.redirect(
        `${config.FRONTEND_REDIRECT_BASE}/join-team?err=invalid&${reasonParams}&token=${token}`,
      );
    }

    const teamInvite = await TeamInvite.findOne({
      token: req.params.token,
    });
    if (!teamInvite) {
      return res.status(401).send('Invalid token');
    }

    (User as any).register(
      new User({
        email: teamInvite.email,
        name: teamInvite.email,
        team: teamInvite.teamId,
      }),
      password,
      async (err: Error, user: any) => {
        if (err) {
          logger.error({ err: serializeError(err) }, 'Team setup error');
          return res.redirect(
            `${config.FRONTEND_REDIRECT_BASE}/join-team?token=${token}&err=500`,
          );
        }

        await TeamInvite.findByIdAndRemove(teamInvite._id);

        req.login(user, err => {
          if (err) {
            return next(err);
          }
          redirectToDashboard(req, res);
        });
      },
    );
  } catch (e) {
    next(e);
  }
});

export default router;
