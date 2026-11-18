import {
  EXCEPTION_TAG_HEADER_NAME,
  extractErrorAtTheEndOfChunk,
  parseError,
} from '@clickhouse/client-common';
import { errorMonitor } from 'events';
import type { RequestHandler } from 'express';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'http';
import { performance } from 'perf_hooks';

import { isClickHouseError } from '@/utils/clickhouseErrors';
import {
  getServerSpan,
  recordOperationOutcome,
  type Span,
} from '@/utils/instrumentation';

const QUERY_PROXY_OPERATION = 'clickhouse_proxy.query';

/**
 * Why a proxied ClickHouse request failed. Recorded on the server span and as
 * the `error_category` attribute of the `clickhouse_proxy.query` SLI, so the
 * SLO can choose which categories count against it (HDX-6072).
 */
export type ProxyErrorCategory =
  | 'upstream_timeout'
  | 'upstream_unavailable'
  | 'service_overloaded'
  | 'query_timeout'
  | 'query_error'
  | 'client_aborted'
  | 'proxy_error';

export type ProxyFacts = {
  clientAborted: boolean;
  /** The proxy's own upstream timeout fired. */
  timedOut: boolean;
  /** No usable response: set from the proxy `error` event. */
  transportError?: { code?: string };
  upstreamStatus?: number;
  /** The upstream response body ended before it was complete. */
  upstreamCut: boolean;
  clickhouseErrorCode?: number;
  responseStatus: number;
};

// ClickHouse error codes, from src/Common/ErrorCodes.cpp.
const QUERY_TIMEOUT_CODES = new Set([
  159, // TIMEOUT_EXCEEDED
  160, // TOO_SLOW
]);
const OVERLOADED_CODES = new Set([
  202, // TOO_MANY_SIMULTANEOUS_QUERIES
  203, // NO_FREE_CONNECTION
  439, // CANNOT_SCHEDULE_TASK
]);
const UNREACHABLE_ERRNOS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

export function classifyProxyFailure(
  f: ProxyFacts,
): ProxyErrorCategory | undefined {
  if (f.clientAborted) return 'client_aborted';
  const code = f.clickhouseErrorCode;
  if (code != null) {
    if (QUERY_TIMEOUT_CODES.has(code)) return 'query_timeout';
    if (OVERLOADED_CODES.has(code)) return 'service_overloaded';
    return 'query_error';
  }
  if (f.timedOut || f.transportError?.code === 'ETIMEDOUT') {
    return 'upstream_timeout';
  }
  if (f.upstreamCut) return 'upstream_unavailable';
  if (f.transportError) {
    return UNREACHABLE_ERRNOS.has(f.transportError.code ?? '')
      ? 'upstream_unavailable'
      : 'proxy_error';
  }
  const status = f.upstreamStatus;
  if (status != null) {
    if (status === 504) return 'upstream_timeout';
    if (status === 429) return 'service_overloaded';
    if (status >= 500) return 'upstream_unavailable';
    if (status >= 400) return 'query_error';
    return undefined;
  }
  return f.responseStatus >= 400 ? 'proxy_error' : undefined;
}

const EXCEPTION_MARKER = '__exception__';

/**
 * Finds a ClickHouse exception written at the end of a response body, which is
 * how a query fails after it has started streaming (`wait_end_of_query=0`).
 * Since 25.11 the exception is framed with a per-response tag from the
 * `X-ClickHouse-Exception-Tag` header; before that it is an unmarked last line.
 */
export function findTrailingException(
  tail: Buffer,
  exceptionTag?: string,
): { code?: number; message: string } | undefined {
  if (exceptionTag) {
    const trailer = `${exceptionTag}\r\n${EXCEPTION_MARKER}\r\n`;
    if (!tail.toString('latin1').endsWith(trailer)) return undefined;
    return toException(extractErrorAtTheEndOfChunk(tail, exceptionTag));
  }
  const lastLine = tail.toString('utf8').trimEnd().split('\n').pop() ?? '';
  if (!/^Code: \d+\. DB::Exception/.test(lastLine)) return undefined;
  return toException(parseError(lastLine));
}

function toException(err: Error): { code?: number; message: string } {
  const code = isClickHouseError(err) ? Number(err.code) : NaN;
  return {
    code: Number.isFinite(code) ? code : undefined,
    message: err.message,
  };
}

// Enough to hold a ClickHouse exception, which is all the tail is read for.
const TAIL_BYTES = 8 * 1024;
const MAX_MESSAGE_LENGTH = 1000;

type ProxyState = {
  startedAt: number;
  headersAt?: number;
  span?: Span;
  timedOut: boolean;
  upstreamCut: boolean;
  transportError?: { code?: string; message: string };
  upstreamStatus?: number;
  headerErrorCode?: number;
  exceptionTag?: string;
  tail?: Buffer;
  done: boolean;
};

