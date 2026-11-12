import type { PromqlSourceBackend } from '@hyperdx/common-utils/dist/types';

import {
  clearBackendProbeCache,
  resolveClickhouseLabelBackend,
  resolveClickhouseQueryBackend,
} from '@/controllers/promql';
import { connectionPrometheusHttpApiSupport } from '@/controllers/timeseriesEngine';

jest.mock('@/controllers/timeseriesEngine', () => ({
  ...jest.requireActual('@/controllers/timeseriesEngine'),
  connectionPrometheusHttpApiSupport: jest.fn(),
}));

const mockFetch = jest.mocked(global.fetch);
const mockVersionCheck = jest.mocked(connectionPrometheusHttpApiSupport);

// What the version check answers for a server on each side of the 26.6 (query)
// and 26.9 (label lookup) cut-offs.
const CLICKHOUSE_26_10 = { query: true, labels: true };
const CLICKHOUSE_26_8 = { query: true, labels: false };
const CLICKHOUSE_26_5 = { query: false, labels: false };

const handlerAnswer = () =>
  new Response(JSON.stringify({ status: 'success', data: 'up' }));
const noHandlerAnswer = () =>
  new Response('There is no handle /prometheus/api/v1/format_query', {
    status: 404,
  });

const target = (
  host = 'http://ch:8123',
  promqlBackend?: PromqlSourceBackend,
) => ({
  connection: { id: 'conn-1', host, username: 'default', password: '' },
  databaseName: 'db',
  tableName: 'ts',
  promqlBackend,
});

const resolveKind = async (
  host?: string,
  promqlBackend?: PromqlSourceBackend,
) => {
  const backend = await resolveClickhouseQueryBackend(
    // @ts-expect-error mock connection carries only the fields the resolver reads
    target(host, promqlBackend),
  );
  return backend.kind;
};

