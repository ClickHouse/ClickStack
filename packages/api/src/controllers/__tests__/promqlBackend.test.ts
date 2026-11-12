import type { PromqlSourceBackend } from '@hyperdx/common-utils/dist/types';

import {
  clearBackendProbeCache,
  resolveClickhouseQueryBackend,
} from '@/controllers/promql';
import { connectionSupportsPrometheusHttpApi } from '@/controllers/timeseriesEngine';

jest.mock('@/controllers/timeseriesEngine', () => ({
  ...jest.requireActual('@/controllers/timeseriesEngine'),
  connectionSupportsPrometheusHttpApi: jest.fn(),
}));

const mockFetch = jest.mocked(global.fetch);
const mockVersionCheck = jest.mocked(connectionSupportsPrometheusHttpApi);

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
    mockVersionCheck.mockResolvedValue(true);
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
      mockVersionCheck.mockResolvedValue(false);

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
