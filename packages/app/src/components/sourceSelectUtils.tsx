import { createContext, use, useMemo } from 'react';
import {
  getConnectionVariableNames,
  getSourceVariableDeclarations,
  isSourceVariableAccepted,
  parseVariableReference,
  ReferenceVariableValues,
  resolveVariableReference,
  SourceVariableDeclaration,
  toVariableReference,
} from '@hyperdx/common-utils/dist/referenceVariables';
import {
  DashboardFilter,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { ComboboxItem, OptionsFilter } from '@mantine/core';
import {
  IconChartLine,
  IconConnection,
  IconDeviceLaptop,
  IconLogs,
  IconVariable,
} from '@tabler/icons-react';

export const SOURCE_KIND_ICONS: Record<string, React.ReactNode> = {
  [SourceKind.Log]: <IconLogs size={16} />,
  [SourceKind.Trace]: <IconConnection size={16} />,
  [SourceKind.Session]: <IconDeviceLaptop size={16} />,
  [SourceKind.Metric]: <IconChartLine size={16} />,
  [SourceKind.Promql]: <IconChartLine size={16} />,
};

export const VARIABLE_ICON = <IconVariable size={16} />;

export function getSourceOptionIcon(
  value: string | undefined,
  sourceKindMap: ReadonlyMap<string, SourceKind>,
): React.ReactNode {
  if (parseVariableReference(value) != null) return VARIABLE_ICON;
  return SOURCE_KIND_ICONS[(value && sourceKindMap.get(value)) ?? ''];
}

type ReferenceVariablesContextValue = {
  sourceVariables: SourceVariableDeclaration[];
  connectionVariables: string[];
  values: ReferenceVariableValues;
};

const ReferenceVariablesContext = createContext<ReferenceVariablesContextValue>(
  { sourceVariables: [], connectionVariables: [], values: new Map() },
);

/**
 * Offers the data source and connection variables `filters` declare to the
 * pickers below it that opt in, and their selections to `useResolvedReference`.
 */
export function ReferenceVariablesProvider({
  filters,
  values,
  children,
}: {
  filters: DashboardFilter[];
  values: ReferenceVariableValues;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      sourceVariables: getSourceVariableDeclarations(filters),
      connectionVariables: getConnectionVariableNames(filters),
      values,
    }),
    [filters, values],
  );
  return (
    <ReferenceVariablesContext value={value}>
      {children}
    </ReferenceVariablesContext>
  );
}

/**
 * The ID a source or connection field currently queries: an ID as is, or the
 * selection of the variable it references.
 */
export function useResolvedReference(
  value: string | undefined,
): string | undefined {
  const { values } = use(ReferenceVariablesContext);
  return resolveVariableReference(value, values);
}

export function useReferenceVariableValues(): ReferenceVariableValues {
  return use(ReferenceVariablesContext).values;
}

export function useSourceVariableDeclarations(): SourceVariableDeclaration[] {
  return use(ReferenceVariablesContext).sourceVariables;
}

const toVariableItem = (name: string): ComboboxItem => {
  const reference = toVariableReference(name);
  return { value: reference, label: reference };
};

/**
 * A source picker's items, preceded by a "Variables" group of the data source
 * variables it can offer. A variable is offered only if every kind it can
 * resolve to is allowed, so no selection can produce an unusable source, and,
 * for a picker limited to `connection`, only if it is unlimited or limited to
 * that same connection (ID or variable reference).
 */
export function useWithSourceVariableItems(
  sourceItems: ComboboxItem[] | SourceSelectGroup[],
  {
    enabled,
    allowedSourceKinds,
    connection,
  }: {
    enabled: boolean;
    allowedSourceKinds?: SourceKind[];
    connection?: string;
  },
): (ComboboxItem | SourceSelectGroup)[] {
  const { sourceVariables } = use(ReferenceVariablesContext);
  return useMemo(() => {
    if (!enabled) return sourceItems;
    const items = sourceVariables
      .filter(
        variable =>
          (!allowedSourceKinds ||
            isSourceVariableAccepted(variable, allowedSourceKinds)) &&
          (!connection ||
            !variable.connection ||
            variable.connection === connection),
      )
      .map(variable => toVariableItem(variable.name));
    return items.length > 0
      ? [{ group: 'Variables', items }, ...sourceItems]
      : sourceItems;
  }, [enabled, sourceVariables, allowedSourceKinds, connection, sourceItems]);
}

/** A connection picker's items, preceded by a "Variables" group of connection variables. */
export function useWithConnectionVariableItems(
  connectionItems: ComboboxItem[],
  enabled: boolean,
): (ComboboxItem | SourceSelectGroup)[] {
  const { connectionVariables } = use(ReferenceVariablesContext);
  return useMemo(() => {
    if (!enabled || connectionVariables.length === 0) return connectionItems;
    return [
      { group: 'Variables', items: connectionVariables.map(toVariableItem) },
      { group: 'Connections', items: connectionItems },
    ];
  }, [enabled, connectionVariables, connectionItems]);
}

/** Header for sources that have no section assigned. Internal to this module. */
const UNSECTIONED_SOURCE_GROUP = 'Other';

