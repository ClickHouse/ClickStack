import { useMemo } from 'react';
import stripAnsi from 'strip-ansi';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import {
  buildNoisyBodyMatcher,
  DENOISE_NOISE_THRESHOLD,
  DENOISE_SAMPLE_SIZE,
} from '@hyperdx/common-utils/dist/drain';
import {
  BuilderChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import {
  DRAIN_EXTRA_DELIMITERS,
  useGroupedPatterns,
} from '@/hooks/usePatterns';
import { getEventBody, getLevelExpression } from '@/source';
import { selectItemExpression } from '@/utils';

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

  const noisyPatterns = useMemo(
    () =>
      Object.values(patternGroups).filter(
        p => p.count / (sampledRowCount || 1) > DENOISE_NOISE_THRESHOLD,
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
    skipped,
    isLoading: enabled && skipped == null && groupedPatterns.isLoading,
  };
}
