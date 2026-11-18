import { INVALID_SPAN_CONTEXT, trace } from '@opentelemetry/api';
import http from 'http';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';
import * as instrumentation from '@/utils/instrumentation';

jest.unmock('http-proxy-middleware');

const TIMEOUT_TRAILER =
  'Code: 159. DB::Exception: Timeout exceeded: elapsed 15.0 seconds, maximum: 15. (TIMEOUT_EXCEEDED) (version 25.3.1.1)\n';

// Each scenario is what ClickHouse (or the endpoint in front of it) does for
// the query id in the request.
const scenarios: Record<
  string,
  (req: http.IncomingMessage, res: http.ServerResponse) => void
> = {
  ok: (_req, res) => {
    res.writeHead(200);
    res.end('{"a":1}\n');
  },
  'mid-stream': (_req, res) => {
    res.writeHead(200);
    res.write('{"a":1}\n');
    res.end(TIMEOUT_TRAILER);
  },
  tagged: (_req, res) => {
    const tag = 'abcdefghijklmnop';
    res.writeHead(200, { 'X-ClickHouse-Exception-Tag': tag });
    res.write('{"a":1}\n');
    res.end(
      `\r\n__exception__\r\n${tag}\r\n${TIMEOUT_TRAILER}${Buffer.byteLength(TIMEOUT_TRAILER)} ${tag}\r\n__exception__\r\n`,
    );
  },
  overloaded: (_req, res) => {
    res.writeHead(500, { 'X-ClickHouse-Exception-Code': '202' });
    res.end(
      'Code: 202. DB::Exception: Too many simultaneous queries. (TOO_MANY_SIMULTANEOUS_QUERIES)\n',
    );
  },
  unavailable: (_req, res) => {
    res.writeHead(503);
    res.end('Service is starting up');
  },
  cut: (req, res) => {
    res.writeHead(200);
    res.write('{"a":1}\n', () => req.socket.destroy());
  },
  hang: () => {},
};

const listen = async (server: http.Server) => {
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Expected a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
};

describe('clickhouse-proxy outcome', () => {
  const server = getServer();
  let upstream: http.Server;
  let upstreamUrl: string;
  let recordSpy: jest.SpyInstance;
  let setAttributes: jest.SpyInstance;

  beforeAll(async () => {
    await server.start();
    upstream = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get(
          'query_id',
        );
        scenarios[id ?? 'ok'](req, res);
      });
    });
    upstreamUrl = await listen(upstream);
  });

  beforeEach(() => {
    recordSpy = jest.spyOn(instrumentation, 'recordOperationOutcome');
    const span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
    setAttributes = jest.spyOn(span, 'setAttributes');
    jest.spyOn(instrumentation, 'getServerSpan').mockReturnValue(span);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server.clearDBs();
  });

  afterAll(async () => {
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    await server.stop();
  });

  // Returns a request builder, not a request: awaiting a supertest request
  // would send it before the caller could add assertions.
  const connect = async (host = upstreamUrl) => {
    const { agent, team } = await getLoggedInAgent(server);
    const connection = await Connection.create({
      team: team._id,
      name: 'Scripted upstream',
      host,
      username: 'default',
      password: '',
    });
    return (queryId: string) =>
      agent
        .post(`/clickhouse-proxy/?query_id=${queryId}`)
        .set('x-hyperdx-connection-id', connection._id.toString())
        .set('Content-Type', 'text/plain')
        .send('SELECT 1');
  };

  const proxyOutcome = async () => {
    const find = () =>
      recordSpy.mock.calls
        .map(([args]) => args)
        .find(args => args.operation === 'clickhouse_proxy.query');
    for (let i = 0; i < 50 && !find(); i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return find();
  };

  it('leaves a clean response uncategorised', async () => {
    const send = await connect();
    await send('ok').expect(200);
    expect(await proxyOutcome()).toMatchObject({
      outcome: 'success',
      attributes: undefined,
    });
  });

  it('categorises an exception written after a 200', async () => {
    const send = await connect();
    const res = await send('mid-stream')
      .buffer(true)
      .parse((r, cb) => {
        let text = '';
        r.on('data', (chunk: Buffer) => (text += chunk));
        r.on('end', () => cb(null, text));
      });
    expect(res.status).toBe(200);
    expect(res.body).toBe(`{"a":1}\n${TIMEOUT_TRAILER}`);
    expect(await proxyOutcome()).toMatchObject({
      outcome: 'success',
      attributes: { error_category: 'query_timeout' },
    });
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'hyperdx.clickhouse_proxy.clickhouse.error_code': 159,
        'hyperdx.clickhouse_proxy.clickhouse.error_type': 'TIMEOUT_EXCEEDED',
        'hyperdx.clickhouse_proxy.error.message': undefined,
        'hyperdx.clickhouse_proxy.upstream.status_code': 200,
      }),
    );
  });

  it('categorises a tagged exception written after a 200', async () => {
    const send = await connect();
    await send('tagged').expect(200);
    expect(await proxyOutcome()).toMatchObject({
      attributes: { error_category: 'query_timeout' },
    });
  });

  it('reads the ClickHouse error code header', async () => {
    const send = await connect();
    await send('overloaded').expect(500);
    expect(await proxyOutcome()).toMatchObject({
      outcome: 'error',
      attributes: { error_category: 'service_overloaded' },
    });
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'hyperdx.clickhouse_proxy.clickhouse.error_type':
          'TOO_MANY_SIMULTANEOUS_QUERIES',
        'hyperdx.clickhouse_proxy.error.message': undefined,
      }),
    );
  });

  it('records the body of an upstream 5xx', async () => {
    const send = await connect();
    await send('unavailable').expect(503);
    expect(await proxyOutcome()).toMatchObject({
      outcome: 'error',
      attributes: { error_category: 'upstream_unavailable' },
    });
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'hyperdx.clickhouse_proxy.error.message': 'Service is starting up',
      }),
    );
  });

  it('categorises a stream the upstream cut off', async () => {
    const send = await connect();
    await expect(send('cut')).rejects.toThrow();
    expect(await proxyOutcome()).toMatchObject({
      attributes: { error_category: 'upstream_unavailable' },
    });
  });

  it('categorises a refused connection', async () => {
    const closed = http.createServer();
    const closedUrl = await listen(closed);
    await new Promise<void>(resolve => closed.close(() => resolve()));

    const send = await connect(closedUrl);
    await send('ok').expect(500);
    expect(await proxyOutcome()).toMatchObject({
      outcome: 'error',
      attributes: { error_category: 'upstream_unavailable' },
    });
  });

  it('categorises a request the client abandoned', async () => {
    const send = await connect();
    const request = send('hang');
    void request.then(
      () => {},
      () => {},
    );
    // Close the socket the way a browser does when a search is re-run.
    await new Promise(resolve => setTimeout(resolve, 100));
    // superagent's abort() leaves the agent's socket open.
    if ('req' in request && request.req instanceof http.ClientRequest) {
      request.req.destroy();
    }
    for (let i = 0; i < 50 && !setAttributes.mock.calls.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'hyperdx.clickhouse_proxy.error.category': 'client_aborted',
      }),
    );
    // Nothing was answered, so the SLI has nothing to count.
    expect(await proxyOutcome()).toBeUndefined();
  });
});
