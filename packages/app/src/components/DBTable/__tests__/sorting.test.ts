import {
  BuilderChartConfig,
  DisplayType,
  MetricsDataType,
} from '@hyperdx/common-utils/dist/types';

import {
  getAliasedResultColumns,
  numericRowSortingFn,
} from '@/components/DBTable/sorting';

function makeRow(value: unknown) {
  return { getValue: (_key: string) => value } as any;
}

describe('numericRowSortingFn', () => {
  const key = 'col';

  it('sorts numbers in ascending order', () => {
    expect(numericRowSortingFn(makeRow(1), makeRow(2), key)).toBeLessThan(0);
    expect(numericRowSortingFn(makeRow(2), makeRow(1), key)).toBeGreaterThan(0);
    expect(numericRowSortingFn(makeRow(5), makeRow(5), key)).toBe(0);
  });

  it('treats numeric strings as numbers', () => {
    expect(
      numericRowSortingFn(makeRow('10'), makeRow('9'), key),
    ).toBeGreaterThan(0);
    expect(numericRowSortingFn(makeRow('3'), makeRow('20'), key)).toBeLessThan(
      0,
    );
  });

  it('sorts null as greater than any number (pushes to end)', () => {
    expect(numericRowSortingFn(makeRow(null), makeRow(1), key)).toBeGreaterThan(
      0,
    );
    expect(numericRowSortingFn(makeRow(1), makeRow(null), key)).toBeLessThan(0);
  });

  it('sorts NaN strings as greater than any number (pushes to end)', () => {
    expect(
      numericRowSortingFn(makeRow('abc'), makeRow(1), key),
    ).toBeGreaterThan(0);
    expect(numericRowSortingFn(makeRow(1), makeRow('abc'), key)).toBeLessThan(
      0,
    );
  });

  it('handles negative numbers', () => {
    expect(numericRowSortingFn(makeRow(-5), makeRow(0), key)).toBeLessThan(0);
    expect(numericRowSortingFn(makeRow(0), makeRow(-5), key)).toBeGreaterThan(
      0,
    );
  });

  it('treats two null/NaN values as equal', () => {
    expect(numericRowSortingFn(makeRow(null), makeRow(null), key)).toBe(0);
    expect(numericRowSortingFn(makeRow('abc'), makeRow('xyz'), key)).toBe(0);
    expect(numericRowSortingFn(makeRow(null), makeRow('abc'), key)).toBe(0);
  });

  it('handles floating point numbers', () => {
    expect(numericRowSortingFn(makeRow(1.5), makeRow(1.6), key)).toBeLessThan(
      0,
    );
    expect(
      numericRowSortingFn(makeRow(1.6), makeRow(1.5), key),
    ).toBeGreaterThan(0);
  });
});

