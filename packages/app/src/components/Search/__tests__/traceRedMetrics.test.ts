import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import {
  durationConfig,
  ERROR_RATE_FORMAT,
  ERROR_RATE_HELPER_SERIES,
  errorsConfig,
  redBaseConfig,
} from '@/components/Search/traceRedMetrics';
import type { NumberFormat } from '@/types';

// A sidebar filter the user has applied; every RED config must carry it so the
// tiles stay in sync with the results list.
const BASE_FILTER = { type: 'sql' as const, condition: "SpanKind = 'Server'" };

const base: BuilderChartConfigWithDateRange = {
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
  where: "ServiceName = 'api'",
  whereLanguage: 'sql',
  filters: [BASE_FILTER],
  dateRange: [new Date(0), new Date(60_000)],
  granularity: 'auto',
  groupBy: 'StatusCode',
};

const ERROR_COND = "lower(StatusCode) IN ('error', 'status_code_error')";
const DURATION_EXPR = 'Duration';
const DURATION_FORMAT: NumberFormat = { output: 'duration', factor: 1e-9 };

describe('traceRedMetrics', () => {
  describe('redBaseConfig', () => {
    it('strips the status-code groupBy and preserves filters + where + time range', () => {
      const result = redBaseConfig(base);
      expect(result.groupBy).toBeUndefined();
      expect(result.where).toBe(base.where);
      expect(result.dateRange).toBe(base.dateRange);
      // sidebar filters must survive, or the tiles would disagree with results
      expect(result.filters).toEqual([BASE_FILTER]);
    });
  });

  describe('errorsConfig', () => {
    it('rate: count + countIf aggregated separately, divided post-aggregation (MV-friendly)', () => {
      const result = errorsConfig(redBaseConfig(base), 'StatusCode', 'rate');
      expect(result).toBeDefined();
      expect(result?.displayType).toBe(DisplayType.Line);
      expect(result?.numberFormat).toBe(ERROR_RATE_FORMAT);
      // rate aggregates across all statuses, so no per-status groupBy
      expect(result?.groupBy).toBeUndefined();
      expect(result?.select).toEqual([
        {
          alias: 'total_spans',
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
        {
          alias: 'error_spans',
          aggFn: 'count',
          aggCondition: ERROR_COND,
          aggConditionLanguage: 'sql',
          valueExpression: '',
        },
        {
          alias: 'Error rate',
          // divided directly: total_spans is always >= 1 in a returned bucket
          valueExpression: 'error_spans / total_spans',
        },
      ]);
      // the two aggregated counts are the ones hidden from the chart
      expect(ERROR_RATE_HELPER_SERIES).toEqual(['total_spans', 'error_spans']);
    });

    it('volume: error spans grouped by status, filtered to the error condition, as bars', () => {
      const result = errorsConfig(redBaseConfig(base), 'StatusCode', 'volume');
      expect(result).toBeDefined();
      expect(result?.displayType).toBe(DisplayType.StackedBar);
      expect(result?.numberFormat).toBe(INTEGER_NUMBER_FORMAT);
      // grouped by status so a clicked bar decodes to a status filter (the
      // histogram's drill-down); restricted to errors so it stays errors-only
      expect(result?.groupBy).toBe('StatusCode');
      expect(result?.select).toEqual([
        {
          alias: 'Errors',
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
      ]);
      // the error condition is APPENDED to the user's active filters, not
      // replacing them, so the tile stays scoped to the current search
      expect(result?.filters).toEqual([
        BASE_FILTER,
        { type: 'sql', condition: ERROR_COND },
      ]);
    });

    it('returns undefined when the source has no usable status expression', () => {
      expect(
        errorsConfig(redBaseConfig(base), undefined, 'rate'),
      ).toBeUndefined();
      expect(
        errorsConfig(redBaseConfig(base), undefined, 'volume'),
      ).toBeUndefined();
      // blank/whitespace is treated as no status expression
      expect(
        errorsConfig(redBaseConfig(base), '   ', 'volume'),
      ).toBeUndefined();
    });
  });

  describe('durationConfig', () => {
    it('aggregates the raw duration column and passes the display format through', () => {
      const result = durationConfig(
        redBaseConfig(base),
        DURATION_EXPR,
        DURATION_FORMAT,
      );
      expect(result.displayType).toBe(DisplayType.Line);
      // no SQL-side unit conversion: the format handles the unit at display
      expect(result.numberFormat).toBe(DURATION_FORMAT);
      expect(result.select).toEqual([
        {
          alias: 'Avg',
          aggFn: 'avg',
          aggCondition: '',
          valueExpression: DURATION_EXPR,
          color: 'chart-blue',
        },
        {
          alias: 'P95',
          aggFn: 'quantile',
          level: 0.95,
          aggCondition: '',
          valueExpression: DURATION_EXPR,
          color: 'chart-cyan',
        },
        {
          alias: 'P99',
          aggFn: 'quantile',
          level: 0.99,
          aggCondition: '',
          valueExpression: DURATION_EXPR,
          color: 'chart-purple',
        },
      ]);
    });

    // Latency is not an error signal: red/error/warning/success are reserved for
    // other meanings, and the positional palette would otherwise hand slot 2 to
    // chart-red. Pinning each series via its select-item color keeps latency off
    // those hues; this guards both the specific pins and a reserved hue creeping
    // back in. The color lives on the select item, so it can't drift from the
    // series the way a separate name-keyed map could.
    it('pins each duration series to a stable, non-reserved hue', () => {
      const { select } = durationConfig(
        redBaseConfig(base),
        DURATION_EXPR,
        DURATION_FORMAT,
      );
      const reserved = [
        'chart-red',
        'chart-error',
        'chart-warning',
        'chart-success',
      ];
      // durationConfig always builds a select list, never a raw SQL string
      const colors = Array.isArray(select) ? select.map(s => s.color) : [];
      expect(colors).toEqual(['chart-blue', 'chart-cyan', 'chart-purple']);
      expect(colors.filter(c => c != null && reserved.includes(c))).toEqual([]);
    });
  });
});
