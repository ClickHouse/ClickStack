import type { FieldErrors } from 'react-hook-form';
import { SourceKind, type TSource } from '@hyperdx/common-utils/dist/types';

import {
  DEFAULT_SLO_FORM_VALUES,
  sloFormResolver,
  type SloFormValues,
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
});
