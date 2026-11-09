import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';

import {
  aggregateServiceMapData,
  getServiceMapQuery,
  serviceMapErrorCountSql,
  serviceMapNodeKey,
  SpanAggregationRow,
} from '@/hooks/useServiceMap';

// The two CTEs are rendered by renderChartConfig; the shape of the outer join
// and grouping query is what these tests pin down.
jest.mock('@hyperdx/common-utils/dist/core/renderChartConfig', () => ({
  renderChartConfig: jest.fn(),
}));

describe('serviceMapErrorCountSql', () => {
  it('counts short and legacy error statuses, not only Error', () => {
    expect(serviceMapErrorCountSql()).toBe(
      "countIf(lower(ServerSpans.statusCode) IN ('error', 'status_code_error'))",
    );
  });
});

// Convenience builders for the GROUPING SETS row shapes.
function nodeRow(
  serverServiceName: string,
  requestCount: number,
  errorCount: number,
  latency?: { p50: number; p95: number; p99: number },
): SpanAggregationRow {
  return {
    serverServiceName,
    serverDimensions: [],
    isNodeLevel: true,
    requestCount,
    errorCount,
    ...latency,
  };
}

function edgeRow(
  serverServiceName: string,
  clientServiceName: string | undefined,
  requestCount: number,
  errorCount: number,
  latency?: { p50: number; p95: number; p99: number },
): SpanAggregationRow {
  return {
    serverServiceName,
    serverDimensions: [],
    clientServiceName,
    isNodeLevel: false,
    requestCount,
    errorCount,
    ...latency,
  };
}

