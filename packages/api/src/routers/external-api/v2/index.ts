import express from 'express';
import omit from 'lodash/omit';

import { EXTERNAL_API_RATE_LIMIT_MAX } from '@/config';
import { validateUserAccessKey } from '@/middleware/auth';
import { parseBody } from '@/middleware/bodyParser';
import alertsRouter from '@/routers/external-api/v2/alerts';
import chartsRouter from '@/routers/external-api/v2/charts';
import connectionsRouter from '@/routers/external-api/v2/connections';
import dashboardRouter from '@/routers/external-api/v2/dashboards';
import savedSearchesRouter from '@/routers/external-api/v2/savedSearches';
import searchRouter from '@/routers/external-api/v2/search';
import sourcesRouter from '@/routers/external-api/v2/sources';
import teamRouter from '@/routers/external-api/v2/team';
import webhooksRouter from '@/routers/external-api/v2/webhooks';
import rateLimiter, { rateLimiterKeyGenerator } from '@/utils/rateLimiter';

const router = express.Router();

const defaultRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: EXTERNAL_API_RATE_LIMIT_MAX, // Limit each API key to this many requests per `window`
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: rateLimiterKeyGenerator,
});

router.get('/', validateUserAccessKey, (req, res) => {
  const user = req.user?.toJSON();
  res.json({
    version: 'v2',
    // A service account's accessKey is its org key hash; don't hand it out.
    user: user?.isVirtual ? omit(user, 'accessKey') : user,
  });
});

router.use(
  '/alerts',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  alertsRouter,
);

router.use(
  '/charts',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  chartsRouter,
);

router.use(
  '/connections',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  connectionsRouter,
);

router.use(
  '/dashboards',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  dashboardRouter,
);

router.use(
  '/sources',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  sourcesRouter,
);

router.use(
  '/saved-searches',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  savedSearchesRouter,
);

router.use(
  '/search',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  searchRouter,
);

router.use(
  '/webhooks',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  webhooksRouter,
);

router.use(
  '/team',
  defaultRateLimiter,
  validateUserAccessKey,
  parseBody,
  teamRouter,
);

export default router;
