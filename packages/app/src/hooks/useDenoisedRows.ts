import { useMemo } from 'react';
import stripAnsi from 'strip-ansi';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import {
  buildNoisyBodyMatcher,
  DENOISE_SAMPLE_SIZE,
  selectNoisyPatterns,
} from '@hyperdx/common-utils/dist/drain';
import {
  BuilderChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import {
  DRAIN_EXTRA_DELIMITERS,
  LEVEL_COLUMN_ALIAS,
  useGroupedPatterns,
} from '@/hooks/usePatterns';
import { getEventBody, getLevelExpression } from '@/source';
import { getLogLevelClass, selectItemExpression } from '@/utils';

function isErrorOrWarning(row: Record<string, unknown>) {
  const level = row[LEVEL_COLUMN_ALIAS];
  if (typeof level !== 'string') return false;
  const levelClass = getLogLevelClass(level);
  return levelClass === 'error' || levelClass === 'warn';
}

export type DenoiseSkipReason =
  | 'no_body_expression'
  | 'body_not_in_results'
  | 'patterns_failed';

/**
 * The result column holding the source's body. `columns` follow the order of
 * the SELECT items, and ClickHouse may rename a column, so the body is located
 * by its position in the SELECT list, then by name (e.g. for `SELECT *`).
 */
export function findBodyResultColumn(
  select: BuilderChartConfigWithDateRange['select'],
  columns: string[],
  bodyExpression: string | undefined,
): string | undefined {
  if (!bodyExpression) return undefined;
  if (typeof select === 'string') {
    const index = splitAndTrimWithBracket(select).findIndex(
      item => selectItemExpression(item) === bodyExpression,
    );
    if (index !== -1 && index < columns.length) return columns[index];
  }
  return columns.includes(bodyExpression) ? bodyExpression : undefined;
}

export function useDenoisedRows<TRow extends Record<string, any>>({
  config,
  source,
  columns,
  rows,
  enabled,
}: {
  config: BuilderChartConfigWithDateRange;
  source: TSource | undefined;
  columns: string[];
  rows: TRow[];
  enabled: boolean;
}) {
  const bodyExpression = source ? getEventBody(source) : undefined;
  const bodyColumn = findBodyResultColumn(
    config.select,
    columns,
    bodyExpression,
  );
  const groupedPatterns = useGroupedPatterns({
    config,
    samples: DENOISE_SAMPLE_SIZE,
    bodyValueExpression: bodyExpression ?? '',
    levelExpression: getLevelExpression(source),
    totalCount: undefined,
    enabled: enabled && bodyColumn != null,
  });

  const {
    data: patternGroups,
    sampledRowCount,
    clusterTemplates,
  } = groupedPatterns;

  let skipped: DenoiseSkipReason | undefined;
  if (!enabled) {
    // Not denoising, nothing to skip
  } else if (!bodyExpression) {
    skipped = 'no_body_expression';
  } else if (columns.length > 0 && bodyColumn == null) {
    // Columns are unknown until the first page arrives
    skipped = 'body_not_in_results';
  } else if (groupedPatterns.error != null) {
    skipped = 'patterns_failed';
  }

  // Frequency is not importance: a flood of errors during an incident must
  // stay visible, so patterns with any error or warning sample are kept.
  const noisyPatterns = useMemo(
    () =>
      selectNoisyPatterns(
        Object.values(patternGroups).filter(
          p => !p.samples.some(isErrorOrWarning),
        ),
        p => p.count,
        sampledRowCount ?? 0,
      ),
    [patternGroups, sampledRowCount],
  );

  const isNoisy = useMemo(() => {
    if (clusterTemplates == null) return undefined;
    const noisyTemplates = new Set(
      noisyPatterns
        .map(p => clusterTemplates[p.id])
        .filter((t): t is string => t != null),
    );
    return buildNoisyBodyMatcher(
      Object.values(clusterTemplates),
      noisyTemplates,
      { extraDelimiters: DRAIN_EXTRA_DELIMITERS },
    );
  }, [clusterTemplates, noisyPatterns]);

  const denoisedRows = useMemo(() => {
    if (!enabled) return rows;
    if (skipped != null) return rows;
    if (isNoisy == null || bodyColumn == null) return [];
    if (noisyPatterns.length === 0) return rows;
    return rows.filter(row => {
      const body = row[bodyColumn];
      if (body == null) return true;
      return !isNoisy(stripAnsi(String(body)));
    });
  }, [enabled, skipped, isNoisy, bodyColumn, noisyPatterns, rows]);

  return {
    rows: denoisedRows,
    bodyExpression,
    noisyPatterns,
    sampledRowCount: sampledRowCount ?? 0,
    skipped,
    isLoading: enabled && skipped == null && clusterTemplates == null,
  };
}
