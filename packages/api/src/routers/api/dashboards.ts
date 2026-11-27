import { dropUnsupportedAllValues } from '@hyperdx/common-utils/dist/dashboardFilterValues';
import {
  getVariableReferenceError,
  validateDashboardFilterModes,
  validateDashboardFilterOptionUniqueness,
  validateDashboardFilterVariableNames,
} from '@hyperdx/common-utils/dist/dashboardValidation';
import { isSqlQueryFilter } from '@hyperdx/common-utils/dist/filters';
import { parseVariableReference } from '@hyperdx/common-utils/dist/referenceVariables';
import {
  DashboardFilter,
  DashboardSchema,
  DashboardWithoutIdSchema,
  PresetDashboard,
  PresetDashboardFilterSchema,
  resolveChartPaletteToken,
  walkRawDashboardTileColors,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import _ from 'lodash';
import { z } from 'zod/v3';
import { validateRequest } from 'zod-express-middleware';

import { getConnectionsByTeam } from '@/controllers/connection';
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  getDashboards,
  updateDashboard,
} from '@/controllers/dashboard';
import {
  createPresetDashboardFilter,
  deletePresetDashboardFilter,
  getPresetDashboardFilters,
  updatePresetDashboardFilter,
} from '@/controllers/presetDashboardFilters';
import { getSources } from '@/controllers/sources';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import type { ObjectId } from '@/models';
import {
  getChangedFilterSourceRefs,
  getFilterSourceRefError,
} from '@/utils/filterSources';
import { objectIdSchema } from '@/utils/zod';

// create routes that will get and update dashboards
const router = express.Router();

/**
 * Additional filter validation (variable name and option uniqueness, at least one mode enabled).
 */
const addFilterIssues = (
  data: {
    filters?: {
      name: string;
      options?: string[];
      variableName?: string;
      isBroadcastEnabled?: boolean;
      isVariableEnabled?: boolean;
    }[];
  },
  ctx: z.RefinementCtx,
) => {
  validateDashboardFilterVariableNames(data.filters ?? [], ctx);
  validateDashboardFilterModes(data.filters ?? [], ctx);
  validateDashboardFilterOptionUniqueness(data.filters ?? [], ctx);
};

/**
 * Rejects PROMETHEUS_LABEL, ADHOC and SQL_QUERY filters that reference a source
 * that is missing or of the wrong kind, and SQL_QUERY filters whose source is
 * on another connection. Resolving these filters needs a live source of the
 * right kind, unlike other filter types. References the stored filter with
 * the same ID already made are skipped, so a since-deleted source doesn't block
 * unrelated saves. Returns an error message, or null when there is nothing to
 * reject.
 */
async function validateFilterSources(
  teamId: ObjectId,
  filters: DashboardFilter[] = [],
  existingFilters: DashboardFilter[] = [],
): Promise<string | null> {
  const refs = getChangedFilterSourceRefs(filters, existingFilters).filter(
    // Variable references are checked by validateDashboardVariableReferences
    ref => parseVariableReference(ref.id) == null,
  );
  if (refs.length === 0) return null;
  return getFilterSourceRefError(refs, await getSources(teamId.toString()));
}

/**
 * Rejects SQL_QUERY filters whose connection doesn't belong to the team. As in
 * `validateFilterSources`, a connection the stored filter with the same ID
 * already used is skipped, and so is a variable reference. Returns an error
 * message, or null.
 */
async function validateFilterConnections(
  teamId: ObjectId,
  filters: DashboardFilter[] = [],
  existingFilters: DashboardFilter[] = [],
): Promise<string | null> {
  const existingConnectionById = new Map(
    existingFilters
      .filter(isSqlQueryFilter)
      .map(filter => [filter.id, filter.connection]),
  );
  const connectionIds = new Set(
    filters
      .filter(isSqlQueryFilter)
      .filter(
        filter =>
          // Variable references are checked by validateDashboardVariableReferences
          parseVariableReference(filter.connection) == null &&
          existingConnectionById.get(filter.id) !== filter.connection,
      )
      .map(filter => filter.connection),
  );
  if (connectionIds.size === 0) return null;

  const connections = await getConnectionsByTeam(teamId.toString());
  const knownIds = new Set(connections.map(c => c._id.toString()));
  const missing = [...connectionIds].filter(id => !knownIds.has(id));
  if (missing.length === 0) return null;
  return `The following filter connection IDs do not exist: ${missing.join(', ')}`;
}

async function validateFilterReferences(
  teamId: ObjectId,
  filters?: DashboardFilter[],
  existingFilters?: DashboardFilter[],
): Promise<string | null> {
  return (
    (await validateFilterSources(teamId, filters, existingFilters)) ??
    (await validateFilterConnections(teamId, filters, existingFilters))
  );
}

/**
 * Heal legacy `chart-1`..`chart-10` tile colors from #2265 on the request
 * body *before* `validateRequest` runs `ChartPaletteTokenSchema`. Keeps the
 * schema strict (so `z.input` == `z.output` and `req.body` infers cleanly)
 * while still accepting payloads from any non-React HTTP client whose
 * stored values haven't yet been healed by the app-side normalizer
 * (`normalizeDashboardTileColors` in `packages/app/src/dashboard.ts`).
 *
 * This is a one-release deprecation shim — once stored data has converged
 * on the hue-named tokens, it can be removed in favor of straight-strict
 * validation. The actual walk delegates to `walkRawDashboardTileColors`
 * in common-utils so this middleware, the app-side normalizer, the JSON
 * import path, and the provisioner all share the same per-tile traversal.
 */
