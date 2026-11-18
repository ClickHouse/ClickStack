import {
  classifyProxyFailure,
  findTrailingException,
  ProxyFacts,
} from '@/utils/proxyOutcome';

const ok: ProxyFacts = {
  clientAborted: false,
  timedOut: false,
  upstreamCut: false,
  upstreamStatus: 200,
  responseStatus: 200,
};

describe('classifyProxyFailure', () => {
  it.each<[string, Partial<ProxyFacts>, string | undefined]>([
    ['a clean 200', {}, undefined],
    ['TIMEOUT_EXCEEDED', { clickhouseErrorCode: 159 }, 'query_timeout'],
    [
      'CANNOT_SCHEDULE_TASK',
      { clickhouseErrorCode: 439 },
      'service_overloaded',
    ],
    [
      'TOO_MANY_SIMULTANEOUS_QUERIES',
      { upstreamStatus: 500, clickhouseErrorCode: 202 },
      'service_overloaded',
    ],
    [
      'UNKNOWN_TABLE',
      { upstreamStatus: 404, clickhouseErrorCode: 60 },
      'query_error',
    ],
    [
      'the proxy timeout',
      {
        timedOut: true,
        upstreamStatus: undefined,
        transportError: { code: 'ECONNRESET' },
      },
      'upstream_timeout',
    ],
    [
      'a refused connection',
      { upstreamStatus: undefined, transportError: { code: 'ECONNREFUSED' } },
      'upstream_unavailable',
    ],
    [
      'a transport error without an errno',
      { upstreamStatus: undefined, transportError: {} },
      'proxy_error',
    ],
    ['a stream cut after a 200', { upstreamCut: true }, 'upstream_unavailable'],
    [
      'a 503 with no ClickHouse code',
      { upstreamStatus: 503 },
      'upstream_unavailable',
    ],
    ['a 504 from the endpoint', { upstreamStatus: 504 }, 'upstream_timeout'],
    ['a 429 from the endpoint', { upstreamStatus: 429 }, 'service_overloaded'],
    ['a 403 with no ClickHouse code', { upstreamStatus: 403 }, 'query_error'],
    [
      'a client abort',
      { clientAborted: true, clickhouseErrorCode: 394 },
      'client_aborted',
    ],
    [
      'a proxy failure before any upstream request',
      { upstreamStatus: undefined, responseStatus: 500 },
      'proxy_error',
    ],
  ])('%s', (_name, facts, expected) => {
    expect(classifyProxyFailure({ ...ok, ...facts })).toBe(expected);
  });
});

describe('findTrailingException', () => {
  const timeout =
    'Code: 159. DB::Exception: Timeout exceeded: elapsed 15.0 seconds, maximum: 15. (TIMEOUT_EXCEEDED) (version 25.3.1.1)';

  it('reads an unmarked exception on the last line', () => {
    const body = Buffer.from(`{"a":1}\n{"a":2}\n${timeout}\n`);
    expect(findTrailingException(body)).toEqual({
      code: 159,
      type: 'TIMEOUT_EXCEEDED',
    });
  });

  it('reads an exception framed by the exception tag', () => {
    const tag = 'abcdefghijklmnop';
    const message = `${timeout}\n`;
    const body = Buffer.from(
      `{"a":1}\r\n__exception__\r\n${tag}\r\n${message}${Buffer.byteLength(message)} ${tag}\r\n__exception__\r\n`,
    );
    expect(findTrailingException(body, tag)?.code).toBe(159);
  });

  it('ignores row data that quotes a ClickHouse error', () => {
    const body = Buffer.from(`{"Body":${JSON.stringify(timeout)}}\n`);
    expect(findTrailingException(body)).toBeUndefined();
  });

  it('ignores an untagged trailer when the response carries a tag', () => {
    const body = Buffer.from(`{"a":1}\n${timeout}\n`);
    expect(findTrailingException(body, 'abcdefghijklmnop')).toBeUndefined();
  });
});