describe('aggregateServiceMapData', () => {
  describe('basic aggregation', () => {
    it('returns an empty map for empty input', () => {
      expect(aggregateServiceMapData([]).size).toBe(0);
    });

    it('builds a service from a node-level row', () => {
      const result = aggregateServiceMapData([nodeRow('api-service', 100, 0)]);

      expect(result.size).toBe(1);
      const service = result.get('api-service')!;
      expect(service.serviceName).toBe('api-service');
      expect(service.incomingRequests.totalRequests).toBe(100);
      expect(service.incomingRequests.errorCount).toBe(0);
      expect(service.incomingRequests.errorPercentage).toBe(0);
      expect(service.incomingRequestsByClient.size).toBe(0);
    });

    it('uses the node-level row as the rolled-up total (no client summing)', () => {
      // Node-level totals come straight from the rolled-up row, independent of
      // the per-edge rows.
      const result = aggregateServiceMapData([
        nodeRow('api-service', 150, 15),
        edgeRow('api-service', 'web', 100, 10),
        edgeRow('api-service', 'worker', 50, 5),
      ]);

      const service = result.get('api-service')!;
      expect(service.incomingRequests.totalRequests).toBe(150);
      expect(service.incomingRequests.errorCount).toBe(15);
      expect(service.incomingRequestsByClient.size).toBe(2);
    });
  });

  describe('error percentage', () => {
    it('computes errorPercentage from errorCount / totalRequests', () => {
      const result = aggregateServiceMapData([nodeRow('api-service', 100, 10)]);
      expect(result.get('api-service')!.incomingRequests.errorPercentage).toBe(
        10,
      );
    });

    it('is 100 when all requests error', () => {
      const result = aggregateServiceMapData([nodeRow('api-service', 30, 30)]);
      expect(result.get('api-service')!.incomingRequests.errorPercentage).toBe(
        100,
      );
    });

    it('avoids division by zero for zero-request services', () => {
      // A client-only node, created from an edge row, has no incoming requests.
      const result = aggregateServiceMapData([
        edgeRow('api-service', 'web', 100, 0),
      ]);
      const web = result.get('web')!;
      expect(web.incomingRequests.totalRequests).toBe(0);
      expect(web.incomingRequests.errorPercentage).toBe(0);
    });
  });

  describe('edges (per-client stats)', () => {
    it('records per-client stats and creates the client node', () => {
      const result = aggregateServiceMapData([
        nodeRow('api-service', 100, 0),
        edgeRow('api-service', 'web-service', 100, 0),
      ]);

      expect(result.size).toBe(2);
      expect(result.has('web-service')).toBe(true);

      const service = result.get('api-service')!;
      const fromWeb = service.incomingRequestsByClient.get('web-service')!;
      expect(fromWeb.totalRequests).toBe(100);
    });

    it('supports multiple clients calling the same service', () => {
      const result = aggregateServiceMapData([
        nodeRow('api-service', 150, 0),
        edgeRow('api-service', 'web', 100, 0),
        edgeRow('api-service', 'mobile', 50, 5),
      ]);

      const service = result.get('api-service')!;
      expect(service.incomingRequestsByClient.size).toBe(2);
      expect(
        service.incomingRequestsByClient.get('mobile')!.errorPercentage,
      ).toBe(10);
    });

    it('ignores edge rows from uninstrumented (null) clients', () => {
      // These are already counted in the node-level total; no edge is drawn.
      const result = aggregateServiceMapData([
        nodeRow('api-service', 100, 0),
        edgeRow('api-service', undefined, 40, 0),
      ]);

      const service = result.get('api-service')!;
      expect(service.incomingRequestsByClient.size).toBe(0);
      expect(result.size).toBe(1);
    });

    it('builds a chain A -> B -> C', () => {
      const result = aggregateServiceMapData([
        nodeRow('B', 100, 0),
        edgeRow('B', 'A', 100, 0),
        nodeRow('C', 80, 0),
        edgeRow('C', 'B', 80, 0),
      ]);

      expect(new Set(result.keys())).toEqual(new Set(['A', 'B', 'C']));
      expect(result.get('B')!.incomingRequestsByClient.has('A')).toBe(true);
      expect(result.get('C')!.incomingRequestsByClient.has('B')).toBe(true);
      // A is a leaf client with no incoming traffic.
      expect(result.get('A')!.incomingRequests.totalRequests).toBe(0);
    });
  });

  describe('outgoing throughput', () => {
    it('rolls edge volume up to the caller as outgoingRequests', () => {
      const result = aggregateServiceMapData([
        nodeRow('api', 100, 0),
        edgeRow('api', 'web', 100, 0),
      ]);

      // web calls api 100x -> web has 100 outgoing, 0 incoming.
      expect(result.get('web')!.outgoingRequests).toBe(100);
      expect(result.get('web')!.incomingRequests.totalRequests).toBe(0);
      // api receives but makes no calls of its own here.
      expect(result.get('api')!.outgoingRequests).toBe(0);
    });

    it('sums outgoing across multiple callees', () => {
      const result = aggregateServiceMapData([
        nodeRow('api', 100, 0),
        edgeRow('api', 'gateway', 100, 0),
        nodeRow('db', 60, 0),
        edgeRow('db', 'gateway', 60, 0),
      ]);

      // gateway calls api (100) and db (60) -> 160 outgoing.
      expect(result.get('gateway')!.outgoingRequests).toBe(160);
    });

    it('accumulates both incoming and outgoing for a mid-chain service', () => {
      // A -> B -> C : B receives 100 and makes 80.
      const result = aggregateServiceMapData([
        nodeRow('B', 100, 0),
        edgeRow('B', 'A', 100, 0),
        nodeRow('C', 80, 0),
        edgeRow('C', 'B', 80, 0),
      ]);

      expect(result.get('B')!.incomingRequests.totalRequests).toBe(100);
      expect(result.get('B')!.outgoingRequests).toBe(80);
      expect(result.get('A')!.outgoingRequests).toBe(100);
      expect(result.get('C')!.outgoingRequests).toBe(0);
    });
  });

  describe('latency percentiles', () => {
    it('passes through percentiles and flags hasLatency', () => {
      const result = aggregateServiceMapData([
        nodeRow('api-service', 100, 0, { p50: 5, p95: 20, p99: 50 }),
      ]);

      const stats = result.get('api-service')!.incomingRequests;
      expect(stats.p50).toBe(5);
      expect(stats.p95).toBe(20);
      expect(stats.p99).toBe(50);
      expect(stats.hasLatency).toBe(true);
    });

    it('marks hasLatency false and zeroes percentiles when absent', () => {
      const stats = aggregateServiceMapData([
        nodeRow('api-service', 100, 0),
      ]).get('api-service')!.incomingRequests;
      expect(stats.hasLatency).toBe(false);
      expect(stats.p50).toBe(0);
      expect(stats.p95).toBe(0);
      expect(stats.p99).toBe(0);
    });

    it('flags hasLatency from p50 even when p95/p99 are absent', () => {
      // statsFromRow keys hasLatency off p50; missing p95/p99 default to 0.
      const result = aggregateServiceMapData([
        {
          serverServiceName: 'api',
          serverDimensions: [],
          isNodeLevel: true,
          requestCount: 10,
          errorCount: 0,
          p50: 5,
        },
      ]);
      const stats = result.get('api')!.incomingRequests;
      expect(stats.hasLatency).toBe(true);
      expect(stats.p50).toBe(5);
      expect(stats.p95).toBe(0);
      expect(stats.p99).toBe(0);
    });

    it('records per-edge percentiles independently of the node', () => {
      const result = aggregateServiceMapData([
        nodeRow('api-service', 100, 0, { p50: 5, p95: 20, p99: 50 }),
        edgeRow('api-service', 'web', 100, 0, { p50: 8, p95: 30, p99: 60 }),
      ]);

      const fromWeb = result
        .get('api-service')!
        .incomingRequestsByClient.get('web')!;
      expect(fromWeb.p95).toBe(30);
      expect(fromWeb.hasLatency).toBe(true);
    });
  });

  describe('extra group-by dimensions', () => {
    // Rows as the query returns them when grouped by one extra expression.
    function dimNodeRow(
      serverServiceName: string,
      serverDimensions: string[],
      requestCount: number,
    ): SpanAggregationRow {
      return {
        serverServiceName,
        serverDimensions,
        isNodeLevel: true,
        requestCount,
        errorCount: 0,
      };
    }

    function dimEdgeRow(
      serverServiceName: string,
      serverDimensions: string[],
      clientServiceName: string,
      clientDimensions: string[],
      requestCount: number,
    ): SpanAggregationRow {
      return {
        serverServiceName,
        serverDimensions,
        clientServiceName,
        clientDimensions,
        isNodeLevel: false,
        requestCount,
        errorCount: 0,
      };
    }

    it('keys nodes by the (serviceName, ...dimensions) tuple', () => {
      const result = aggregateServiceMapData([
        dimNodeRow('api', ['api-pod-0'], 60),
        dimNodeRow('api', ['api-pod-1'], 40),
      ]);

      const pod0 = serviceMapNodeKey('api', ['api-pod-0']);
      const pod1 = serviceMapNodeKey('api', ['api-pod-1']);
      expect(new Set(result.keys())).toEqual(new Set([pod0, pod1]));
      expect(result.get(pod0)).toMatchObject({
        key: pod0,
        serviceName: 'api',
        dimensions: ['api-pod-0'],
      });
      expect(result.get(pod0)!.incomingRequests.totalRequests).toBe(60);
      expect(result.get(pod1)!.incomingRequests.totalRequests).toBe(40);
    });

    it('draws an edge between two pods of the same service', () => {
      const result = aggregateServiceMapData([
        dimNodeRow('api', ['api-pod-1'], 10),
        dimEdgeRow('api', ['api-pod-1'], 'api', ['api-pod-0'], 10),
      ]);

      const pod0 = serviceMapNodeKey('api', ['api-pod-0']);
      const pod1 = serviceMapNodeKey('api', ['api-pod-1']);
      expect(result.size).toBe(2);
      expect(
        result.get(pod1)!.incomingRequestsByClient.get(pod0),
      ).toMatchObject({ totalRequests: 10 });
      expect(result.get(pod0)!.outgoingRequests).toBe(10);
    });

    it('keys edges by the client tuple, so clients with different dimensions stay distinct', () => {
      const result = aggregateServiceMapData([
        dimNodeRow('api', ['api-pod-0'], 30),
        dimEdgeRow('api', ['api-pod-0'], 'web', ['web-pod-0'], 10),
        dimEdgeRow('api', ['api-pod-0'], 'web', ['web-pod-1'], 20),
      ]);

      const api = result.get(serviceMapNodeKey('api', ['api-pod-0']))!;
      expect(api.incomingRequestsByClient.size).toBe(2);
      expect(
        result.get(serviceMapNodeKey('web', ['web-pod-1']))!.outgoingRequests,
      ).toBe(20);
    });

    it('treats an empty dimension value as its own node', () => {
      const result = aggregateServiceMapData([
        dimNodeRow('api', [''], 5),
        dimNodeRow('api', ['api-pod-0'], 7),
      ]);

      const none = result.get(serviceMapNodeKey('api', ['']))!;
      expect(none.dimensions).toEqual(['']);
      expect(none.incomingRequests.totalRequests).toBe(5);
      expect(result.size).toBe(2);
    });

    it('keys by service name alone when there are no dimensions', () => {
      expect(serviceMapNodeKey('api', [])).toBe('api');
      const result = aggregateServiceMapData([
        nodeRow('api', 1, 0),
        edgeRow('api', 'web', 1, 0),
      ]);
      expect(result.get('api')).toMatchObject({
        key: 'api',
        dimensions: [],
      });
      expect(result.get('api')!.incomingRequestsByClient.has('web')).toBe(true);
    });
  });

  describe('data structure integrity', () => {
    it('does not mutate the input rows', () => {
      const data: SpanAggregationRow[] = [
        nodeRow('api-service', 100, 10, { p50: 1, p95: 2, p99: 3 }),
        edgeRow('api-service', 'web', 100, 10),
      ];
      const original = JSON.parse(JSON.stringify(data));
      aggregateServiceMapData(data);
      expect(data).toEqual(original);
    });
  });
});

