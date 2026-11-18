/**
 * Reassembles rrweb events from the chunked log records emitted by the
 * HyperDX session recorder.
 *
 * The recorder JSON-stringifies each rrweb event and splits anything larger
 * than ~950KB into multiple log records. Every record carries:
 *   - `rr-web.event` (`ev`): counter identifying the event, shared by all of
 *     its chunks
 *   - `rr-web.chunk` (`ck`): 1-based chunk index within the event
 *   - `rr-web.total-chunks` (`tcks`): number of chunks for the event
 *
 * All chunks of one event share the same log timestamp, so the stream order
 * of chunks is only as reliable as the query's ORDER BY. This assembler
 * buffers chunks per event and joins them sorted by chunk index, so a
 * replay can never be corrupted by out-of-order or interleaved chunks —
 * which previously scrambled the concatenation, made JSON.parse throw, and
 * silently dropped the event (https://github.com/ClickHouse/ClickStack/issues/2569).
 *
 * `@hyperdx/browser` and `@clickhouse/clickstack-browser` up to 1.2.0 restart
 * `rr-web.event` at 1 on every page load, so one session repeats event ids.
 * Events are keyed by id plus full-precision timestamp: keyed by id alone, a
 * page's orphaned chunk (the rest lost when the page closed) completes a later
 * page's event of the same id and corrupts it. Second precision is not enough,
 * since two page loads can start within the same second.
 *
 * ClickHouse returns the attributes as strings (or `''` when absent), so all
 * fields are coerced before use.
 */

export type RRWebStreamRow = {
  /** Body fragment (whole event when unchunked) */
  b: string;
  /** simpleJSONExtractInt(Body, 'type') — only meaningful on the first chunk */
  t?: number | string;
  /** rr-web.chunk — 1-based chunk index */
  ck?: number | string;
  /** rr-web.total-chunks */
  tcks?: number | string;
  /** rr-web.event — event counter shared by all chunks of an event */
  ev?: number | string;
  /** Full-precision log timestamp, shared by all chunks of an event */
  ts?: string;
};

export type RRWebAssemblerErrorInfo = {
  reason:
    | 'parse-error'
    | 'incomplete-event'
    | 'duplicate-chunk'
    | 'buffer-overflow';
  eventId?: number;
  timestamp?: string;
  chunksReceived: number;
  totalChunks: number;
};

type PendingEvent = {
  eventId: number;
  timestamp: string;
  totalChunks: number;
  parts: Map<number, string>;
};

/**
 * Max number of chunked events buffered concurrently. With a correctly
 * ordered stream at most one event is pending at a time, plus events whose
 * remaining chunks were lost; the cap only guards against pathological data
 * endlessly growing memory.
 */
const MAX_PENDING_EVENTS = 20;

const toNumber = (value: number | string | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function createRrwebChunkAssembler({
  onEvent,
  onError,
}: {
  /** Called with each fully reassembled, parsed rrweb event */
  onEvent: (event: any) => void;
  /** Called when an event had to be dropped */
  onError: (error: unknown, info: RRWebAssemblerErrorInfo) => void;
}) {
  // Keyed by eventKey; insertion-ordered by first-seen chunk, used for
  // overflow eviction
  const pending = new Map<string, PendingEvent>();

  const parseAndEmit = (
    body: string,
    info: Omit<RRWebAssemblerErrorInfo, 'reason'>,
  ) => {
    try {
      onEvent(JSON.parse(body));
    } catch (error) {
      onError(error, { reason: 'parse-error', ...info });
    }
  };

  const pendingInfo = (entry: PendingEvent) => ({
    eventId: entry.eventId,
    timestamp: entry.timestamp,
    chunksReceived: entry.parts.size,
    totalChunks: entry.totalChunks,
  });

  const dropPending = (
    key: string,
    entry: PendingEvent,
    reason: RRWebAssemblerErrorInfo['reason'],
  ) => {
    pending.delete(key);
    onError(new Error(`rrweb event dropped: ${reason}`), {
      reason,
      ...pendingInfo(entry),
    });
  };

  return {
    push(row: RRWebStreamRow): void {
      const totalChunks = toNumber(row.tcks);
      const chunk = toNumber(row.ck);
      const eventId = toNumber(row.ev);
      const timestamp = row.ts ?? '';

      // Unchunked event — parse directly.
      if (totalChunks <= 1 || chunk === 0) {
        parseAndEmit(row.b, {
          eventId,
          timestamp,
          chunksReceived: 1,
          totalChunks: 1,
        });
        return;
      }

      const key = `${eventId}:${timestamp}`;
      let entry = pending.get(key);
      if (entry != null && entry.parts.has(chunk)) {
        // A chunk index seen twice for one event: a re-sent record, or rows
        // without a timestamp whose counter restarted on page reload. Drop
        // the incomplete event rather than mix bodies.
        dropPending(key, entry, 'duplicate-chunk');
        entry = undefined;
      }
      if (entry == null) {
        entry = { eventId, timestamp, totalChunks, parts: new Map() };
        pending.set(key, entry);
      }
      entry.parts.set(chunk, row.b);

      if (entry.parts.size >= entry.totalChunks) {
        pending.delete(key);
        const body = [...entry.parts.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, part]) => part)
          .join('');
        parseAndEmit(body, pendingInfo(entry));
        return;
      }

      if (pending.size > MAX_PENDING_EVENTS) {
        const oldest = pending.entries().next().value;
        if (oldest != null) {
          const [oldestKey, oldestEntry] = oldest;
          dropPending(oldestKey, oldestEntry, 'buffer-overflow');
        }
      }
    },

    /** Reports any events still incomplete when the stream ends. */
    end(): void {
      for (const entry of pending.values()) {
        onError(new Error('rrweb event dropped: incomplete-event'), {
          reason: 'incomplete-event',
          ...pendingInfo(entry),
        });
      }
      pending.clear();
    },
  };
}
