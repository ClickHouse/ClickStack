import {
  getDashboardVariableDeclarations,
  getDashboardVariableFilters,
  getFilterVariableName,
  isFilterVariableEnabled,
  isStaticListFilter,
} from '@hyperdx/common-utils/dist/filters';
import {
  getConfigReferenceFields,
  getReferenceVariableFilters,
  getStringField,
  parseVariableReference,
} from '@hyperdx/common-utils/dist/referenceVariables';
import type { ChartVariable } from '@hyperdx/common-utils/dist/types';
import { isFilterSingleSelect } from '@hyperdx/common-utils/dist/variables';
import { z } from 'zod';

import type { ExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';
import type {
  ExternalDashboardFilter,
  ExternalDashboardFilterWithId,
  ExternalDashboardTileWithId,
} from '@/utils/zod';

type ExternalFilters =
  | (ExternalDashboardFilter | ExternalDashboardFilterWithId)[]
  | undefined;

/** Names of the data source and connection variables a dashboard declares. */
function getReferenceVariableNames(filters: ExternalFilters): Set<string> {
  return new Set(getReferenceVariableFilters(filters).map(({ name }) => name));
}

/** The external API name of a chart config field that can hold a reference. */
function toExternalReferenceKey(
  key: ReturnType<typeof getConfigReferenceFields>[number]['key'],
): 'sourceId' | 'connectionId' {
  switch (key) {
    case 'source':
      return 'sourceId';
    case 'connection':
      return 'connectionId';
  }
}

/** Optional per-variable selection for a tile run. */
export const mcpVariableValuesParam = z
  .array(
    z.object({
      name: z
        .string()
        .describe(
          "Variable name, as declared by a filter's variableName. Get the " +
            'list from clickstack_get_dashboard.',
        ),
      values: z
        .array(z.string())
        .describe(
          'Values to treat as selected. An empty array means nothing is selected for this variable. ' +
            "For a STATIC_LIST filter's variable, every value must be one of the filter's declared options. " +
            'For a DATA_SOURCE or CONNECTION variable, pass one source or connection ID; it ' +
            "overrides the dashboard's saved selection.",
        ),
    }),
  )
  .describe(
    'Optional simulated dashboard variable selection for this run. Every ' +
      'variable the dashboard declares defaults to EMPTY, which is the state a ' +
      'freshly-opened dashboard is in. Supply values here to check that a tile narrows ' +
      'as expected once the user picks something. Variables not listed stay empty.',
  );

export type McpVariableValues = z.infer<typeof mcpVariableValuesParam>;

/**
 * Build the variable context a dashboard tile runs with.
 *
 * The declarations come from the dashboard's variable-enabled filters, with
 * every selection empty by default.
 *
 * An unknown name in `variableValues` is an error rather than a silent no-op:
 * it is the agent's own input, and a typo would otherwise run the query with
 * the variable still empty and look like a data problem.
 */
export function resolveDashboardVariables(
  filters:
    | (ExternalDashboardFilter | ExternalDashboardFilterWithId)[]
    | undefined,
  variableValues: McpVariableValues | undefined,
): { variables: ChartVariable[] } | { error: string } {
  // Empty selection for every variable by default
  const variables: ChartVariable[] = getDashboardVariableDeclarations(
    filters,
  ).map(declaration => ({ ...declaration, values: [] }));

  if (!variableValues?.length) return { variables };

  const byName = new Map(variables.map(variable => [variable.name, variable]));
  // Resolved separately, by resolveTileVariableReferences
  const referenceVariableNames = getReferenceVariableNames(filters);
  const unknownVariableValues = variableValues
    .map(({ name }) => name)
    .filter(name => !byName.has(name) && !referenceVariableNames.has(name));
  if (unknownVariableValues.length > 0) {
    const available =
      variables.length > 0
        ? variables.map(variable => variable.name).join(', ')
        : '(none)';
    return {
      error:
        `This dashboard declares no variable(s) named ${unknownVariableValues.join(', ')}. ` +
        `Available variables: ${available}. A variable exists only when a ` +
        'dashboard filter sets isVariableEnabled; check the filters returned ' +
        'by clickstack_get_dashboard.',
    };
  }

  // A static filter's dropdown can only ever offer its declared options, so a
  // simulated selection outside them can never occur in the UI — reject it as
  // a typo rather than running a query the dashboard cannot produce.
  const staticOptionsByName = buildStaticOptionsByName(filters);
  const optionErrors = variableValues.flatMap(({ name, values }) => {
    const options = staticOptionsByName.get(name);
    if (!options) return [];
    const invalid = values.filter(value => !options.includes(value));
    if (invalid.length === 0) return [];
    return [
      `Variable "${name}" belongs to a STATIC_LIST filter and only accepts its declared ` +
        `options; value(s) ${invalid.map(value => `"${value}"`).join(', ')} are not among them. ` +
        `Declared options: ${formatOptionsPreview(options)}. See the filter's options via ` +
        'clickstack_get_dashboard, or change them with clickstack_save_dashboard.',
    ];
  });
  if (optionErrors.length > 0) {
    return { error: optionErrors.join('\n') };
  }

  // The dashboard can never hold several values for a single-select variable.
  const singleSelectNames = new Set(
    variables.filter(isFilterSingleSelect).map(variable => variable.name),
  );
  const singleSelectErrors = variableValues
    .filter(
      ({ name, values }) => values.length > 1 && singleSelectNames.has(name),
    )
    .map(
      ({ name }) =>
        `Variable "${name}" belongs to a single-select filter (maxSelections: 1) ` +
        'and accepts at most one value.',
    );
  if (singleSelectErrors.length > 0) {
    return { error: singleSelectErrors.join('\n') };
  }

  // Override the default empty selection with the given variableValues
  for (const { name, values } of variableValues) {
    const variable = byName.get(name);
    if (variable) variable.values = values;
  }

  return { variables };
}

/**
 * Replace a tile's `$name` sourceId / connectionId with the source or
 * connection its data source or connection variable selects: the caller's
 * variableValues first, then the dashboard's saved selection. A tile with no
 * selection cannot run, as on the dashboard, so that is an error naming the
 * variable.
 */
export function resolveTileVariableReferences<
  T extends ExternalDashboardTileWithId,
>(
  tile: T,
  filters: ExternalFilters,
  variableValues: McpVariableValues | undefined,
  savedFilterValues: ExternalDashboard['savedFilterValues'] = [],
): { tile: T } | { error: string } {
  if (!('config' in tile) || tile.config == null) return { tile };
  const referenceVariableNames = getReferenceVariableNames(filters);
  const selections = new Map<string, string[]>();
  for (const value of savedFilterValues ?? []) {
    if (value.type === 'variable') selections.set(value.name, value.values);
  }
  for (const { name, values } of variableValues ?? []) {
    if (referenceVariableNames.has(name)) selections.set(name, values);
  }

  let config: object = tile.config;
  for (const { key } of getConfigReferenceFields(config)) {
    const field = toExternalReferenceKey(key);
    const name = parseVariableReference(getStringField(config, field));
    if (name == null) continue;
    const selected = selections.get(name) ?? [];
    if (selected.length !== 1) {
      return {
        error:
          `Tile "${tile.id}" reads its ${field} from the $${name} variable, which ` +
          (selected.length === 0
            ? 'has no selection. Pass one ID for it in variableValues, or save a selection on the dashboard.'
            : 'accepts exactly one value.'),
      };
    }
    config = { ...config, [field]: selected[0] };
  }
  return { tile: { ...tile, config } };
}

/** Options of each static filter, keyed by the variable name it answers to. */
function buildStaticOptionsByName(
  filters: ExternalDashboardFilter[] | undefined,
): Map<string, string[]> {
  const optionsByName = new Map<string, string[]>();
  for (const { filter, name } of getDashboardVariableFilters(filters)) {
    if (isStaticListFilter(filter)) optionsByName.set(name, filter.options);
  }
  return optionsByName;
}

const OPTIONS_PREVIEW_LIMIT = 20;

// Options allow up to 1000 entries of 10k characters each; keep the error legible.
function formatOptionsPreview(options: string[]): string {
  const preview = options.slice(0, OPTIONS_PREVIEW_LIMIT).join(', ');
  const remaining = options.length - OPTIONS_PREVIEW_LIMIT;
  return remaining > 0 ? `${preview}, … and ${remaining} more` : preview;
}

/** Set a derived variableName on filters without explicit variable names, so the agent doesn't guess. */
export function withResolvedFilterVariableNames(
  filters: ExternalDashboardFilterWithId[],
): ExternalDashboardFilterWithId[] {
  return filters.map(filter =>
    isFilterVariableEnabled(filter)
      ? { ...filter, variableName: getFilterVariableName(filter) }
      : filter,
  );
}