describe('getServiceMapQuery', () => {
  const source: TTraceSource = {
    id: 'src',
    name: 'Traces',
    kind: SourceKind.Trace,
    connection: 'conn',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp',
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    serviceNameExpression: 'ServiceName',
    spanKindExpression: 'SpanKind',
    statusCodeExpression: 'StatusCode',
    durationExpression: 'Duration',
    durationPrecision: 9,
  } as TTraceSource;

  const dateRange: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
  ];

  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

  async function render(groupBy?: string[]) {
    jest
      .mocked(renderChartConfig)
      .mockResolvedValueOnce({ sql: 'SERVER_CTE', params: {} })
      .mockResolvedValueOnce({ sql: 'CLIENT_CTE', params: {} });
    const query = await getServiceMapQuery({
      source,
      dateRange,
      metadata: {} as any,
      samplingFactor: 1,
      groupBy,
    });
    return normalize(query.sql);
  }

  beforeEach(() => {
    jest.mocked(renderChartConfig).mockReset();
  });

  it('groups by service name only when no dimensions are given', async () => {
    const sql = await render([]);

    expect(sql).toContain(
      'WHERE (ClientSpans.serviceName IS NULL OR tuple(ServerSpans.serviceName) != tuple(ClientSpans.serviceName))',
    );
    expect(sql).toContain(
      'GROUP BY GROUPING SETS ( (ServerSpans.serviceName, ClientSpans.serviceName), (ServerSpans.serviceName) )',
    );
    expect(sql).toContain(
      'SELECT ServerSpans.serviceName AS server_serviceName, ClientSpans.serviceName AS client_serviceName, GROUPING(ClientSpans.serviceName) AS isNodeLevel',
    );
    expect(sql).toContain(
      'ORDER BY server_serviceName, isNodeLevel, client_serviceName',
    );
    expect(sql).not.toContain('dim0');

    const [serverConfig] = jest.mocked(renderChartConfig).mock.calls[0];
    expect(serverConfig).not.toMatchObject({
      select: expect.arrayContaining([
        expect.objectContaining({ alias: 'dim0' }),
      ]),
    });
  });

  it('selects each dimension as toString(expr) and keys both sides of the join by it', async () => {
    const sql = await render([
      "ResourceAttributes['k8s.pod.name']",
      "SpanAttributes['http.route']",
    ]);

    expect(jest.mocked(renderChartConfig).mock.calls).toHaveLength(2);
    for (const [config] of jest.mocked(renderChartConfig).mock.calls) {
      expect(config).toMatchObject({
        select: expect.arrayContaining([
          {
            valueExpression: "toString(ResourceAttributes['k8s.pod.name'])",
            alias: 'dim0',
          },
          {
            valueExpression: "toString(SpanAttributes['http.route'])",
            alias: 'dim1',
          },
        ]),
      });
    }

    expect(sql).toContain(
      'SELECT ServerSpans.serviceName AS server_serviceName, ClientSpans.serviceName AS client_serviceName, ServerSpans.dim0 AS server_dim0, ClientSpans.dim0 AS client_dim0, ServerSpans.dim1 AS server_dim1, ClientSpans.dim1 AS client_dim1, GROUPING(ClientSpans.serviceName) AS isNodeLevel',
    );
    expect(sql).toContain(
      'tuple(ServerSpans.serviceName, ServerSpans.dim0, ServerSpans.dim1) != tuple(ClientSpans.serviceName, ClientSpans.dim0, ClientSpans.dim1)',
    );
    expect(sql).toContain(
      'GROUP BY GROUPING SETS ( (ServerSpans.serviceName, ServerSpans.dim0, ServerSpans.dim1, ClientSpans.serviceName, ClientSpans.dim0, ClientSpans.dim1), (ServerSpans.serviceName, ServerSpans.dim0, ServerSpans.dim1) )',
    );
    expect(sql).toContain(
      'ORDER BY server_serviceName, server_dim0, server_dim1, isNodeLevel, client_serviceName, client_dim0, client_dim1',
    );
  });
});