describe('resolveClickhouseQueryBackend', () => {
  beforeEach(() => {
    clearBackendProbeCache();
    mockVersionCheck.mockReset();
    mockVersionCheck.mockResolvedValue(CLICKHOUSE_26_10);
    mockFetch.mockReset();
  });

  describe('probe cache', () => {
    it('probes the handler once and keeps the answer', async () => {
      mockFetch.mockResolvedValueOnce(handlerAnswer());

      await expect(resolveKind()).resolves.toBe('clickhouse-http');
      await expect(resolveKind()).resolves.toBe('clickhouse-http');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain(
        '/prometheus/api/v1/format_query',
      );
      expect(mockVersionCheck).toHaveBeenCalledTimes(1);
    });

    it('keeps "no handler" so a stock server is not probed on every query', async () => {
      mockFetch.mockResolvedValueOnce(noHandlerAnswer());

      await expect(resolveKind()).resolves.toBe('table-function');
      await expect(resolveKind()).resolves.toBe('table-function');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('keeps a server that is too old without probing the handler', async () => {
      mockVersionCheck.mockResolvedValue(CLICKHOUSE_26_5);

      await expect(resolveKind()).resolves.toBe('table-function');
      await expect(resolveKind()).resolves.toBe('table-function');

      expect(mockVersionCheck).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not keep an unreadable server version', async () => {
      mockVersionCheck.mockResolvedValueOnce(undefined);
      mockFetch.mockResolvedValueOnce(handlerAnswer());

      await expect(resolveKind()).resolves.toBe('table-function');
      await expect(resolveKind()).resolves.toBe('clickhouse-http');

      expect(mockVersionCheck).toHaveBeenCalledTimes(2);
    });

    it('does not keep a probe that failed to reach the server', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockFetch.mockResolvedValueOnce(handlerAnswer());

      await expect(resolveKind()).resolves.toBe('table-function');
      await expect(resolveKind()).resolves.toBe('clickhouse-http');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does not keep an answer that says nothing about the handler, like a proxy's 502", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('<html>Bad gateway</html>', { status: 502 }),
      );
      mockFetch.mockResolvedValueOnce(handlerAnswer());

      await expect(resolveKind()).resolves.toBe('table-function');
      await expect(resolveKind()).resolves.toBe('clickhouse-http');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('probes again once the answer has expired', async () => {
      const now = jest.spyOn(Date, 'now');
      try {
        mockFetch.mockImplementation(async () => handlerAnswer());

        now.mockReturnValue(1_000);
        await resolveKind();
        now.mockReturnValue(1_000 + 5 * 60_000 - 1);
        await resolveKind();
        expect(mockFetch).toHaveBeenCalledTimes(1);

        now.mockReturnValue(1_000 + 5 * 60_000);
        await resolveKind();
        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        now.mockRestore();
      }
    });

    it('keeps a separate answer for each host of the same connection', async () => {
      mockFetch.mockResolvedValueOnce(noHandlerAnswer());
      mockFetch.mockResolvedValueOnce(handlerAnswer());

      await expect(resolveKind('http://old:8123')).resolves.toBe(
        'table-function',
      );
      await expect(resolveKind('http://new:8123')).resolves.toBe(
        'clickhouse-http',
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('shares one probe between concurrent queries', async () => {
      mockFetch.mockResolvedValueOnce(handlerAnswer());

      await expect(
        Promise.all([resolveKind(), resolveKind()]),
      ).resolves.toEqual(['clickhouse-http', 'clickhouse-http']);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('source setting', () => {
    it.each([
      ['clickhouse-http', 'clickhouse-http'],
      ['table-function', 'table-function'],
    ] as const)(
      'takes %s at its word, without a version check or probe',
      async (setting, kind) => {
        await expect(resolveKind(undefined, setting)).resolves.toBe(kind);

        expect(mockVersionCheck).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
      },
    );

    it.each([[undefined], ['auto' as const]])(
      'probes when the setting is %s',
      async setting => {
        mockFetch.mockResolvedValueOnce(handlerAnswer());

        await expect(resolveKind(undefined, setting)).resolves.toBe(
          'clickhouse-http',
        );

        expect(mockFetch).toHaveBeenCalledTimes(1);
      },
    );

    it('ignores a kept probe answer once the source names a backend', async () => {
      mockFetch.mockResolvedValueOnce(handlerAnswer());
      await resolveKind();

      await expect(resolveKind(undefined, 'table-function')).resolves.toBe(
        'table-function',
      );
    });
  });
});

describe('resolveClickhouseLabelBackend', () => {
  const resolveLabels = (promqlBackend?: PromqlSourceBackend) =>
    resolveClickhouseLabelBackend(
      // @ts-expect-error mock connection carries only the fields the resolver reads
      target(undefined, promqlBackend),
    );

  beforeEach(() => {
    clearBackendProbeCache();
    mockVersionCheck.mockReset();
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => handlerAnswer());
  });

  it.each([[undefined], ['auto' as const], ['clickhouse-http' as const]])(
    'uses the HTTP API on 26.9+ with the handler when the setting is %s',
    async setting => {
      mockVersionCheck.mockResolvedValue(CLICKHOUSE_26_10);

      await expect(resolveLabels(setting)).resolves.toBe('clickhouse-http');
    },
  );

  // 26.6-26.8 answers queries over HTTP but not label lookups, so a source on
  // the HTTP API must not lose its labels there.
  it.each([[undefined], ['clickhouse-http' as const]])(
    'reads labels with SQL on 26.8 even though queries use the HTTP API (setting %s)',
    async setting => {
      mockVersionCheck.mockResolvedValue(CLICKHOUSE_26_8);

      await expect(resolveLabels(setting)).resolves.toBe('sql');
      await expect(resolveKind(undefined, setting)).resolves.toBe(
        'clickhouse-http',
      );
    },
  );

  it('reads labels with SQL when the server has no handler', async () => {
    mockVersionCheck.mockResolvedValue(CLICKHOUSE_26_10);
    mockFetch.mockImplementation(async () => noHandlerAnswer());

    await expect(resolveLabels()).resolves.toBe('sql');
  });

  it('reads labels with SQL for a table-function source, without a probe', async () => {
    await expect(resolveLabels('table-function')).resolves.toBe('sql');

    expect(mockVersionCheck).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shares the kept probe answer with queries', async () => {
    mockVersionCheck.mockResolvedValue(CLICKHOUSE_26_10);

    await resolveKind();
    await expect(resolveLabels()).resolves.toBe('clickhouse-http');

    expect(mockVersionCheck).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
