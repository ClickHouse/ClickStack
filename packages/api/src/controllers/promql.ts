import {
  buildLogComment,
  buildQueryId,
} from '@hyperdx/common-utils/dist/clickhouse';
import { getCurrentQueryAttribution } from '@hyperdx/common-utils/dist/clickhouse/node';
import { MetadataCache } from '@hyperdx/common-utils/dist/core/metadata';
import type { PromqlQuery } from '@hyperdx/common-utils/dist/core/promqlChart';
import { parseJSON } from '@hyperdx/common-utils/dist/core/utils';
import {
  type PromqlSourceBackend,
  SourceKind,
  type SQLInterval,
} from '@hyperdx/common-utils/dist/types';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import {
  connectionPrometheusHttpApiSupport,
  PROMETHEUS_MAX_EXECUTION_SEC,
  PROMETHEUS_MAX_RESULT_ROWS,
  type PrometheusHttpApiSupport,
  queryInstantViaTableFunction,
  queryLabelNames,
  queryLabelValues,
  queryRangeViaTableFunction,
} from '@/controllers/timeseriesEngine';
import { withSpan } from '@/utils/instrumentation';
import {
  readBoundedBody,
  ResponseTooLargeError,
} from '@/utils/readBoundedBody';

type PromqlBackend = 'prometheus' | 'clickhouse';

const PROMETHEUS_FETCH_TIMEOUT_MS = 30_000;
const PROMETHEUS_CH_TIMEOUT_MS = 30_000;
export const PROMETHEUS_MAX_RESOLUTION = 11_000;
/**
 * Largest Prometheus response body fetchPrometheusData will read into memory.
 *
 * Queries to ClickHouse are already capped by `max_result_rows`
 * (PROMETHEUS_MAX_RESULT_ROWS). An external Prometheus has no equivalent:
 * `/query` and `/query_range` take no row limit, and older servers ignore
 * `limit` on the label APIs. So the only way to bound the memory a response
 * can take is to stop reading at a byte limit. 8 MB fits roughly
 * PROMETHEUS_MAX_RESULT_ROWS label values, so both backends allow about the
 * same amount of data.
 */
export const PROMETHEUS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// ClickHouse serves the Prometheus HTTP API under this prefix on its main HTTP
// port when the `prometheus_api_v1` handler is configured (26.6+).
export const CLICKHOUSE_PROMETHEUS_API_PREFIX = '/prometheus/api/v1';

/**
 * Join a Connection host with an absolute Prometheus API path.
 *
 * `new URL('/api/v1/query_range', 'http://host:8481/select/0/prometheus')`
 * discards `/select/0/prometheus` because an absolute path replaces the base
 * pathname. VictoriaMetrics cluster (and any Prometheus-compatible server
 * mounted under a prefix) needs that prefix kept. Host userinfo, query, and
 * hash are left untouched.
 *
 * `path` must be an absolute path (every call site passes a literal starting
 * with `/`) -- this is not a general-purpose URL joiner.
 *
 * @see https://github.com/ClickHouse/ClickStack/issues/3046
 */