const migrateLegacyDashboardTileColors: express.RequestHandler = (
  req,
  _res,
  next,
) => {
  req.body = walkRawDashboardTileColors(req.body, current => {
    const resolved = resolveChartPaletteToken(current);
    return resolved ?? current;
  });
  next();
};

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const dashboards = await getDashboards(teamId);

    return res.json(dashboards);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  migrateLegacyDashboardTileColors,
  validateRequest({
    body: DashboardWithoutIdSchema.superRefine(addFilterIssues),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);

      // `provisioned` marks a dashboard as machine-managed by
      // ProvisionDashboardsTask, whose upsert overwrites tiles/tags/filters
      // wholesale. It is server-owned: `validateRequest` validates without
      // replacing `req.body`, and DashboardSchema is non-strict, so a
      // client-supplied value would otherwise persist and hand the caller's
      // dashboard to the provisioner.
      const dashboard = _.omit(req.body, 'provisioned');
      if (dashboard.savedFilterValues) {
        dashboard.savedFilterValues = dropUnsupportedAllValues(
          dashboard.filters ?? [],
          dashboard.savedFilterValues,
        );
      }

      const filterError =
        getVariableReferenceError(req.body.tiles, req.body.filters) ??
        (await validateFilterReferences(teamId, req.body.filters));
      if (filterError != null) {
        return res.status(400).json({ message: filterError });
      }

      const newDashboard = await createDashboard(teamId, dashboard, userId);

      res.json(newDashboard.toJSON());
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/:id',
  migrateLegacyDashboardTileColors,
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: DashboardSchema.partial().superRefine(addFilterIssues),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id: dashboardId } = req.params;

      const dashboard = await getDashboard(dashboardId, teamId);

      if (dashboard == null) {
        return res.sendStatus(404);
      }

      // Re-parse instead of omitting keys by name: DashboardWithoutIdSchema
      // declares no `team`/`createdBy`/`provisioned`, so parsing drops them
      // along with every other unknown key. All three are server-owned —
      // `team`/`provisioned` for tenant isolation and the provisioner, and
      // `createdBy` for ownership attribution (a smuggled `team` used to move
      // a dashboard into another team's namespace; see the POST handler's
      // comment for why validateRequest alone can't enforce this).
      // Nulls survive: the schema's optional fields are `.nullable()`, and a
      // null still signals field removal downstream.
      const updates = DashboardWithoutIdSchema.partial().parse(req.body);
      // Dropped rather than rejected: the UI resends the stored defaults on
      // every save, so a stale "all" left after allowAll is turned off would
      // otherwise block every later edit.
      if (updates.savedFilterValues) {
        updates.savedFilterValues = dropUnsupportedAllValues(
          updates.filters ?? dashboard.filters ?? [],
          updates.savedFilterValues,
        );
      }

      const filterError =
        // Only references this update adds are checked, so a filter edit
        // can't fail on tiles and filters it didn't touch
        getVariableReferenceError(
          req.body.tiles ?? dashboard.tiles,
          req.body.filters ?? dashboard.filters,
          dashboard,
        ) ??
        (await validateFilterReferences(
          teamId,
          req.body.filters,
          dashboard.filters,
        ));
      if (filterError != null) {
        return res.status(400).json({ message: filterError });
      }

      const updatedDashboard = await updateDashboard(
        dashboardId,
        teamId,
        updates,
        userId,
      );

      res.json(updatedDashboard);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id: dashboardId } = req.params;

      await deleteDashboard(dashboardId, teamId);

      res.sendStatus(204);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/preset/:presetDashboard/filters',
  validateRequest({
    params: z.object({
      presetDashboard: z.nativeEnum(PresetDashboard),
    }),
    query: z.object({
      sourceId: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { presetDashboard } = req.params;
      const { sourceId } = req.query;

      const filters = await getPresetDashboardFilters(
        teamId,
        sourceId,
        presetDashboard,
      );

      return res.json(filters);
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/preset/:presetDashboard/filter',
  validateRequest({
    body: z.object({
      filter: PresetDashboardFilterSchema,
    }),
    params: z.object({
      presetDashboard: z.nativeEnum(PresetDashboard),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { filter } = req.body;

      if (filter.presetDashboard !== req.params.presetDashboard) {
        return res
          .status(400)
          .json({ error: 'Preset dashboard in body and params do not match' });
      }

      const updatedPresetDashboardFilter = await updatePresetDashboardFilter(
        teamId,
        filter,
      );

      if (!updatedPresetDashboardFilter) {
        return res.status(404).send();
      }

      return res.json(updatedPresetDashboardFilter);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/preset/:presetDashboard/filter',
  validateRequest({
    body: z.object({
      filter: PresetDashboardFilterSchema,
    }),
    params: z.object({
      presetDashboard: z.nativeEnum(PresetDashboard),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { filter } = req.body;

      if (filter.presetDashboard !== req.params.presetDashboard) {
        return res
          .status(400)
          .json({ error: 'Preset dashboard in body and params do not match' });
      }

      const newPresetDashboardFilter = await createPresetDashboardFilter(
        teamId,
        filter,
      );

      return res.json(newPresetDashboardFilter);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/preset/:presetDashboard/filter/:id',
  validateRequest({
    params: z.object({
      presetDashboard: z.nativeEnum(PresetDashboard),
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { presetDashboard, id } = req.params;

      const deleted = await deletePresetDashboardFilter(
        teamId,
        presetDashboard,
        id,
      );

      if (!deleted) {
        return res.status(404).send();
      }

      return res.json(deleted);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
