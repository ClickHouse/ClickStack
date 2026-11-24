import type { FieldErrors } from 'react-hook-form';
import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import { SourceKind, type TSource } from '@hyperdx/common-utils/dist/types';

import {
  DEFAULT_SLO_FORM_VALUES,
  sloFormResolver,
  type SloFormValues,
  sloToFormValues,
  toSloInput,
} from '@/components/Slos/sloForm';

const traceSource: TSource = {
  id: 'source-1',
  kind: SourceKind.Trace,
  name: 'Traces',
  connection: 'connection-1',
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
};

const valid: SloFormValues = {
  ...DEFAULT_SLO_FORM_VALUES,
  name: 'Checkout availability',
  source: 'source-1',
  indicator: {
    ...DEFAULT_SLO_FORM_VALUES.indicator,
    good: "StatusCode != 'Error'",
  },
};

const latency = (expression: string): SloFormValues => ({
  ...valid,
  indicator: {
    ...valid.indicator,
    template: 'latency',
    good: '',
    latency: { ...valid.indicator.latency, expression },
  },
});

const savedSlo: SloApiResponse = {
  version: 1,
  name: 'Checkout availability',
  source: 'source-1',
  indicator: {
    template: 'availability',
    eligible: {
      where: "SpanKind = 'Server'",
      whereLanguage: 'sql',
      filters: [{ type: 'sql', condition: "ServiceName = 'checkout'" }],
    },
    good: "StatusCode != 'Error'",
  },
  target: 99.5,
  window: '7d',
  groupBy: 'ServiceName',
  tags: ['checkout'],
  description: 'Checkout requests that do not fail',
  alerts: {
    fastBurn: { channels: [{ type: 'webhook', webhookId: 'hook-1' }] },
  },
  alertStates: {},
  id: 'slo-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const resolve = (values: SloFormValues) =>
  sloFormResolver(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });

const errorsOf = async (
  values: SloFormValues,
): Promise<FieldErrors<SloFormValues>> => (await resolve(values)).errors;

describe('SLO form', () => {
  it('submits a valid definition as the form holds it', async () => {
    const result = await resolve(valid);
    expect(result.errors).toEqual({});
    expect(result.values).toBe(valid);
  });

  it('puts schema errors on the fields they belong to', async () => {
    const errors = await errorsOf({
      ...valid,
      name: ' ',
      target: 100,
      indicator: { ...valid.indicator, good: '' },
    });
    expect(errors.name?.message).toBe('Name is required');
    expect(errors.target?.message).toBe('Target must be below 100%');
    expect(errors.indicator?.good?.message).toBe(
      'A good-event condition is required',
    );
  });

  it('validates only what the template uses', async () => {
    // The good condition is ignored for latency, the duration is not.
    const errors = await errorsOf(latency(''));
    expect(errors.indicator?.good).toBeUndefined();
    expect(errors.indicator?.latency?.expression?.message).toBe(
      'A duration expression is required',
    );
    // And an empty duration is ignored for availability.
    expect((await resolve(valid)).errors).toEqual({});
  });

  it('saves the good condition or the latency settings, not both', () => {
    expect(toSloInput(valid).indicator).toEqual({
      template: 'availability',
      eligible: { where: '', whereLanguage: 'sql' },
      good: "StatusCode != 'Error'",
    });
    const { indicator } = toSloInput(latency('Duration'), traceSource);
    expect(indicator.good).toBeUndefined();
    // The source's own duration column is numeric; anything else is cast.
    expect(indicator.latency).toEqual(
      expect.objectContaining({ expression: 'Duration', numeric: true }),
    );
    expect(
      toSloInput(latency("SpanAttributes['duration_ms']"), traceSource)
        .indicator.latency?.numeric,
    ).toBe(false);
  });

  it("takes a native duration's unit from the source's duration precision", () => {
    const withUnit = (expression: string): SloFormValues => {
      const values = latency(expression);
      values.indicator.latency.unit = 'ms';
      return values;
    };
    // The source stores nanoseconds, whatever the form holds.
    expect(
      toSloInput(withUnit('Duration'), traceSource).indicator.latency?.unit,
    ).toBe('ns');
    // Any other expression is in the unit the user picked.
    expect(
      toSloInput(withUnit("SpanAttributes['duration_ms']"), traceSource)
        .indicator.latency?.unit,
    ).toBe('ms');
  });

  it('loads a saved SLO back into the form unchanged', () => {
    const saved = savedSlo;
    const values = sloToFormValues(saved);
    expect(toSloInput(values)).toEqual(
      expect.objectContaining({
        name: saved.name,
        description: saved.description,
        tags: saved.tags,
        indicator: saved.indicator,
        target: saved.target,
        window: saved.window,
        groupBy: saved.groupBy,
        alerts: saved.alerts,
      }),
    );
  });
});
