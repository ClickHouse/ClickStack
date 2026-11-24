import {
  buildSloLatencyGoodSql,
  getSloDefaultDuration,
} from '@/core/sloLatency';
import { SloInputSchema } from '@/slo';
import { SourceKind, TSource } from '@/types';

const traceSource = {
  id: 'source-1',
  kind: SourceKind.Trace,
  name: 'Traces',
  connection: 'conn-1',
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, ServiceName',
  durationExpression: 'Duration',
  durationPrecision: 9,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  statusCodeExpression: 'StatusCode',
  serviceNameExpression: 'ServiceName',
} as unknown as TSource;

const availability = {
  indicator: {
    template: 'availability',
    eligible: {
      where: "SpanKind = 'Server'",
      whereLanguage: 'sql',
      filters: [{ type: 'sql', condition: "ServiceName IN ('checkout')" }],
    },
    good: "StatusCode != 'Error'",
  },
};

describe('SLO schema', () => {
  const base = {
    name: 'Checkout availability',
    source: 'source-1',
    target: 99.9,
    window: '30d' as const,
  };

  it('requires a good condition unless the template is latency', () => {
    expect(
      SloInputSchema.safeParse({
        ...base,
        indicator: {
          template: 'availability',
          eligible: { where: '', whereLanguage: 'sql' },
        },
      }).success,
    ).toBe(false);
    expect(SloInputSchema.safeParse({ ...base, ...availability }).success).toBe(
      true,
    );
  });

  it('derives latency thresholds in the source unit', () => {
    expect(
      buildSloLatencyGoodSql({
        expression: 'Duration',
        unit: 'ns',
        thresholdMs: 250,
        numeric: true,
        requireDuration: true,
      }),
    ).toBe('(Duration) <= 250000000');
    expect(getSloDefaultDuration(traceSource)).toEqual({
      expression: 'Duration',
      unit: 'ns',
      numeric: true,
    });
  });
});
