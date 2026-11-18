import {
  getAdhocFilterSourceKinds,
  isAdhocFilter,
  isPrometheusLabelFilter,
  isSqlQueryFilter,
  SQL_QUERY_FILTER_SOURCE_KINDS,
} from '@hyperdx/common-utils/dist/filters';
import { parseVariableReference } from '@hyperdx/common-utils/dist/referenceVariables';
import { DashboardFilter, SourceKind } from '@hyperdx/common-utils/dist/types';

/** A filter as stored or as sent on create, when it has no ID yet. */
type FilterWithOptionalId<T = DashboardFilter> = T extends unknown
  ? Omit<T, 'id'> & { id?: string }
  : never;

/** A source a reference points at, and the kinds it must be. */
export type SourceRef = {
  id: string;
  kinds: SourceKind[];
  /** The connection the source must be on, when the filter has its own. */
  connection?: string;
};

/** The sources a filter reads from, each with the kinds it must be. */
function getFilterSourceRefs(filter: FilterWithOptionalId): SourceRef[] {
  if (isPrometheusLabelFilter(filter)) {
    return [{ id: filter.source, kinds: [SourceKind.Promql] }];
  }
  if (isAdhocFilter(filter)) {
    const kinds = getAdhocFilterSourceKinds(filter.sourceType);
    return [...filter.sources, ...(filter.appliesToSourceIds ?? [])].map(
      id => ({ id, kinds }),
    );
  }
  if (isSqlQueryFilter(filter) && filter.source) {
    return [
      {
        id: filter.source,
        kinds: SQL_QUERY_FILTER_SOURCE_KINDS,
        connection: filter.connection,
      },
    ];
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
): SourceRef[] {
  const refKey = ({ id, kinds, connection }: SourceRef) =>
    `${id}:${kinds.join(',')}:${connection ?? ''}`;
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

/** The referenced source IDs that are missing or of the wrong kind, once each. */
export function getInvalidSourceIds(
  refs: SourceRef[],
  sources: { _id: { toString(): string }; kind: SourceKind }[],
): string[] {
  const kindById = new Map(sources.map(s => [s._id.toString(), s.kind]));
  const invalid = refs
    .filter(({ id, kinds }) => {
      const kind = kindById.get(id);
      return kind === undefined || !kinds.includes(kind);
    })
    .map(({ id }) => id);
  return [...new Set(invalid)];
}

/**
 * An error naming the referenced sources that are missing, of the wrong kind,
 * or not on the connection the filter requires, or null when there are none.
 */
export function getFilterSourceRefError(
  refs: SourceRef[],
  sources: (Parameters<typeof getInvalidSourceIds>[1][number] & {
    connection: { toString(): string };
  })[],
): string | null {
  const invalid = getInvalidSourceIds(refs, sources);
  if (invalid.length > 0) {
    return `The following filter source IDs do not exist or are not a kind of source the filter supports: ${invalid.join(', ')}`;
  }

  const connectionById = new Map(
    sources.map(s => [s._id.toString(), s.connection.toString()]),
  );
  const mismatched = refs
    .filter(
      ({ id, connection }) =>
        connection !== undefined && connectionById.get(id) !== connection,
    )
    .map(({ id }) => id);
  if (mismatched.length === 0) return null;
  return `The following filter source IDs are not on the filter's connection: ${[...new Set(mismatched)].join(', ')}`;
}

/**
 * An error naming SQL_QUERY filters whose source or connection is a variable
 * while it has a source, or null. A source is only offered on a fixed
 * connection, so neither field may change what the other points at.
 */
export function getSqlQueryFilterSourceVariableError(
  filters: FilterWithOptionalId[] = [],
): string | null {
  const invalid = filters
    .filter(isSqlQueryFilter)
    .filter(
      ({ source, connection }) =>
        source != null &&
        (parseVariableReference(source) != null ||
          parseVariableReference(connection) != null),
    )
    .map(({ name }) => name);
  if (invalid.length === 0) return null;
  return `SQL_QUERY filters with a source need a source ID and a connection ID, not variables. The following filters use a variable: ${invalid.join(', ')}`;
}
