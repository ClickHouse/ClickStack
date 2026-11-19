import PQueue from '@esm2cjs/p-queue';
import { displayTypeSupportsRawSqlAlerts } from '@hyperdx/common-utils/dist/core/utils';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  AlertChartConfig,
  RawSqlSavedChartConfig,
  Tile,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import ms from 'ms';
import { serializeError } from 'serialize-error';
import { URLSearchParams } from 'url';

import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import { ALERT_HISTORY_QUERY_CONCURRENCY } from '@/controllers/alertHistory';
import { LOCAL_APP_TEAM } from '@/controllers/team';
import { connectDB, mongooseConnection, ObjectId } from '@/models';
import Alert, {
  AlertSource,
  AlertState,
  type IAlert,
  type IAlertError,
} from '@/models/alert';
import AlertHistory, {
  IAlertHistory,
  IAlertHistoryAnalytics,
} from '@/models/alertHistory';
import Connection, { IConnection } from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { type ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { type ISource, Source } from '@/models/source';
import Webhook, { IWebhook } from '@/models/webhook';
import {
  alertHasGroupBy,
  computeHistoryMapKey,
  doesExceedThreshold,
  getAlertWindowStart,
  getConsecutiveWindowHistories,
  getLatestAlertHistories,
  getPreviousAlertHistories,
  type LatestAlertHistory,
} from '@/tasks/checkAlerts';
import {
  type AlertDetails,
  type AlertProvider,
  type AlertTask,
  AlertTaskType,
} from '@/tasks/checkAlerts/providers';
import { MappedOmit } from '@/tasks/types';
import { convertMsToGranularityString } from '@/utils/common';
import logger from '@/utils/logger';

type PartialAlertDetails = MappedOmit<AlertDetails, 'previousMap'>;

async function getSavedSearchDetails(
  alert: IAlert,
): Promise<[IConnection, PartialAlertDetails] | []> {
  const savedSearchId = alert.savedSearch;
  const savedSearch = await SavedSearch.findOne({
    _id: savedSearchId,
    team: alert.team,
  }).populate<Omit<ISavedSearch, 'source'> & { source: ISource }>({
    path: 'source',
    match: { team: alert.team },
  });

  if (!savedSearch) {
    logger.error({
      message: 'savedSearch not found',
      savedSearchId,
      alertId: alert.id,
    });
    return [];
  }

  const { source } = savedSearch;
  const connId = source.connection;
  const conn = await Connection.findOne({
    _id: connId,
    team: alert.team,
  }).select('+password');
  if (!conn) {
    logger.error({
      message: 'connection not found',
      alertId: alert.id,
      connId,
      savedSearchId,
    });
    return [];
  }

  return [
    conn,
    {
      alert,
      source,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
    },
  ];
}

/**
 * Load the optional source a raw-SQL config references for macro metadata
 * ($__sourceTable, metricTables). Write-path validation guarantees the source
 * belongs to the config's connection at save time, but a source can be moved
 * to a different connection afterwards. The query always executes through the
 * config's pinned connection, so metadata from a moved source would silently
 * target the wrong database (when the same table exists there) or fail
 * confusingly. Drop it instead, with a warning: templates that don't use
 * source macros keep evaluating correctly, and templates that do fail with a
 * visible query error recorded on the alert.
 */
async function getRawSqlSourceMetadata(
  alert: IAlert,
  chartConfig: RawSqlSavedChartConfig,
): Promise<ISource | undefined> {
  if (!chartConfig.source) {
    return undefined;
  }
  const sourceDoc = await Source.findOne({
    _id: chartConfig.source,
    team: alert.team,
  });
  if (!sourceDoc) {
    return undefined;
  }
  // Compare as ObjectIds: stored configs may hold non-canonical but valid
  // representations (e.g. uppercase hex), which a lexical compare would
  // misjudge as a mismatch.
  if (
    !new mongoose.Types.ObjectId(String(sourceDoc.connection)).equals(
      chartConfig.connection,
    )
  ) {
    logger.warn({
      message:
        'raw sql alert source has moved to a different connection; ignoring its metadata',
      alertId: alert.id,
      sourceId: chartConfig.source,
      sourceConnectionId: String(sourceDoc.connection),
      configConnectionId: chartConfig.connection,
    });
    return undefined;
  }
  return sourceDoc.toObject();
}

async function getTileDetails(
  alert: IAlert,
): Promise<[IConnection, PartialAlertDetails] | []> {
  const dashboardId = alert.dashboard;
  const tileId = alert.tileId;

  const dashboard = await Dashboard.findOne({
    _id: dashboardId,
    team: alert.team,
  });
  if (!dashboard) {
    logger.error({
      message: 'dashboard not found',
      dashboardId,
      alertId: alert.id,
    });
    return [];
  }

  const tile = dashboard.tiles?.find((t: Tile) => t.id === tileId);
  if (!tile) {
    logger.error({
      message: 'tile matching alert not found',
      tileId,
      dashboardId: dashboard._id,
      alertId: alert.id,
    });
    return [];
  }

  if (isRawSqlSavedChartConfig(tile.config)) {
    if (!displayTypeSupportsRawSqlAlerts(tile.config.displayType)) {
      logger.warn({
        tileId,
        dashboardId: dashboard._id,
        alertId: alert.id,
        message:
          'skipping alert with raw sql chart config, only line/bar display types are supported',
      });
      return [];
    }

    // Raw SQL tiles store connection ID directly on the config
    const connection = await Connection.findOne({
      _id: tile.config.connection,
      team: alert.team,
    }).select('+password');

    if (!connection) {
      logger.error({
        message: 'connection not found for raw sql tile',
        connectionId: tile.config.connection,
        tileId,
        dashboardId: dashboard._id,
        alertId: alert.id,
      });
      return [];
    }

    // Optionally look up source for filter/macro metadata
    const source = await getRawSqlSourceMetadata(alert, tile.config);

    return [
      connection,
      {
        alert,
        source,
        taskType: AlertTaskType.TILE,
        tile,
        dashboard,
      },
    ];
  }

  const source = await Source.findOne({
    _id: tile.config.source,
    team: alert.team,
  }).populate<Omit<ISource, 'connection'> & { connection: IConnection }>({
    path: 'connection',
    match: { team: alert.team },
    select: '+password',
  });
  if (!source) {
    logger.error({
      message: 'source not found',
      sourceId: tile.config.source,
      tileId,
      dashboardId: dashboard._id,
      alertId: alert.id,
    });
    return [];
  }

  if (!source.connection) {
    logger.error({
      message: 'connection not found',
      alertId: alert.id,
      tileId,
      dashboardId: dashboard._id,
      sourceId: source.id,
    });
    return [];
  }

  const connection = source.connection;
  const sourceProps = source.toObject();
  return [
    connection,
    {
      alert,
      source: { ...sourceProps, connection: connection.id },
      taskType: AlertTaskType.TILE,
      tile,
      dashboard,
    },
  ];
}

async function getInlineAlertDetails(
  alert: IAlert,
): Promise<[IConnection, PartialAlertDetails] | []> {
  const chartConfig = alert.chartConfig;
  if (chartConfig == null) {
    logger.error({
      message: 'inline alert has no chartConfig',
      alertId: alert.id,
    });
    return [];
  }

  if (isRawSqlSavedChartConfig(chartConfig)) {
    if (!displayTypeSupportsRawSqlAlerts(chartConfig.displayType)) {
      logger.warn({
        alertId: alert.id,
        message:
          'skipping inline alert with raw sql chart config, only line/bar/number display types are supported',
      });
      return [];
    }

    // Raw SQL configs store the connection ID directly
    const connection = await Connection.findOne({
      _id: chartConfig.connection,
      team: alert.team,
    }).select('+password');

    if (!connection) {
      logger.error({
        message: 'connection not found for raw sql inline alert',
        connectionId: chartConfig.connection,
        alertId: alert.id,
      });
      return [];
    }

    // Optionally look up source for filter/macro metadata
    const source = await getRawSqlSourceMetadata(alert, chartConfig);

    return [
      connection,
      {
        alert,
        source,
        taskType: AlertTaskType.INLINE,
        chartConfig,
      },
    ];
  }

  const source = await Source.findOne({
    _id: chartConfig.source,
    team: alert.team,
  }).populate<Omit<ISource, 'connection'> & { connection: IConnection }>({
    path: 'connection',
    match: { team: alert.team },
    select: '+password',
  });
  if (!source) {
    logger.error({
      message: 'source not found',
      sourceId: chartConfig.source,
      alertId: alert.id,
    });
    return [];
  }

  if (!source.connection) {
    logger.error({
      message: 'connection not found',
      alertId: alert.id,
      sourceId: source.id,
    });
    return [];
  }

  const connection = source.connection;
  const sourceProps = source.toObject();
  return [
    connection,
    {
      alert,
      source: { ...sourceProps, connection: connection.id },
      taskType: AlertTaskType.INLINE,
      chartConfig,
    },
  ];
}

async function resolveAlertDetails(
  alert: IAlert,
): Promise<[IConnection, PartialAlertDetails]> {
  if (!alert.source) {
    throw new Error('alert does not have a source');
  }

  if (config.IS_LOCAL_APP_MODE) {
    // The id is the 12 character string `_local_team_', which will become an ObjectId
    // as the ASCII hex values, so 5f6c6f63616c5f7465616d5f.
    alert.team = new mongoose.Types.ObjectId(LOCAL_APP_TEAM.id);
  }

  let conn: IConnection | undefined;
  let details: PartialAlertDetails | undefined;
  switch (alert.source) {
    case AlertSource.SAVED_SEARCH:
      [conn, details] = await getSavedSearchDetails(alert);
      break;

    case AlertSource.TILE:
      [conn, details] = await getTileDetails(alert);
      break;

    case AlertSource.INLINE:
      [conn, details] = await getInlineAlertDetails(alert);
      break;

    default:
      throw new Error(`unsupported source: ${alert.source}`);
  }

  if (!details) {
    throw new Error('failed to fetch alert details');
  }

  if (!conn) {
    throw new Error('failed to fetch alert connection');
  }

  return [conn, details];
}

async function loadAlerts(): Promise<AlertTask[]> {
  const groupedTasks = new Map<string, AlertTask>();

  const alerts = await Alert.find({});

  const now = new Date();

  const resolved: {
    alert: IAlert;
    conn: IConnection;
    details: PartialAlertDetails;
  }[] = [];
  for (const alert of alerts) {
    try {
      const [conn, details] = await resolveAlertDetails(alert);
      resolved.push({ alert, conn, details });
    } catch (e) {
      logger.error({
        message: `failed to load alert: ${e}`,
        alertId: alert.id,
        team: alert.team,
        channel: alert.channel,
        provider: 'default',
      });
    }
  }

  // Share a single queue across all history fetches so their combined
  // in-flight per-alert queries stay within one global cap.
  const historyQueryQueue = new PQueue({
    concurrency: ALERT_HISTORY_QUERY_CONCURRENCY,
  });

  // Due-ness gate (HDX-4791): a cheap one-key lookup per (in-scope) alert
  // decides whether the alert was already evaluated in the current window.
  // Only alerts that are actually due pay for the per-group history range
  // scan — without this, every task tick (once a minute) re-scans the
  // history window for every alert regardless of the alert's interval, which
  // was the main driver of DocDB secondary CPU / cursor timeouts.
  const latestHistories = await getLatestAlertHistories(
    resolved.map(({ alert }) => alert.id),
    now,
    historyQueryQueue,
  );

  const dueAlertsWithHistory: IAlert[] = [];
  const dueGroupedAlerts: IAlert[] = [];
  const dueNonGroupedAlerts: {
    alert: IAlert;
    latest: NonNullable<ReturnType<(typeof latestHistories)['get']>>;
  }[] = [];
  const gatedAlerts: {
    alert: IAlert;
    latest: NonNullable<ReturnType<(typeof latestHistories)['get']>>;
  }[] = [];
  let noHistoryCount = 0;
  for (const { alert, details } of resolved) {
    const latest = latestHistories.get(alert.id);
    if (!latest) {
      // Never evaluated (or history expired): the alert is due, but there is
      // no previous state to fetch.
      noHistoryCount += 1;
      continue;
    }
    if (wasEvaluatedInCurrentWindow(alert, latest, now)) {
      // Already evaluated in the current window — processAlert will skip it.
      gatedAlerts.push({ alert, latest });
      continue;
    }
    dueAlertsWithHistory.push(alert);
    // Non-grouped alerts only need the latest row, which the gate already
    // fetched; only grouped alerts pay for the per-group range scan (its
    // lookback also serves stale-group auto-resolve).
    if (alertHasGroupBy(details)) {
      dueGroupedAlerts.push(alert);
    } else {
      dueNonGroupedAlerts.push({ alert, latest });
    }
  }

  // When a value of 0 does not breach the threshold, every group whose last
  // row is ALERT or PENDING has a row in the alert's last evaluation:
  // processAlert writes an OK row for each such group missing from the data.
  // A previous OK row only matters for its createdAt, which the last
  // evaluation also has. So these alerts read only that evaluation (below),
  // one row per group, instead of scanning every row in the lookback.
  const [previousAlerts, recentHistoryMap] = await Promise.all([
    getPreviousAlertHistories(
      dueGroupedAlerts.filter(alert => doesExceedThreshold(alert, 0)),
      now,
      historyQueryQueue,
    ),
    getConsecutiveWindowHistories(dueAlertsWithHistory, now, historyQueryQueue),
  ]);

  // Seed non-grouped previous state from the gate row — identical to what
  // the range scan would reduce to.
  for (const { alert, latest } of dueNonGroupedAlerts) {
    previousAlerts.set(computeHistoryMapKey(alert.id, latest.group || ''), {
      _id: new mongoose.Types.ObjectId(alert.id),
      createdAt: latest.createdAt,
      state: latest.state,
      group: latest.group,
      fired: latest.fired,
    });
  }

  // Read the rows of the last evaluation (one per group, all sharing its
  // createdAt) for the grouped alerts not scanned above, and for those whose
  // latest row is older than their scan window, which get no rows back. The
  // evaluation then starts from it and every group keeps its previous state.
  await Promise.all(
    dueGroupedAlerts.map(alert => {
      const latest = latestHistories.get(alert.id);
      if (
        !latest ||
        previousAlerts.has(computeHistoryMapKey(alert.id, latest.group || ''))
      ) {
        return undefined;
      }
      return historyQueryQueue.add(async () => {
        const alertObjectId = new mongoose.Types.ObjectId(alert.id);
        const rows = await AlertHistory.find(
          {
            alert: alertObjectId,
            createdAt: latest.createdAt,
            state: { $ne: AlertState.ERROR },
          },
          { group: 1, state: 1, createdAt: 1, fired: 1, groupValues: 1 },
        ).lean();
        for (const row of rows) {
          previousAlerts.set(computeHistoryMapKey(alert.id, row.group || ''), {
            _id: alertObjectId,
            createdAt: row.createdAt,
            state: row.state,
            group: row.group,
            fired: row.fired,
            groupValues: row.groupValues,
          });
        }
      });
    }),
  );

  // Seed a sentinel entry for each gated alert so processAlert's
  // shouldSkipAlertCheck sees a history row in the current window and skips
  // the evaluation exactly as before (including the skipped_window metric).
  for (const { alert, latest } of gatedAlerts) {
    previousAlerts.set(alert.id, {
      _id: new mongoose.Types.ObjectId(alert.id),
      createdAt: latest.createdAt,
      state: latest.state,
    });
  }

  logger.info(
    {
      alertCount: alerts.length,
      dueCount: dueAlertsWithHistory.length,
      dueGroupedCount: dueGroupedAlerts.length,
      gatedCount: gatedAlerts.length,
      noHistoryCount,
    },
    'Loaded alert histories with due-ness gating',
  );

  for (const { conn, details } of resolved) {
    if (!groupedTasks.has(conn.id)) {
      groupedTasks.set(conn.id, { alerts: [], conn, now });
    }
    groupedTasks.get(conn.id)!.alerts.push({
      ...details,
      previousMap: previousAlerts,
      recentHistoryMap,
    });
  }

  // Flatten out our groupings for execution
  return Array.from(groupedTasks.values());
}

export default class DefaultAlertProvider implements AlertProvider {
  async init() {
    // The check-alerts worker only reads from MongoDB and never needs to
    // ensure indexes exist (the API service owns that). Disabling autoIndex
    // prevents background createIndexes calls from racing the short-lived
    // connection close (which sends endSessions), surfaced as
    // MongoExpiredSessionError on mongodb.createIndexes spans.
    await Promise.all([connectDB({ autoIndex: false })]);
  }

  async asyncDispose() {
    await Promise.all([mongooseConnection.close()]);
  }

  async getAlertTasks(): Promise<AlertTask[]> {
    return loadAlerts();
  }

  buildLogSearchLink({
    endTime,
    savedSearch,
    startTime,
  }: {
    endTime: Date;
    savedSearch: ISavedSearch;
    startTime: Date;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/search/${savedSearch.id}`);
    const queryParams = new URLSearchParams({
      from: startTime.getTime().toString(),
      to: endTime.getTime().toString(),
      isLive: 'false',
    });
    url.search = queryParams.toString();
    return url.toString();
  }

  buildChartLink({
    dashboardId,
    endTime,
    granularity,
    startTime,
    tileId,
  }: {
    dashboardId: string;
    endTime: Date;
    granularity: string;
    startTime: Date;
    tileId?: string;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/dashboards/${dashboardId}`);
    // extend both start and end time by 7x granularity
    const from = (startTime.getTime() - ms(granularity) * 7).toString();
    const to = (endTime.getTime() + ms(granularity) * 7).toString();
    const queryParams = new URLSearchParams({
      from,
      granularity: convertMsToGranularityString(ms(granularity)),
      to,
    });
    if (tileId) {
      queryParams.set('highlightedTileId', tileId);
    }
    url.search = queryParams.toString();
    return url.toString();
  }

  buildChartExplorerLink({
    chartConfig,
    endTime,
    granularity,
    startTime,
  }: {
    chartConfig: AlertChartConfig;
    endTime: Date;
    granularity: string;
    startTime: Date;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/chart`);
    // Extend both start and end time by 7x granularity, matching the
    // dashboard link so the alerting window has surrounding context. The
    // chart explorer reads `config` (JSON) and `from`/`to` (epoch ms).
    const from = (startTime.getTime() - ms(granularity) * 7).toString();
    const to = (endTime.getTime() + ms(granularity) * 7).toString();
    const queryParams = new URLSearchParams({
      config: JSON.stringify(chartConfig),
      from,
      to,
    });
    url.search = queryParams.toString();
    return url.toString();
  }

  async updateAlertState(
    alertId: string,
    histories: IAlertHistory[],
    errors: IAlertError[],
    evaluatedDateRange?: [Date, Date],
  ) {
    // Save history records first (in parallel), then update alert state
    // Use Promise.allSettled to handle partial failures gracefully
    const historyResults = await Promise.allSettled(
      histories.map(history => AlertHistory.create(history)),
    );

    // Log any failed history saves but continue with alert state update
    const failedHistories = historyResults.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedHistories.length > 0) {
      logger.error({
        message: 'Some alert history records failed to save',
        alertId,
        failedCount: failedHistories.length,
        totalCount: histories.length,
        errors: failedHistories.map(f => f.reason),
      });
    }

    // Determine final alert state: use successfully saved histories if any, otherwise fallback to computed state
    // The alert state is ALERT if ANY history (successful or computed) is in ALERT state, otherwise OK
    const successfulHistories = historyResults
      .map((result, index) =>
        result.status === 'fulfilled' ? histories[index] : null,
      )
      .filter((h): h is IAlertHistory => h !== null);

    const historiesToCheck =
      successfulHistories.length > 0 ? successfulHistories : histories;

    const finalState = historiesToCheck.some(h => h.state === AlertState.ALERT)
      ? AlertState.ALERT
      : historiesToCheck.some(h => h.state === AlertState.PENDING)
        ? AlertState.PENDING
        : AlertState.OK;

    // Update alert state + errors based on this execution
    await Alert.updateOne(
      { _id: new mongoose.Types.ObjectId(alertId) },
      { $set: { state: finalState, executionErrors: errors } },
    );

    // All histories in one execution share the same createdAt (the current
    // evaluation window start) and the same evaluation-level analytics.
    const evaluationWindowStart = histories[0]?.createdAt;

    // Failed earlier ticks may have left ERROR rows for windows this
    // evaluation just covered (recordAlertErrors upserts one per failed
    // window, and ERROR rows don't mark a window as evaluated, so those
    // windows are retried — a same-window retry re-evaluates at the same
    // createdAt, while later ticks fold them in as backfilled buckets
    // stamped with the current window start). The query has now succeeded
    // over the whole evaluated range, so remove the stale ERROR rows for
    // every window it covered — otherwise a recovered window renders as
    // ERROR until the TTL expires it (the evaluations view ranks ERROR
    // above OK/ALERT). The range start is exclusive: an ERROR row at
    // exactly the previous anchor belongs to an already-evaluated window
    // (e.g. a webhook failure recorded alongside its normal rows) that is
    // never retried, so it is a truthful record that must survive.
    if (evaluationWindowStart != null && successfulHistories.length > 0) {
      await AlertHistory.deleteMany({
        alert: new mongoose.Types.ObjectId(alertId),
        state: AlertState.ERROR,
        createdAt: evaluatedDateRange
          ? { $gt: evaluatedDateRange[0], $lte: evaluationWindowStart }
          : evaluationWindowStart,
      });
    }

    // Notification (e.g. webhook) failures happened during this evaluation:
    // record them as an ERROR history row alongside the normal rows so the
    // failure is visible in the alert's evaluation history.
    if (errors.length > 0 && evaluationWindowStart != null) {
      await this.upsertErrorHistory(
        alertId,
        evaluationWindowStart,
        errors,
        histories[0]?.analytics,
      );
    }
  }

  async recordAlertErrors(
    alertId: string,
    errors: IAlertError[],
    evaluationWindowStart?: Date,
    analytics?: IAlertHistoryAnalytics,
  ) {
    await Alert.updateOne(
      { _id: new mongoose.Types.ObjectId(alertId) },
      { $set: { executionErrors: errors } },
    );

    if (evaluationWindowStart != null) {
      await this.upsertErrorHistory(
        alertId,
        evaluationWindowStart,
        errors,
        analytics,
      );
    }
  }

  /**
   * Upsert the ERROR-state history row for the given evaluation window.
   * Keyed on {alert, createdAt, state} so retries within the same window
   * update a single row instead of accumulating one row per tick — a
   * permanently failing 1d alert produces one error row per day, not one per
   * minute. Rows expire with the collection's existing TTL index.
   */
  private async upsertErrorHistory(
    alertId: string,
    evaluationWindowStart: Date,
    errors: IAlertError[],
    analytics?: IAlertHistoryAnalytics,
  ) {
    await AlertHistory.updateOne(
      {
        alert: new mongoose.Types.ObjectId(alertId),
        createdAt: evaluationWindowStart,
        state: AlertState.ERROR,
      },
      {
        $set: { errors, ...(analytics != null && { analytics }) },
        $setOnInsert: { counts: 0, lastValues: [] },
      },
      { upsert: true },
    );
  }

  async getWebhooks(teamId: string | ObjectId) {
    const webhooks = await Webhook.find({
      team: new mongoose.Types.ObjectId(teamId),
    });
    return new Map<string, IWebhook>(webhooks.map(w => [w.id, w]));
  }

  async getClickHouseClient(
    { host, username, password, id }: IConnection,
    requestTimeout?: number,
  ): Promise<ClickhouseClient> {
    if (!password && password !== '') {
      logger.info({
        message: `connection password not found`,
        connectionId: id,
        provider: 'default',
      });
    }

    return new ClickhouseClient({
      host,
      username,
      password,
      application: `hyperdx-alerts ${config.CODE_VERSION}`,
      requestTimeout: requestTimeout ?? 30_000,
      // Fallback for anything outside a per-alert scope.
      attribution: { surface: 'alert' },
    });
  }
}

/**
 * Whether the alert's latest history row is from the window processAlert would
 * evaluate now, i.e. processAlert will skip it. A failing evaluator lookup
 * counts as due so processAlert can record the error on that alert.
 */
function wasEvaluatedInCurrentWindow(
  alert: IAlert,
  latest: LatestAlertHistory,
  now: Date,
): boolean {
  try {
    return (
      latest.createdAt.getTime() === getAlertWindowStart(alert, now).getTime()
    );
  } catch (e) {
    logger.error(
      { alertId: alert.id, error: serializeError(e) },
      'Failed to compute alert window start for history gating',
    );
    return false;
  }
}
