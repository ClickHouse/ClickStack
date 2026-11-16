import {
  getAdhocFilterSourceKinds,
  isAdhocFilter,
  isPrometheusLabelFilter,
} from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter, SourceKind } from '@hyperdx/common-utils/dist/types';

/** A filter as stored or as sent on create, when it has no ID yet. */
type FilterWithOptionalId<T = DashboardFilter> = T extends unknown
  ? Omit<T, 'id'> & { id?: string }
  : never;

type FilterSourceRef = { id: string; kinds: SourceKind[] };

/** The sources a filter reads from, each with the kinds it must be. */
function getFilterSourceRefs(filter: FilterWithOptionalId): FilterSourceRef[] {
  if (isPrometheusLabelFilter(filter)) {
    return [{ id: filter.source, kinds: [SourceKind.Promql] }];
  }
  if (isAdhocFilter(filter)) {
    const kinds = getAdhocFilterSourceKinds(filter.sourceType);
    return [...filter.sources, ...(filter.appliesToSourceIds ?? [])].map(
      id => ({ id, kinds }),
    );
  }
  return [];
}

/**
 * The source references in `filters` that the stored filter with the same ID
 * didn't already make, so a since-deleted source doesn't block unrelated saves.
 */
export function getChangedFilterSourceRefs(
  filters: FilterWithOptionalId[] = [],
  existingFilters: DashboardFilter[] = [],
): FilterSourceRef[] {
  const refKey = ({ id, kinds }: FilterSourceRef) => `${id}:${kinds.join(',')}`;
  const existingRefsById = new Map(
    existingFilters.map(filter => [
      filter.id,
      new Set(getFilterSourceRefs(filter).map(refKey)),
    ]),
  );
  return filters.flatMap(filter =>
    getFilterSourceRefs(filter).filter(
      ref =>
        filter.id === undefined ||
        !existingRefsById.get(filter.id)?.has(refKey(ref)),
    ),
  );
}

/**
 * An error naming the referenced sources that are missing or of the wrong
 * kind, or null when there are none.
 */
export function getFilterSourceRefError(
  refs: FilterSourceRef[],
  sources: { _id: { toString(): string }; kind: SourceKind }[],
): string | null {
  const kindById = new Map(sources.map(s => [s._id.toString(), s.kind]));
  const invalid = new Set(
    refs
      .filter(({ id, kinds }) => {
        const kind = kindById.get(id);
        return kind === undefined || !kinds.includes(kind);
      })
      .map(({ id }) => id),
  );
  if (invalid.size === 0) return null;
  return `The following filter source IDs do not exist or are not a kind of source the filter supports: ${[...invalid].join(', ')}`;
}
