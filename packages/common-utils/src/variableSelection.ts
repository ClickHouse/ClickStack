import type { ChartVariable } from '@/types';

/**
 * A dashboard variable's selection: an explicit list of values, or the
 * `{ all: true }` marker meaning every option its filter offers. Only filters
 * that pass `filterSupportsAllValue` can hold the marker.
 */
export type VariableSelection = string[] | { all: true };

/** The "all" selection. */
export const ALL_SELECTION: VariableSelection = { all: true };

/** True when a selection is the "all" marker. */
export function isAllSelection(
  selection: VariableSelection | undefined,
): selection is { all: true } {
  return (
    selection != null && !Array.isArray(selection) && selection.all === true
  );
}

/**
 * True when a selection is "all" or a non-empty value list. An empty array
 * means nothing is selected, the same as an absent selection.
 */
export function selectionHasValue(
  selection: VariableSelection | undefined,
): selection is VariableSelection {
  return isAllSelection(selection) || (!!selection && selection.length > 0);
}

/**
 * Fill each "all" variable's values with its filter's options, sorted so query
 * keys stay stable. A variable whose options aren't known yet keeps its empty
 * values, so callers can wait for them.
 */
export function expandAllSelections(
  variables: ChartVariable[],
  optionsByVariableName: ReadonlyMap<string, readonly string[]>,
): ChartVariable[] {
  return variables.map(variable => {
    if (!variable.all) return variable;
    const options = optionsByVariableName.get(variable.name);
    return options ? { ...variable, values: [...options].sort() } : variable;
  });
}
