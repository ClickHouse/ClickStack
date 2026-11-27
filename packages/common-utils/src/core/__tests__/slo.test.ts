import {
  buildSloLatencyGoodSql,
  getSloDefaultDuration,
} from '@/core/sloLatency';
import {
  describeSloAlertRule,
  describeSloAlertRuleDetails,
  SloInputSchema,
} from '@/slo';
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

  it('requires distinct channels for each alert that is on', () => {
    const withChannels = (rule: 'fastBurn' | 'slowBurn', ids: string[]) =>
      SloInputSchema.safeParse({
        ...base,
        ...availability,
        alerts: {
          [rule]: {
            channels: ids.map(webhookId => ({ type: 'webhook', webhookId })),
          },
        },
      }).success;
    for (const rule of ['fastBurn', 'slowBurn'] as const) {
      expect(withChannels(rule, [])).toBe(false);
      expect(withChannels(rule, [''])).toBe(false);
      expect(withChannels(rule, ['a', 'a'])).toBe(false);
      expect(withChannels(rule, ['a', 'b'])).toBe(true);
    }
    // No alerts at all.
    expect(SloInputSchema.parse({ ...base, ...availability }).alerts).toEqual(
      {},
    );
  });

  it('describes each burn alert in one sentence', () => {
    expect(describeSloAlertRule('fastBurn', '30d')).toBe(
      '2% of the 30-day error budget is spent within 1 hour (14.4x the allowed rate)',
    );
    // The same share of a shorter window's budget is a slower burn.
    expect(describeSloAlertRule('slowBurn', '7d')).toBe(
      '5% of the 7-day error budget is spent within 6 hours (1.4x the allowed rate)',
    );
    expect(describeSloAlertRule('slowBurn')).toBe(
      '5% of the error budget is spent within 6 hours',
    );
    expect(describeSloAlertRuleDetails('fastBurn')).toBe(
      'Resolves once the last 5 minutes burn slower than that. Needs at ' +
        'least 20 events in 1 hour. Checked every 5 minutes.',
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
