import type { ClickhouseClient as BaseClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { tryOptimizeConfigWithMaterializedView } from '@hyperdx/common-utils/dist/core/materializedViews';
import {
  getMetadata,
  Metadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import { buildSloCountsChartConfig } from '@hyperdx/common-utils/dist/core/slo';
import {
  SLO_MAX_PER_TEAM,
  SloApiResponse,
  SloDefinition,
} from '@hyperdx/common-utils/dist/slo';
import {
  BuilderChartConfigWithDateRange,
  isLogSource,
  isTraceSource,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import { performance } from 'perf_hooks';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import Slo, { ISlo } from '@/models/slo';
import { getClickHouseErrorType } from '@/utils/clickhouseErrors';
import { Api400Error } from '@/utils/errors';

export type SloQueryContext = {
  source: TSource;
  clickhouseClient: BaseClickhouseClient;
  metadata: Metadata;
};

/** SLOs are defined on log or trace sources the team owns. */
async function getSloSource(teamId: string, sourceId: string) {
  const source = await getSource(teamId, sourceId);
  if (!source) {
    throw new Api400Error(`Source not found: ${sourceId}`);
  }
  if (source.kind !== SourceKind.Log && source.kind !== SourceKind.Trace) {
    throw new Api400Error(
      `SLOs are defined on log or trace sources; "${source.name}" is a ${source.kind} source.`,
    );
  }
  return source;
}

export async function getSloQueryContext(
  teamId: string,
  sourceId: string,
  timeoutMs: number,
): Promise<SloQueryContext> {
  const source = await getSloSource(teamId, sourceId);
  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    throw new Api400Error(`Connection not found for source: ${sourceId}`);
  }
  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
    requestTimeout: timeoutMs,
  });
  return { source, clickhouseClient, metadata: getMetadata(clickhouseClient) };
}

/**
 * Runs an SLO query, from a materialized view of the source when one covers
 * it, as charts and alerts do; otherwise from the source's table. A timeout
 * ends the query sooner than the client's own.
 */
export async function runSloQuery(
  ctx: SloQueryContext,
  config: BuilderChartConfigWithDateRange,
  timeoutMs?: number,
) {
  const startedAt = performance.now();
  const signal = timeoutMs != null ? AbortSignal.timeout(timeoutMs) : undefined;
  const { source } = ctx;
  const optimized =
    (isLogSource(source) || isTraceSource(source)) &&
    source.materializedViews?.length
      ? await tryOptimizeConfigWithMaterializedView(
          config,
          ctx.metadata,
          ctx.clickhouseClient,
          signal,
          source,
        )
      : config;
  const result = await ctx.clickhouseClient.queryChartConfig({
    config: optimized,
    metadata: ctx.metadata,
    querySettings: source.querySettings,
    opts: { abort_signal: signal },
  });
  return {
    rows: result.data,
    rowsRead: Number(result.statistics?.rows_read ?? 0),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/** The save-time check reads one minute, enough to compile and run the query. */
const SLO_CHECK_RANGE_MS = 60_000;
const SLO_CHECK_TIMEOUT_MS = 15_000;

/**
 * Runs the SLO's counts query over the last minute, so a condition ClickHouse
 * rejects (an unknown column, a syntax error) fails the save with ClickHouse's
 * message instead of turning up later as an error state.
 */
async function checkSloQuery(teamId: string, definition: SloDefinition) {
  const ctx = await getSloQueryContext(
    teamId,
    definition.source,
    SLO_CHECK_TIMEOUT_MS,
  );
  const now = new Date();
  try {
    await runSloQuery(
      ctx,
      buildSloCountsChartConfig({
        slo: definition,
        source: ctx.source,
        dateRange: [new Date(now.getTime() - SLO_CHECK_RANGE_MS), now],
        // By group when there is one, so a bad group-by fails the save too.
        scope: { byGroup: true },
      }),
    );
  } catch (e) {
    // Only errors ClickHouse returned describe the definition; a network
    // failure is the server's problem, not the user's.
    if (getClickHouseErrorType(e) != null && e instanceof Error) {
      throw new Api400Error(`The SLO's query failed: ${e.message}`);
    }
    throw e;
  }
}

export function listSlos(teamId: string) {
  return Slo.find({ team: teamId }).sort({ name: 1 }).lean();
}

export function getSlo(teamId: string, sloId: string) {
  if (!mongoose.Types.ObjectId.isValid(sloId)) return null;
  return Slo.findOne({ _id: sloId, team: teamId }).lean();
}

export async function createSlo(
  teamId: string,
  userId: string | undefined,
  definition: SloDefinition,
) {
  if ((await Slo.countDocuments({ team: teamId })) >= SLO_MAX_PER_TEAM) {
    throw new Api400Error(`A team can have at most ${SLO_MAX_PER_TEAM} SLOs`);
  }
  await checkSloQuery(teamId, definition);
  // The status refresh picks up an SLO without a snapshot on its next run.
  return (
    await Slo.create({
      ...definition,
      groupBy: definition.groupBy || null,
      team: teamId,
      createdBy: userId,
      updatedBy: userId,
    })
  ).toObject();
}

export async function updateSlo(
  teamId: string,
  sloId: string,
  userId: string | undefined,
  definition: SloDefinition,
) {
  const existing = await getSlo(teamId, sloId);
  if (!existing) return null;
  await checkSloQuery(teamId, definition);
  // Every input of the stored numbers: a change makes the snapshot wrong,
  // and the refresh recomputes it on its next run.
  const changed =
    existing.source.toString() !== definition.source ||
    existing.target !== definition.target ||
    existing.window !== definition.window ||
    (existing.groupBy ?? null) !== (definition.groupBy ?? null) ||
    JSON.stringify(existing.indicator) !== JSON.stringify(definition.indicator);
  return Slo.findOneAndUpdate(
    { _id: sloId, team: teamId },
    {
      $set: {
        ...definition,
        description: definition.description ?? '',
        groupBy: definition.groupBy || null,
        updatedBy: userId,
      },
      ...(changed ? { $unset: { status: 1 } } : {}),
    },
    { new: true },
  ).lean();
}

export async function deleteSlo(teamId: string, sloId: string) {
  if (!mongoose.Types.ObjectId.isValid(sloId)) return false;
  const result = await Slo.deleteOne({ _id: sloId, team: teamId });
  return result.deletedCount > 0;
}

export function formatSlo(slo: ISlo): SloApiResponse {
  return {
    id: slo._id.toString(),
    version: slo.version,
    name: slo.name,
    description: slo.description,
    tags: slo.tags ?? [],
    source: slo.source.toString(),
    indicator: slo.indicator,
    target: slo.target,
    window: slo.window,
    groupBy: slo.groupBy ?? null,
    alerts: slo.alerts ?? {},
    status: slo.status ?? null,
    alertStates: {},
    createdAt: slo.createdAt.toISOString(),
    updatedAt: slo.updatedAt.toISOString(),
  };
}