describe('getAliasedResultColumns', () => {
  const METRIC_TABLES = {
    gauge: 'otel_metrics_gauge',
    sum: 'otel_metrics_sum',
    histogram: 'otel_metrics_histogram',
    summary: 'otel_metrics_summary',
    'exponential histogram': 'otel_metrics_exponential_histogram',
  };

  const makeConfig = (
    overrides: Partial<BuilderChartConfig>,
  ): BuilderChartConfig => ({
    displayType: DisplayType.Table,
    connection: 'conn',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
    where: '',
    select: [],
    ...overrides,
  });

  const meta = (...names: string[]) =>
    names.map(name => ({ name, type: 'Float64' }));

  const gauge = (alias?: string) => ({
    aggFn: 'avg' as const,
    valueExpression: 'Value',
    metricName: 'cpu',
    metricType: MetricsDataType.Gauge,
    alias,
  });

  it('includes series aliases but not unaliased series', () => {
    const config = makeConfig({
      select: [
        { aggFn: 'count', valueExpression: '' },
        { aggFn: 'avg', valueExpression: 'Duration', alias: 'duration min' },
        { aggFn: 'max', valueExpression: 'Duration', alias: '  ' },
      ],
    });
    expect(
      getAliasedResultColumns(
        config,
        meta('count()', 'duration min', 'max(Duration)'),
      ),
    ).toEqual(new Set(['duration min']));
  });

  it('includes every formula column, and operands only when aliased', () => {
    const config = makeConfig({
      select: [
        { aggFn: 'count', valueExpression: '' },
        { aggFn: 'avg', valueExpression: 'Duration', alias: 'avg dur' },
      ],
      formulas: [
        { expression: 'B / A', alias: 'duration min' },
        { expression: 'A * 2' },
      ],
    });
    expect(
      getAliasedResultColumns(
        config,
        meta('count()', 'avg dur', 'duration min', 'A * 2'),
      ),
    ).toEqual(new Set(['avg dur', 'duration min', 'A * 2']));
  });

  it('includes formula columns when the operands are hidden', () => {
    const config = makeConfig({
      select: [
        { aggFn: 'count', valueExpression: '' },
        { aggFn: 'avg', valueExpression: 'Duration' },
      ],
      formulas: [{ expression: 'B / A', alias: 'duration min' }],
      showOperandSeries: false,
      groupBy: 'ServiceName',
    });
    expect(
      getAliasedResultColumns(config, meta('duration min', 'ServiceName')),
    ).toEqual(new Set(['duration min']));
  });

  it('excludes the merged ratio column', () => {
    const config = makeConfig({
      select: [
        { aggFn: 'count', valueExpression: '', alias: 'errors' },
        { aggFn: 'count', valueExpression: '', alias: 'total' },
      ],
      seriesReturnType: 'ratio',
    });
    expect(
      getAliasedResultColumns(config, meta('divide(errors, total)')),
    ).toEqual(new Set());
  });

  it('includes aliased group-by entries from a group-by string', () => {
    const config = makeConfig({
      select: [{ aggFn: 'count', valueExpression: '' }],
      groupBy: `ServiceName, SpanAttributes['http.method'], ResourceAttributes['service.name'] AS "svc name", toString(Duration > 1000) as slow`,
    });
    expect(
      getAliasedResultColumns(
        config,
        meta(
          'count()',
          'ServiceName',
          "arrayElement(SpanAttributes, 'http.method')",
          'svc name',
          'slow',
        ),
      ),
    ).toEqual(new Set(['svc name', 'slow']));
  });

  it('includes aliased entries from a structured group-by', () => {
    const config = makeConfig({
      select: [{ aggFn: 'count', valueExpression: '' }],
      groupBy: [
        { valueExpression: 'ServiceName' },
        {
          valueExpression: "ResourceAttributes['service.name']",
          alias: 'svc name',
        },
      ],
    });
    expect(
      getAliasedResultColumns(
        config,
        meta('count()', 'ServiceName', 'svc name'),
      ),
    ).toEqual(new Set(['svc name']));
  });

  it('treats a single-series metric like any other query', () => {
    const config = makeConfig({
      metricTables: METRIC_TABLES,
      select: [gauge()],
      groupBy: `ServiceName, ResourceAttributes['service.name'] AS "svc name"`,
    });
    expect(
      getAliasedResultColumns(
        config,
        meta(
          'avg(toFloat64OrDefault(toString(LastValue)))',
          'ServiceName',
          'svc name',
        ),
      ),
    ).toEqual(new Set(['svc name']));
  });

  it.each([
    {
      name: 'multiple series',
      select: [gauge('cpu avg'), gauge()],
      formulas: undefined,
    },
    {
      name: 'a single series with a formula',
      select: [gauge()],
      formulas: [{ expression: 'A * 100' }],
    },
  ])(
    'includes every column of a metric query with $name',
    ({ select, formulas }) => {
      const config = makeConfig({
        metricTables: METRIC_TABLES,
        select,
        formulas,
        groupBy: `ServiceName, Attributes['host']`,
      });
      const names = [
        'avg(cpu)',
        'ServiceName',
        "arrayElement(Attributes, 'host')",
      ];
      expect(getAliasedResultColumns(config, meta(...names))).toEqual(
        new Set(names),
      );
    },
  );

  it('leaves the packed group column of a histogram bare', () => {
    const config = makeConfig({
      metricTables: METRIC_TABLES,
      select: [
        {
          aggFn: 'quantile',
          level: 0.95,
          valueExpression: 'Value',
          metricName: 'latency',
          metricType: MetricsDataType.Histogram,
          alias: 'p95 lat',
        },
      ],
      groupBy: `ServiceName, Attributes['host'] AS "the host"`,
    });
    expect(getAliasedResultColumns(config, meta('group', 'p95 lat'))).toEqual(
      new Set(['p95 lat']),
    );
  });

  it('returns nothing for a string select', () => {
    const config = makeConfig({ select: 'count() AS "total count"' });
    expect(getAliasedResultColumns(config, meta('total count'))).toEqual(
      new Set(),
    );
  });
});
