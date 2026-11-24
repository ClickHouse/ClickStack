import { withQueryAttribution } from '@hyperdx/common-utils/dist/clickhouse/node';
import { SloInputSchema } from '@hyperdx/common-utils/dist/slo';
import express from 'express';
import { z } from 'zod/v3';
import { processRequest, validateRequest } from 'zod-express-middleware';

import {
  createSlo,
  deleteSlo,
  formatSlo,
  getSlo,
  listSlos,
  updateSlo,
} from '@/controllers/slo';
import { getSloAlerts } from '@/controllers/sloAlert';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import type { ObjectId } from '@/models';
import type { ISlo } from '@/models/slo';
import { setBusinessContext } from '@/utils/instrumentation';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

// Saves run a short check query against ClickHouse; tag it as an SLO read on
// top of the `api` scope the auth middleware opened.
router.use((_req, _res, next) => {
  withQueryAttribution({ surface: 'slo' }, () => next());
});

// As effects, so processRequest types the parsed request as the schemas'
// output (with defaults applied) rather than their input.
const sloIdParams = z
  .object({ id: objectIdSchema })
  .transform(params => params);
const sloBody = SloInputSchema.transform(definition => definition);

async function formatSloWithAlerts(teamId: ObjectId, slo: ISlo) {
  const alerts = await getSloAlerts(teamId, [slo._id]);
  return formatSlo(slo, alerts.get(slo._id.toString()));
}

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    setBusinessContext({ teamId: teamId.toString() });
    const slos = await listSlos(teamId.toString());
    const alerts = await getSloAlerts(
      teamId,
      slos.map(slo => slo._id),
    );
    res.json(slos.map(slo => formatSlo(slo, alerts.get(slo._id.toString()))));
  } catch (e) {
    next(e);
  }
});

router.get(
  '/:id',
  validateRequest({ params: sloIdParams }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      setBusinessContext({ teamId: teamId.toString() });
      const slo = await getSlo(teamId.toString(), req.params.id);
      if (!slo) return res.sendStatus(404);
      res.json(await formatSloWithAlerts(teamId, slo));
    } catch (e) {
      next(e);
    }
  },
);

router.post('/', processRequest({ body: sloBody }), async (req, res, next) => {
  try {
    const { teamId, userId } = getNonNullUserWithTeam(req);
    setBusinessContext({ teamId: teamId.toString() });
    const slo = await createSlo(
      teamId.toString(),
      userId?.toString(),
      req.body,
    );
    res.json(await formatSloWithAlerts(teamId, slo));
  } catch (e) {
    next(e);
  }
});

router.put(
  '/:id',
  processRequest({ params: sloIdParams, body: sloBody }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      setBusinessContext({ teamId: teamId.toString() });
      const slo = await updateSlo(
        teamId.toString(),
        req.params.id,
        userId?.toString(),
        req.body,
      );
      if (!slo) return res.sendStatus(404);
      res.json(await formatSloWithAlerts(teamId, slo));
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({ params: sloIdParams }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      setBusinessContext({ teamId: teamId.toString() });
      const deleted = await deleteSlo(teamId.toString(), req.params.id);
      if (!deleted) return res.sendStatus(404);
      res.sendStatus(204);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
