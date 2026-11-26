import {
  ColumnMetaType,
  convertCHDataTypeToJSType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { isComposedMetricChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { BuilderChartConfig } from '@hyperdx/common-utils/dist/types';
import { Row, SortingFnOption } from '@tanstack/react-table';

import { getBuilderGroupByColumns } from '@/hooks/useResultColumnFilterKeys';
import { getBuilderValueColumnCount, getFormulaConfig } from '@/source';

export const numericRowSortingFn = ((
  a: Row<unknown>,
  b: Row<unknown>,
  columnId: string,
) => {
  const aValue = a.getValue(columnId);
  const bValue = b.getValue(columnId);

  const aInvalid = aValue == null || isNaN(Number(aValue));
  const bInvalid = bValue == null || isNaN(Number(bValue));
  if (aInvalid && bInvalid) return 0;
  if (aInvalid) return 1;
  if (bInvalid) return -1;

  return Number(aValue) - Number(bValue);
}) satisfies SortingFnOption<unknown>;

export const getClientSideSortingFn = (
  meta: ColumnMetaType[] | undefined,
  columnName: string,
): SortingFnOption<unknown> => {
  const columnMeta = meta?.find(col => col.name === columnName);
  const jsType = columnMeta
    ? convertCHDataTypeToJSType(columnMeta.type)
    : undefined;

  if (jsType === 'number') {
    return numericRowSortingFn;
  }

  // Fallback to alphanumeric sorting for other types, including when metadata is unavailable, and when
  // metadata indicates that the column type is date (in which case the value will be a string type in JS)
  return 'alphanumeric';
};

const isNonEmptyAlias = (alias: string | undefined) =>
  alias != null && alias.trim() !== '';

/**
 * The result columns of a builder table query that are explicit aliases in
 * its final SELECT. ORDER BY must reference those by their quoted name, and
 * every other column by its bare expression: ClickHouse re-evaluates a bare
 * expression, but can't resolve a quoted auto-generated name like `"count()"`.
 */
export function getAliasedResultColumns(
  config: BuilderChartConfig,
  meta: ColumnMetaType[],
): Set<string> {
  if (!Array.isArray(config.select)) {
    return new Set();
  }
  if (isComposedMetricChartConfig(config)) {
    return new Set(meta.map(column => column.name));
  }

  // Matched by name, not position: a histogram puts its packed group column
  // ahead of the value column, and a ratio merges its series into one
  // unaliased column.
  const seriesAliases = new Set(
    config.select.flatMap(s => (isNonEmptyAlias(s.alias) ? [s.alias] : [])),
  );
  const aliased = new Set(
    meta.map(column => column.name).filter(name => seriesAliases.has(name)),
  );
  // Formula columns are always aliased, by their alias or expression, and
  // follow the operand columns. They're matched by position because duplicate
  // names get a suffix.
  const formulaConfig = getFormulaConfig(config);
  if (formulaConfig) {
    const operandCount = formulaConfig.operandsHidden
      ? 0
      : config.select.length;
    meta
      .slice(operandCount, getBuilderValueColumnCount(config))
      .forEach(column => aliased.add(column.name));
  }
  for (const { column, alias } of getBuilderGroupByColumns(config, meta)) {
    if (alias != null) aliased.add(column.name);
  }
  return aliased;
}