const states = new WeakMap<ServerResponse, ProxyState>();

/**
 * Starts tracking one proxied request. Its outcome is recorded once, when the
 * response closes, from listeners prepended so they run before the HTTP
 * instrumentation ends the server span.
 */
export const trackProxyOutcome: RequestHandler = (_req, res, next) => {
  const state: ProxyState = {
    startedAt: performance.now(),
    span: getServerSpan(),
    timedOut: false,
    upstreamCut: false,
    done: false,
  };
  states.set(res, state);
  const finish = () => finishProxyOutcome(res, state);
  res.prependListener('close', finish);
  res.prependListener(errorMonitor, finish);
  next();
};

export function observeProxyRequest(
  proxyReq: ClientRequest,
  res: ServerResponse,
) {
  const state = states.get(res);
  if (!state) return;
  proxyReq.once('timeout', () => {
    state.timedOut = true;
  });
}

export function observeUpstreamResponse(
  proxyRes: IncomingMessage,
  res: ServerResponse,
) {
  const state = states.get(res);
  if (!state) return;
  state.headersAt = performance.now();
  state.upstreamStatus = proxyRes.statusCode;
  const headerCode = Number(proxyRes.headers['x-clickhouse-exception-code']);
  state.headerErrorCode = Number.isFinite(headerCode) ? headerCode : undefined;
  const tag = proxyRes.headers[EXCEPTION_TAG_HEADER_NAME];
  state.exceptionTag = typeof tag === 'string' ? tag : undefined;

  // These run before the proxy's own listeners, which destroy the response.
  const markCut = () => {
    if (!proxyRes.complete) state.upstreamCut = true;
  };
  proxyRes.once('aborted', markCut);
  proxyRes.once('error', markCut);

  // shortcut: a compressed body is not inspected, so an exception at its end
  // goes undetected; decompress the tail if browsers start asking for gzip.
  if (proxyRes.headers['content-encoding']) return;
  proxyRes.on('data', (chunk: Buffer) => {
    state.tail =
      chunk.length >= TAIL_BYTES || !state.tail
        ? chunk.subarray(-TAIL_BYTES)
        : Buffer.concat([state.tail, chunk]).subarray(-TAIL_BYTES);
  });
}

export function noteTransportError(res: ServerResponse, err: Error) {
  const state = states.get(res);
  if (!state) return;
  const code =
    'code' in err && typeof err.code === 'string' ? err.code : undefined;
  state.transportError = { code, message: err.message };
}

function finishProxyOutcome(res: ServerResponse, state: ProxyState) {
  if (state.done) return;
  state.done = true;

  const failedUpstream =
    state.timedOut || state.upstreamCut || state.transportError != null;
  const isErrorStatus = (state.upstreamStatus ?? 0) >= 400;
  const exception = state.tail
    ? findTrailingException(state.tail, state.exceptionTag)
    : undefined;
  const clickhouseErrorCode = state.headerErrorCode ?? exception?.code;

  const category = classifyProxyFailure({
    clientAborted: !res.writableFinished && !failedUpstream,
    timedOut: state.timedOut,
    transportError: state.transportError,
    upstreamStatus: state.upstreamStatus,
    upstreamCut: state.upstreamCut,
    clickhouseErrorCode,
    responseStatus: res.statusCode,
  });

  const message =
    exception?.message ??
    state.transportError?.message ??
    (isErrorStatus ? state.tail?.toString('utf8') : undefined);

  state.span?.setAttributes({
    'hyperdx.clickhouse_proxy.error.category': category,
    'hyperdx.clickhouse_proxy.upstream.status_code': state.upstreamStatus,
    'hyperdx.clickhouse_proxy.clickhouse.error_code': clickhouseErrorCode,
    'hyperdx.clickhouse_proxy.error.message': category
      ? message?.slice(0, MAX_MESSAGE_LENGTH)
      : undefined,
  });

  // A request abandoned before ClickHouse answered never had an outcome; the
  // SLI has never counted it, and Node's default 200 would call it a success.
  if (category === 'client_aborted' && state.headersAt == null) return;

  recordOperationOutcome({
    operation: QUERY_PROXY_OPERATION,
    // Outcome keeps its status-based meaning; error_category is what lets the
    // SLO decide which failures count.
    outcome:
      state.transportError || (state.upstreamStatus ?? res.statusCode) >= 400
        ? 'error'
        : 'success',
    // Time to the upstream's response headers, as before, so the latency SLI
    // keeps measuring the same thing.
    durationMs: (state.headersAt ?? performance.now()) - state.startedAt,
    attributes: category ? { error_category: category } : undefined,
  });
}