export function joinPrometheusUpstreamUrl(
  upstreamHost: string,
  path: string,
): URL {
  const url = new URL(upstreamHost);
  // `new URL('prometheus:9090')` succeeds with an opaque path (`prometheus:`
  // scheme). The pathname setter is a no-op there, so without this guard the
  // helper would return the host unchanged, `fetch` would fail, and the proxy
  // would 502 / increment query_errors for a user misconfiguration. Same check
  // as clickhouseProxy.ts.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Connection host must be http(s)');
  }
  // Strip ALL trailing slashes, not just one -- a host saved with a doubled
  // trailing slash (e.g. `http://prom:9090//`) would otherwise leave a `//`
  // in the joined path, which most servers treat as a distinct (404) path.
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${path}`;
  return url;
}

/**
 * Removes `user:pass@` from `url` and returns it as a Basic auth header. fetch
 * rejects a URL that carries credentials, so they cannot stay in the host.
 */
function takeBasicAuthHeader(url: URL): Record<string, string> {
  if (!url.username && !url.password) return {};
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  url.username = '';
  url.password = '';
  return {
    Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
  };
}

/**
 * Builds a GET to `path` on a Prometheus-compatible host. Each key in `params`
 * replaces whatever the host pins at that key: an array sends every item and an
 * empty array clears the key. Keys not in `params`, such as a VictoriaMetrics
 * `extra_label` scope, stay as the host set them. Credentials in the host's
 * userinfo become a Basic auth header, sent alongside `headers`. Throws when
 * the host is not an http(s) URL.
 */
export function buildPrometheusRequest(
  host: string,
  path: string,
  params: Record<string, string | string[]>,
  headers?: Record<string, string>,
): {
  url: string;
  headers: Record<string, string>;
  /** Origin and path only, safe for error messages shown to the user. */
  redactedTarget: string;
} {
  const url = joinPrometheusUpstreamUrl(host, path);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.delete(key);
    for (const item of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, item);
    }
  }
  const authHeader = takeBasicAuthHeader(url);
  return {
    url: url.toString(),
    headers: { ...authHeader, ...headers },
    // `origin` never includes userinfo, and the query string may hold a
    // host-pinned secret such as VictoriaMetrics' `authKey`.
    redactedTarget: `${url.origin}${url.pathname}`,
  };
}

/**
 * A failed PromQL evaluation. `user` means the query itself was rejected (bad
 * syntax, unknown function); `server` means the backend was unreachable, timed
 * out or failed.
 */
export class PromQLQueryError extends Error {
  constructor(
    message: string,
    readonly category: 'user' | 'server',
  ) {
    super(message);
    this.name = 'PromQLQueryError';
  }
}

const prometheusBodySchema = z.object({
  status: z.string(),
  data: z.unknown(),
  errorType: z.string().optional(),
  error: z.string().optional(),
});

// Prometheus reports these as 4xx/5xx alike; neither says the query was wrong.
const SERVER_ERROR_TYPES = new Set(['timeout', 'canceled', 'unavailable']);

const labelListSchema = z.array(z.string());

/**
 * What a user is told when a source set to the Prometheus HTTP API reaches a
 * ClickHouse server that does not serve it. Without it they would see a bare
 * 404 from a path they never chose.
 */
export const CLICKHOUSE_HTTP_API_UNAVAILABLE_MESSAGE =
  "This ClickHouse connection does not serve the Prometheus HTTP API. Enable the prometheus_api_v1 HTTP handler on the server, or set the source's PromQL backend to Auto.";

/**
 * GETs a Prometheus API path from a Prometheus-compatible endpoint and returns
 * the response's `data`, checked against `dataSchema`. Errors name only the
 * origin and path: the host may carry credentials in its userinfo or query
 * string.
 *
 * `handlerMissingMessage` is for ClickHouse's own Prometheus API: a 404 there
 * means the handler is not configured (the handler itself answers failures
 * with a 400), which is reported with this message as a user error instead of
 * by its status.
 */
async function fetchPrometheusData<T extends z.ZodTypeAny>(
  host: string,
  path: string,
  params: Record<string, string>,
  dataSchema: T,
  signal?: AbortSignal,
  headers?: Record<string, string>,
  handlerMissingMessage?: string,
): Promise<z.infer<T>> {
  const request = buildPrometheusRequest(host, path, params, headers);
  const { redactedTarget } = request;
  const timeout = AbortSignal.timeout(PROMETHEUS_FETCH_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(request.url, {
      headers: request.headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    throw new PromQLQueryError(
      err instanceof Error && err.name === 'TimeoutError'
        ? `Prometheus request to ${redactedTarget} timed out`
        : `Failed to reach Prometheus at ${redactedTarget}`,
      'server',
    );
  }

  if (handlerMissingMessage && resp.status === 404) {
    await resp.body?.cancel().catch(() => {});
    throw new PromQLQueryError(handlerMissingMessage, 'user');
  }

  let text: string;
  try {
    text = await readBoundedBody(resp, PROMETHEUS_MAX_RESPONSE_BYTES);
  } catch (err) {
    const tooLargeMessage = `Prometheus at ${redactedTarget} returned more than ${PROMETHEUS_MAX_RESPONSE_BYTES / (1024 * 1024)} MB. Narrow the query or time range.`;
    const genericMessage = `Failed to read the response from Prometheus at ${redactedTarget}`;
    throw new PromQLQueryError(
      err instanceof ResponseTooLargeError ? tooLargeMessage : genericMessage,
      'server',
    );
  }
  // A body that is not JSON (a proxy's HTML error page, say) is reported by
  // its HTTP status below.
  const body = prometheusBodySchema.safeParse(parseJSON(text));
  if (!resp.ok || !body.success || body.data.status !== 'success') {
    const isUserError =
      resp.status >= 400 &&
      resp.status < 500 &&
      !SERVER_ERROR_TYPES.has((body.success && body.data.errorType) || '');
    throw new PromQLQueryError(
      (body.success && body.data.error) ||
        `Prometheus at ${redactedTarget} returned HTTP ${resp.status}`,
      isUserError ? 'user' : 'server',
    );
  }
  const data = dataSchema.safeParse(body.data.data);
  if (!data.success) {
    throw new PromQLQueryError(
      `Prometheus at ${redactedTarget} returned an unexpected response`,
      'server',
    );
  }
  return data.data;
}

export type PromqlLabelCatalog = {
  backend: PromqlBackend;
  /** Without `metricName`, only a Prometheus endpoint lists label names. */
  labelNames?: string[];
  metricNames: string[];
};

/**
 * Lists the metric names a PromQL source holds, and label names: of
 * `metricName` when given, else of every series on a Prometheus endpoint. At
 * most `limit` of each; returns `limit + 1` entries when there are more, so
 * callers can tell the list was cut.
 *
 * A Prometheus endpoint answers for [startMs, endMs]. A ClickHouse TimeSeries
 * table is read with SQL on its tags table, without the window, whatever
 * backend evaluates its queries: the window costs a pass over every series
 * id, on the HTTP API too, which large tables can't afford (#3648).
 */
export async function getPromqlLabelCatalog({
  teamId,
  source,
  startMs,
  endMs,
  metricName,
  limit,
  signal,
}: {
  teamId: string;
  source: {
    connection: { toString(): string };
    from: { databaseName: string; tableName: string };
  };
  startMs: number;
  endMs: number;
  metricName?: string;
  limit: number;
  signal?: AbortSignal;
}): Promise<PromqlLabelCatalog> {
  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    throw new Error('Connection not found');
  }

  if (connection.isPrometheusEndpoint) {
    const params = {
      start: String(startMs / 1000),
      end: String(endMs / 1000),
      limit: String(limit + 1),
    };
    const fetchLabels = (path: string, extra: Record<string, string> = {}) =>
      fetchPrometheusData(
        connection.host,
        `/api/v1${path}`,
        { ...params, ...extra },
        labelListSchema,
        signal,
      );
    const [labelNames, metricNames] = await Promise.all([
      fetchLabels(
        '/labels',
        metricName != null
          ? { 'match[]': `{__name__=${JSON.stringify(metricName)}}` }
          : {},
      ),
      fetchLabels('/label/__name__/values'),
    ]);
    return { backend: 'prometheus', labelNames, metricNames };
  }

  const args = {
    client: new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
      requestTimeout: PROMETHEUS_FETCH_TIMEOUT_MS,
    }),
    connectionId: connection.id,
    databaseName: source.from.databaseName,
    tableName: source.from.tableName,
    limit: limit + 1,
    signal,
  };
  // No startMs/endMs: without them neither lookup reads the time ranges.
  const [labelNames, metricNames] = await Promise.all([
    metricName != null ? queryLabelNames({ ...args, metricName }) : undefined,
    queryLabelValues({ ...args, labelName: '__name__' }),
  ]);
  return { backend: 'clickhouse', labelNames, metricNames };
}

type PromqlTarget = {
  connection: NonNullable<Awaited<ReturnType<typeof getConnectionById>>>;
  databaseName: string;
  tableName: string;
  /** The source's scrape interval floor, e.g. "1 minute". */
  minAutoGranularity?: SQLInterval;
  /** How the source is evaluated on ClickHouse; unset means `auto`. */
  promqlBackend?: PromqlSourceBackend;
};

/**
 * Resolve the PromQL source a request names into the connection and table to
 * query. The table always comes from the source, never from the request, so a
 * caller can only reach data through a source.
 */
export async function resolvePromqlTarget(
  teamId: string,
  sourceId: string | undefined,
  { selectPassword }: { selectPassword: boolean },
): Promise<PromqlTarget | { status: 400 | 404; error: string }> {
  if (!sourceId) {
    return { status: 400, error: 'missing required parameter: sourceId' };
  }

  const source = await getSource(teamId, sourceId);

  if (!source || source.kind !== SourceKind.Promql) {
    return { status: 404, error: 'Source not found' };
  }

  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    selectPassword,
  );

  if (!connection) {
    return { status: 404, error: 'Connection not found' };
  }

  return {
    connection,
    databaseName: source.from.databaseName,
    tableName: source.from.tableName,
    minAutoGranularity: source.minAutoGranularity,
    promqlBackend: source.promqlBackend,
  };
}

/**
 * The ClickHouse connection host with the query limits pinned as ClickHouse
 * HTTP settings. The prometheus_api_v1 handler honours settings given in the
 * URL and reports a breach as a Prometheus 400 (pinned by the live int test),
 * so this is the only place to bound a PromQL evaluation — the request carries
 * no SQL to attach SETTINGS to. Pinned on the host rather than passed as params
 * so the merge in proxyToPrometheus (which lets the caller override any
 * allowlisted key) can't loosen them.
 */
export function clickhousePrometheusUpstream(
  host: string,
  {
    maxExecutionSec = PROMETHEUS_MAX_EXECUTION_SEC,
    maxResultRows = PROMETHEUS_MAX_RESULT_ROWS,
    logComment,
  }: {
    maxExecutionSec?: number;
    maxResultRows?: number;
    logComment?: string;
  } = {},
): string {
  const url = new URL(host);
  url.searchParams.set('max_execution_time', String(maxExecutionSec));
  url.searchParams.set('max_result_rows', String(maxResultRows));
  if (logComment) url.searchParams.set('log_comment', logComment);
  return url.toString();
}

function clickhouseAuthHeaders(connection: {
  username: string;
  password?: string;
}): Record<string, string> {
  return {
    'X-ClickHouse-User': connection.username,
    'X-ClickHouse-Key': connection.password ?? '',
  };
}

type ClickhouseCredentials = {
  host: string;
  username: string;
  password?: string;
};

/**
 * Where and how to send one PromQL request to the connection's
 * prometheus_api_v1 handler, tagged with the query attribution in scope. The
 * handler runs the query itself rather than through our ClickHouse client, so
 * the tags are set here. `log_comment` goes in the URL like the limits.
 * `query_id` goes in a header: the handler reads every URL param as a setting,
 * and `query_id` in the URL fails the request as an unknown one.
 *
 * Call once per request: ClickHouse rejects a query whose ID is already
 * running, so concurrent requests must not share the result.
 */
export function clickhousePrometheusRequest(
  connection: ClickhouseCredentials,
): { upstream: string; headers: Record<string, string> } {
  const attribution = getCurrentQueryAttribution();
  return {
    upstream: clickhousePrometheusUpstream(connection.host, {
      logComment: buildLogComment(attribution),
    }),
    headers: {
      ...clickhouseAuthHeaders(connection),
      'X-ClickHouse-Query-Id': buildQueryId(attribution),
    },
  };
}

export function newPromqlClickhouseClient(connection: {
  host: string;
  username: string;
  password?: string;
}) {
  return new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
    requestTimeout: PROMETHEUS_CH_TIMEOUT_MS,
  });
}

const PROBE_TIMEOUT_MS = 5_000;

// How long a probe answer is kept. A server's version and handler config
// change rarely, and a stale answer only costs errors until the entry expires.
const BACKEND_PROBE_TTL_MS = 5 * 60_000;

let backendProbeCache = new MetadataCache();

/** Forgets every kept probe answer. For tests. */
export function clearBackendProbeCache(): void {
  backendProbeCache = new MetadataCache();
}

/** The probe could not tell, so its outcome must not be kept. */
class InconclusiveProbeError extends Error {}

const NO_PROMETHEUS_HTTP_API: PrometheusHttpApiSupport = {
  query: false,
  labels: false,
};

/**
 * Asks a ClickHouse connection which parts of the Prometheus HTTP API it
 * serves. Two conditions, cheapest first: the server is new enough (26.6+ for
 * queries, 26.9+ for label lookups), and the prometheus_api_v1 handler is
 * actually configured — a self-managed server needs an `<http_handlers>` rule
 * for that, which a stock install lacks. The
 * handler answers every request, error or not, with Prometheus JSON
 * (`{status, ...}`); a server without it answers a plain-text 404.
 * `format_query` is used as the probe because it is the one endpoint that
 * needs no table.
 *
 * Resolves only with a definitive answer. Rejects with
 * InconclusiveProbeError when the server could not be asked or answered with
 * something that says nothing about the handler (a timeout, a proxy's 502, a
 * rejected login), so a blip is never kept as "no".
 */
async function probePrometheusHttpApi(
  client: ClickhouseClient,
  connection: { id: string; host: string; username: string; password?: string },
): Promise<PrometheusHttpApiSupport> {
  const supported = await connectionPrometheusHttpApiSupport({
    client,
    connectionId: connection.id,
  });
  if (supported === undefined) throw new InconclusiveProbeError();
  if (!supported.query) return NO_PROMETHEUS_HTTP_API;

  let status: number;
  let text: string;
  try {
    const { url, headers } = buildPrometheusRequest(
      connection.host,
      `${CLICKHOUSE_PROMETHEUS_API_PREFIX}/format_query`,
      { query: 'up' },
      clickhouseAuthHeaders(connection),
    );
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    status = resp.status;
    text = await resp.text();
  } catch {
    throw new InconclusiveProbeError();
  }

  if (typeof parseJSON(text)?.status === 'string') return supported;
  if (status === 404) return NO_PROMETHEUS_HTTP_API;
  throw new InconclusiveProbeError();
}

/**
 * Which parts of the Prometheus HTTP API a ClickHouse connection serves,
 * keeping a definitive answer for BACKEND_PROBE_TTL_MS so each request does
 * not pay for a `SELECT version()` and a probe request first. Keyed on the
 * host as well as the connection, so editing a connection's host drops its
 * answer. Concurrent callers share one probe. An inconclusive probe is
 * answered "none" for this request only.
 */
async function prometheusHttpApiSupport(
  client: ClickhouseClient,
  connection: { id: string; host: string; username: string; password?: string },
): Promise<PrometheusHttpApiSupport> {
  const key = `${connection.id}|${connection.host}`;
  const span = trace.getActiveSpan();

  const kept = backendProbeCache.get<PrometheusHttpApiSupport>(key);
  if (kept !== undefined) {
    span?.setAttribute('hyperdx.promql.backend_probe', 'cached');
    return kept;
  }

  try {
    const served = await backendProbeCache.getOrFetch(
      key,
      () => probePrometheusHttpApi(client, connection),
      { ttlMs: BACKEND_PROBE_TTL_MS },
    );
    span?.setAttribute('hyperdx.promql.backend_probe', 'live');
    return served;
  } catch {
    span?.setAttribute('hyperdx.promql.backend_probe', 'inconclusive');
    return NO_PROMETHEUS_HTTP_API;
  }
}

/**
 * Whether a connection serves PromQL over ClickHouse's HTTP API right now,
 * for callers that want to pin a source to it (see the onboarding flow). Reads
 * the same kept answer the queries do. Only a definitive yes is true: a
 * Prometheus endpoint, an old server, a missing handler and a server that
 * could not be asked all answer false.
 */
export async function connectionServesPrometheusHttpApi(connection: {
  id: string;
  host: string;
  username: string;
  password?: string;
  isPrometheusEndpoint?: boolean;
}): Promise<boolean> {
  if (connection.isPrometheusEndpoint) return false;
  const support = await prometheusHttpApiSupport(
    newPromqlClickhouseClient(connection),
    connection,
  );
  return support.query;
}

type ClickhouseQueryBackend =
  | {
      kind: 'clickhouse-http';
      connection: ClickhouseCredentials;
      databaseName: string;
      tableName: string;
    }
  | {
      kind: 'table-function';
      client: ClickhouseClient;
      connectionId: string;
      databaseName: string;
      tableName: string;
    };

/** How a PromQL query against a source is evaluated. */
type PromqlQueryBackend =
  | { kind: 'prometheus'; host: string }
  | ClickhouseQueryBackend;

/**
 * How to evaluate PromQL on a ClickHouse-backed target. The Prometheus HTTP
 * API is the only surface ClickHouse holds forward-compatible while TimeSeries
 * is in preview, so under `auto` it is preferred wherever the server has it
 * (26.6+) and the table function is the fallback. A source set to either one
 * is taken at its word, with no probe.
 */
export async function resolveClickhouseQueryBackend({
  connection,
  databaseName,
  tableName,
  promqlBackend = 'auto',
}: PromqlTarget): Promise<ClickhouseQueryBackend> {
  const client = newPromqlClickhouseClient(connection);
  const span = trace.getActiveSpan();
  span?.setAttribute('hyperdx.promql.backend_setting', promqlBackend);

  let useHttpApi: boolean;
  if (promqlBackend === 'auto') {
    useHttpApi = (await prometheusHttpApiSupport(client, connection)).query;
  } else {
    span?.setAttribute('hyperdx.promql.backend_probe', 'skipped');
    useHttpApi = promqlBackend === 'clickhouse-http';
  }
  if (useHttpApi) {
    return {
      kind: 'clickhouse-http',
      connection: {
        host: connection.host,
        username: connection.username,
        password: connection.password,
      },
      databaseName,
      tableName,
    };
  }
  return {
    kind: 'table-function',
    client,
    connectionId: connection.id,
    databaseName,
    tableName,
  };
}

/**
 * How to answer a label lookup (`/labels`, `/label/<name>/values`) on a
 * ClickHouse target: through the Prometheus HTTP API, or with SQL against the
 * tags table. The handler serves label lookups only from 26.9, three releases
 * after it serves queries, so a source on the HTTP API reads labels with SQL
 * on 26.6-26.8 rather than losing them. That holds for a source set to
 * `clickhouse-http` too, so it is probed like `auto`. A source set to
 * `table-function` reads them with SQL, with no probe.
 */
export async function resolveClickhouseLabelBackend({
  connection,
  promqlBackend = 'auto',
}: PromqlTarget): Promise<'clickhouse-http' | 'sql'> {
  const span = trace.getActiveSpan();
  span?.setAttribute('hyperdx.promql.backend_setting', promqlBackend);

  let labelBackend: 'clickhouse-http' | 'sql' = 'sql';
  if (promqlBackend === 'table-function') {
    span?.setAttribute('hyperdx.promql.backend_probe', 'skipped');
  } else {
    const support = await prometheusHttpApiSupport(
      newPromqlClickhouseClient(connection),
      connection,
    );
    if (support.labels) labelBackend = 'clickhouse-http';
  }
  span?.setAttribute('hyperdx.promql.label_backend', labelBackend);
  return labelBackend;
}

/** How to evaluate PromQL on a target. Probes ClickHouse targets for the HTTP API. */
export async function resolvePromqlQueryBackend(
  target: PromqlTarget,
): Promise<PromqlQueryBackend> {
  if (target.connection.isPrometheusEndpoint) {
    return { kind: 'prometheus', host: target.connection.host };
  }
  return resolveClickhouseQueryBackend(target);
}

const sampleSchema = z.tuple([z.number(), z.string()]);
const metricSchema = z.record(z.string());

const promqlQueryDataSchema = z.discriminatedUnion('resultType', [
  z.object({
    resultType: z.literal('matrix'),
    result: z.array(
      z.object({ metric: metricSchema, values: z.array(sampleSchema) }),
    ),
  }),
  z.object({
    resultType: z.literal('vector'),
    result: z.array(z.object({ metric: metricSchema, value: sampleSchema })),
  }),
  z.object({ resultType: z.literal('scalar'), result: sampleSchema }),
  z.object({ resultType: z.literal('string'), result: sampleSchema }),
]);

/** The `data` payload of a Prometheus query or query_range response. */
export type PromqlQueryData = z.infer<typeof promqlQueryDataSchema>;

function promqlQueryParams(query: PromqlQuery): Record<string, string> {
  return query.kind === 'range'
    ? {
        query: query.expr,
        start: String(query.startSec),
        end: String(query.endSec),
        step: String(query.stepSec),
      }
    : {
        query: query.expr,
        time: String(query.timeSec),
        ...(query.limit != null ? { limit: String(query.limit) } : {}),
      };
}

async function evaluatePromqlQuery(
  backend: PromqlQueryBackend,
  query: PromqlQuery,
  signal?: AbortSignal,
): Promise<PromqlQueryData> {
  const endpoint = query.kind === 'range' ? 'query_range' : 'query';
  switch (backend.kind) {
    case 'prometheus':
      return fetchPrometheusData(
        backend.host,
        `/api/v1/${endpoint}`,
        promqlQueryParams(query),
        promqlQueryDataSchema,
        signal,
      );
    case 'clickhouse-http': {
      const { upstream, headers } = clickhousePrometheusRequest(
        backend.connection,
      );
      return fetchPrometheusData(
        upstream,
        `${CLICKHOUSE_PROMETHEUS_API_PREFIX}/${endpoint}`,
        {
          ...promqlQueryParams(query),
          database: backend.databaseName,
          table: backend.tableName,
        },
        promqlQueryDataSchema,
        signal,
        headers,
        CLICKHOUSE_HTTP_API_UNAVAILABLE_MESSAGE,
      );
    }
    case 'table-function':
      return query.kind === 'range'
        ? {
            resultType: 'matrix',
            result: await queryRangeViaTableFunction({
              client: backend.client,
              connectionId: backend.connectionId,
              databaseName: backend.databaseName,
              tableName: backend.tableName,
              expr: query.expr,
              startMs: Math.floor(query.startSec * 1000),
              endMs: Math.floor(query.endSec * 1000),
              stepSec: Math.max(Math.floor(query.stepSec), 1),
              signal,
            }),
          }
        : {
            resultType: 'vector',
            result: await queryInstantViaTableFunction({
              client: backend.client,
              databaseName: backend.databaseName,
              tableName: backend.tableName,
              expr: query.expr,
              evalMs: Math.floor(query.timeSec * 1000),
              signal,
            }),
          };
  }
}

/**
 * Evaluates one PromQL query and returns the Prometheus `data` payload. Throws
 * PromQLQueryError for a rejected or failed query; the table-function backend
 * throws ClickHouse errors as they come.
 */
export async function runPromqlQuery(
  backend: PromqlQueryBackend,
  query: PromqlQuery,
  signal?: AbortSignal,
): Promise<PromqlQueryData> {
  if (
    query.kind === 'range' &&
    (query.stepSec <= 0 ||
      (query.endSec - query.startSec) / query.stepSec >
        PROMETHEUS_MAX_RESOLUTION)
  ) {
    throw new PromQLQueryError(
      `exceeded maximum resolution of ${PROMETHEUS_MAX_RESOLUTION.toLocaleString('en-US')} points per timeseries. Try a coarser granularity.`,
      'user',
    );
  }
  return withSpan(
    'promql.query',
    () => evaluatePromqlQuery(backend, query, signal),
    {
      attributes: {
        'hyperdx.promql.backend': backend.kind,
        'hyperdx.promql.query_kind': query.kind,
      },
    },
  );
}