export type SourceSelectGroup = { group: string; items: ComboboxItem[] };

export function useSourceKindMap(sources: TSource[] | undefined) {
  return useMemo(() => {
    const map = new Map<string, SourceKind>();
    sources?.forEach(s => map.set(s.id, s.kind));
    return map;
  }, [sources]);
}

const byLabel = (a: ComboboxItem, b: ComboboxItem) =>
  a.label.localeCompare(b.label);

// No per-source ordering field exists yet, so sections render
// alphabetically with the catch-all pinned last. Admin-controlled
// (positional) ordering is the still-open design question.
const bySectionOrder = (a: string, b: string) => {
  if (a === UNSECTIONED_SOURCE_GROUP) return 1;
  if (b === UNSECTIONED_SOURCE_GROUP) return -1;
  return a.localeCompare(b);
};

type FilteredSourceItemsArgs = {
  sources: TSource[] | undefined;
  allowedSourceKinds?: SourceKind[];
  connectionId?: string;
  /**
   * Extra per-source gate, for restrictions that allowedSourceKinds and
   * connectionId can't express. Must be referentially stable.
   */
  isSourceAllowed?: (source: TSource) => boolean;
  groupBySection?: boolean;
};

export function useFilteredSortedSourceItems(
  args: FilteredSourceItemsArgs & { groupBySection?: false },
): ComboboxItem[];
export function useFilteredSortedSourceItems(
  args: FilteredSourceItemsArgs & { groupBySection: true },
): SourceSelectGroup[] | ComboboxItem[];
export function useFilteredSortedSourceItems({
  sources,
  allowedSourceKinds,
  connectionId,
  isSourceAllowed,
  groupBySection = false,
}: FilteredSourceItemsArgs): ComboboxItem[] | SourceSelectGroup[] {
  return useMemo(() => {
    const visible =
      sources?.filter(
        source =>
          (!allowedSourceKinds || allowedSourceKinds.includes(source.kind)) &&
          (!connectionId || source.connection === connectionId) &&
          (!isSourceAllowed || isSourceAllowed(source)) &&
          !source.disabled,
      ) ?? [];

    if (!groupBySection) {
      return visible.map(s => ({ value: s.id, label: s.name })).sort(byLabel);
    }

    const bySection = new Map<string, ComboboxItem[]>();
    for (const source of visible) {
      const section = source.section?.trim() || UNSECTIONED_SOURCE_GROUP;
      const items = bySection.get(section) ?? [];
      items.push({ value: source.id, label: source.name });
      bySection.set(section, items);
    }

    // Stay flat until at least one source has a real section. Otherwise a
    // deployment that has not adopted sections would render a single "Other"
    // header over its whole list, a change from today's flat selector. The
    // grouping switches on the moment someone assigns a section.
    const sectionNames = [...bySection.keys()];
    const hasRealSection = sectionNames.some(
      name => name !== UNSECTIONED_SOURCE_GROUP,
    );
    if (!hasRealSection) {
      return visible.map(s => ({ value: s.id, label: s.name })).sort(byLabel);
    }

    return sectionNames.sort(bySectionOrder).map(group => ({
      group,
      items: (bySection.get(group) ?? []).sort(byLabel),
    }));
  }, [
    sources,
    allowedSourceKinds,
    connectionId,
    isSourceAllowed,
    groupBySection,
  ]);
}

/**
 * Value of the first option the selector renders, whether the items came back
 * grouped by section or flat. Skips groups with no items, which Mantine
 * accepts and renders as a bare header. Undefined when nothing is selectable.
 */
export function firstSourceItemValue(
  items: ComboboxItem[] | SourceSelectGroup[],
): string | undefined {
  for (const item of items) {
    const value = 'group' in item ? item.items[0]?.value : item.value;
    if (value != null) return value;
  }
  return undefined;
}

/**
 * Implicit-tag search for the source selector. A source's match text is its
 * own label plus the section header it sits under, so the section behaves as
 * a tag: "Billing" returns every source under the Billing header, and
 * "Billing Logs" returns the logs in that section, including ones whose name
 * lacks "Billing" (e.g. "Refund Logs"). Tokens are AND-ed and results stay
 * grouped so the matched header explains why each result is there. The signal
 * kind is deliberately not part of the haystack; only name and section match.
 */
export const sourceSelectFilter: OptionsFilter = ({
  options,
  search,
  limit,
}) => {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const matches = (label: string, groupLabel?: string) =>
    tokens.every(token =>
      `${label} ${groupLabel ?? ''}`.toLowerCase().includes(token),
    );

  // Honor Mantine's `limit` (Infinity unless a caller sets it) over the total
  // options across all groups, keeping the group structure intact.
  const result: typeof options = [];
  let remaining = limit;
  for (const option of options) {
    if (remaining <= 0) break;
    if ('group' in option) {
      const matched = tokens.length
        ? option.items.filter(item => matches(item.label, option.group))
        : option.items;
      const items = matched.slice(0, remaining);
      if (items.length > 0) {
        result.push({ ...option, items });
        remaining -= items.length;
      }
    } else if (!tokens.length || matches(option.label)) {
      result.push(option);
      remaining -= 1;
    }
  }
  return result;
};
