/**
 * Reference variables are dashboard variables whose value is the ID of a
 * workspace object: a data source variable selects a source, a connection
 * variable selects a connection. Tiles and filters reference them as `$name`
 * in the fields that otherwise hold that ID.
 */
import {
  getAdhocFilterSourceKinds,
  isConnectionFilter,
  isDataSourceFilter,
  isReferenceVariableFilter,
  pairWithVariableNames,
  QUERY_EXPRESSION_FILTER_SOURCE_KINDS,
} from '@/filters';
import {
  ConnectionDashboardFilter,
  DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED,
  DashboardFilter,
  DataSourceDashboardFilter,
  NON_PROMQL_SOURCE_KINDS,
  SourceKind,
} from '@/types';

/**
 * The variable name a field references, if it holds a `$name` reference
 * rather than an ID. The whole field is the token.
 */
export function parseVariableReference(
  value: string | undefined | null,
): string | undefined {
  if (!value?.startsWith('$')) return undefined;
  const name = value.slice(1);
  return DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED.test(name) ? name : undefined;
}

export function toVariableReference(name: string): string {
  return `$${name}`;
}

/** A field's value, read without assuming the object's shape. */
function getField(object: object, field: string): unknown {
  return field in object ? Reflect.get(object, field) : undefined;
}

/** A field's value when it is a string; undefined when absent or not a string. */
export function getStringField(
  object: object,
  field: string,
): string | undefined {
  const value = getField(object, field);
  return typeof value === 'string' ? value : undefined;
}

/**
 * An object's name, or the reference itself for a variable reference.
 * Undefined when no object has the ID.
 */
export function getObjectName(
  id: string,
  objects: readonly { id: string; name: string }[] | undefined,
): string | undefined {
  if (parseVariableReference(id) != null) return id;
  return objects?.find(object => object.id === id)?.name;
}

/** Selected ID per reference variable name; undefined when unselected. */
export type ReferenceVariableValues = ReadonlyMap<string, string | undefined>;

/** A data source variable's identity, as offered by source pickers. */
export type SourceVariableDeclaration = {
  name: string;
  allowedSourceKinds: SourceKind[];
  /** A connection ID or connection variable reference the sources are limited to. */
  connection?: string;
};

/**
 * The kinds a data source variable can resolve to that a field accepting
 * `acceptedKinds` cannot use.
 */
export function getUnacceptedSourceKinds(
  variable: Pick<SourceVariableDeclaration, 'allowedSourceKinds'>,
  acceptedKinds: readonly SourceKind[],
): SourceKind[] {
  return variable.allowedSourceKinds.filter(
    kind => !acceptedKinds.includes(kind),
  );
}

/**
 * Whether a field accepting `acceptedKinds` can use a data source variable,
 * whatever source it selects.
 */
export function isSourceVariableAccepted(
  variable: Pick<SourceVariableDeclaration, 'allowedSourceKinds'>,
  acceptedKinds: readonly SourceKind[],
): boolean {
  return getUnacceptedSourceKinds(variable, acceptedKinds).length === 0;
}

/** `isSourceVariableAccepted` for the variable that `source` references. */
export function isSourceVariableReferenceAccepted(
  source: string | undefined,
  declarations: SourceVariableDeclaration[],
  acceptedKinds: readonly SourceKind[],
): boolean {
  const name = parseVariableReference(source);
  const variable = declarations.find(v => v.name === name);
  return variable != null && isSourceVariableAccepted(variable, acceptedKinds);
}

/**
 * Whether a data source variable can select `source`. `connection` is the
 * variable's connection already resolved; a still unresolved reference
 * matches no source.
 */
export function isSourceOfferedByVariable(
  source: { kind: SourceKind; connection: string; disabled?: boolean },
  variable: Pick<
    SourceVariableDeclaration,
    'allowedSourceKinds' | 'connection'
  >,
): boolean {
  return (
    !source.disabled &&
    variable.allowedSourceKinds.includes(source.kind) &&
    (!variable.connection || source.connection === variable.connection)
  );
}

/** The data source variables a dashboard declares, in filter order. */
export function getSourceVariableFilters(
  filters: DashboardFilter[] | undefined,
): { filter: DataSourceDashboardFilter; name: string }[] {
  return pairWithVariableNames((filters ?? []).filter(isDataSourceFilter));
}

/** The connection variables a dashboard declares, in filter order. */
export function getConnectionVariableFilters(
  filters: DashboardFilter[] | undefined,
): { filter: ConnectionDashboardFilter; name: string }[] {
  return pairWithVariableNames((filters ?? []).filter(isConnectionFilter));
}

/**
 * The data source and connection variables a dashboard declares, in filter
 * order. Structural so the external API's filter shape fits too.
 */
export function getReferenceVariableFilters<
  T extends {
    type: DashboardFilter['type'];
    name: string;
    variableName?: string;
  },
>(
  filters: T[] | undefined,
): {
  filter: Extract<T, { type: 'DATA_SOURCE' | 'CONNECTION' }>;
  name: string;
}[] {
  return pairWithVariableNames(
    (filters ?? []).filter(isReferenceVariableFilter),
  );
}

export function getSourceVariableDeclarations(
  filters: DashboardFilter[] | undefined,
): SourceVariableDeclaration[] {
  return getSourceVariableFilters(filters).map(({ filter, name }) => ({
    name,
    allowedSourceKinds: filter.allowedSourceKinds,
    connection: filter.connection,
  }));
}

export function getConnectionVariableNames(
  filters: DashboardFilter[] | undefined,
): string[] {
  return getConnectionVariableFilters(filters).map(({ name }) => name);
}

/**
 * Resolve a field: an ID passes through, a reference resolves to the
 * variable's selection (undefined while unselected).
 */
export function resolveVariableReference(
  value: string | undefined,
  values: ReferenceVariableValues | undefined,
): string | undefined {
  const name = parseVariableReference(value);
  if (name == null) return value;
  return values?.get(name);
}

/**
 * A field that can hold a reference variable reference: what it may reference,
 * and, for a source field, the source kinds it accepts.
 */
export type ReferenceField<K extends string> =
  | { key: K; target: 'source'; acceptedKinds: readonly SourceKind[] }
  | { key: K; target: 'connection' };

/** The fields of a chart config that can hold a reference. */
export function getConfigReferenceFields(
  config: object,
): ReferenceField<'source' | 'connection'>[] {
  const isPromql = getStringField(config, 'configType') === 'promql';
  return [
    {
      key: 'source',
      target: 'source',
      acceptedKinds: isPromql ? [SourceKind.Promql] : NON_PROMQL_SOURCE_KINDS,
    },
    { key: 'connection', target: 'connection' },
  ];
}

/** The fields of a filter that can hold a reference. */
export function getFilterReferenceFields(
  filter: DashboardFilter,
): ReferenceField<
  'source' | 'sources' | 'appliesToSourceIds' | 'connection'
>[] {
  switch (filter.type) {
    case 'QUERY_EXPRESSION':
      return (['source', 'appliesToSourceIds'] as const).map(key => ({
        key,
        target: 'source',
        acceptedKinds: QUERY_EXPRESSION_FILTER_SOURCE_KINDS,
      }));
    case 'PROMETHEUS_LABEL':
      return [
        { key: 'source', target: 'source', acceptedKinds: [SourceKind.Promql] },
      ];
    case 'ADHOC':
      return (['sources', 'appliesToSourceIds'] as const).map(key => ({
        key,
        target: 'source',
        acceptedKinds: getAdhocFilterSourceKinds(filter.sourceType),
      }));
    case 'DATA_SOURCE':
      return [{ key: 'connection', target: 'connection' }];
    case 'STATIC_LIST':
    case 'CONNECTION':
      return [];
    default:
      filter satisfies never;
      return [];
  }
}

/** A field's references and IDs: one for a string field, each entry of a list. */
export function getReferenceFieldValues(object: object, key: string): string[] {
  const value = getField(object, key);
  if (typeof value === 'string') return [value];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

/** Each field's value with `resolve` applied, keeping strings and lists as such. */
function mapReferenceFields<T extends object>(
  object: T,
  keys: readonly string[],
  resolve: (value: string) => string,
): T {
  let mapped = object;
  for (const key of keys) {
    const value = getField(object, key);
    if (typeof value === 'string') {
      const next = resolve(value);
      if (next !== value) mapped = { ...mapped, [key]: next };
    } else if (Array.isArray(value)) {
      const next = value.map(v => (typeof v === 'string' ? resolve(v) : v));
      if (next.some((v, i) => v !== value.at(i))) {
        mapped = { ...mapped, [key]: next };
      }
    }
  }
  return mapped;
}

/** The variables named by references in the given fields, deduplicated. */
function getReferencedVariables(
  object: object,
  keys: readonly string[],
): string[] {
  return Array.from(
    new Set(
      keys
        .flatMap(key => getReferenceFieldValues(object, key))
        .map(parseVariableReference)
        .filter((name): name is string => name != null),
    ),
  );
}

/** The reference variables a chart config's `source` and `connection` name. */
export function getConfigReferenceVariables(config: object): string[] {
  return getReferencedVariables(
    config,
    getConfigReferenceFields(config).map(({ key }) => key),
  );
}

/** Whether a chart config's source or connection is a variable reference. */
export function configUsesReferenceVariable(config: object): boolean {
  return getConfigReferenceVariables(config).length > 0;
}

/**
 * Replace the references in a config's `source` and `connection` with the
 * selected IDs. An unselected reference is left as written. Returns `config`
 * itself when nothing changes.
 */
export function resolveConfigReferences<T extends object>(
  config: T,
  values: ReferenceVariableValues | undefined,
): T {
  return mapReferenceFields(
    config,
    getConfigReferenceFields(config).map(({ key }) => key),
    value => resolveVariableReference(value, values) || value,
  );
}

/**
 * The inverse of `resolveConfigReferences`: put the references `stored` holds
 * back on a config derived from its resolved form.
 */
export function restoreConfigReferences<T extends object>(
  config: T,
  stored: object,
): T {
  let restored = config;
  for (const { key } of getConfigReferenceFields(stored)) {
    const value = getStringField(stored, key);
    if (parseVariableReference(value) != null && key in config) {
      restored = { ...restored, [key]: value };
    }
  }
  return restored;
}

/**
 * Replace the references in a filter's source and connection fields with the
 * selected IDs. An unselected reference is left as written, so it matches no
 * tile's source rather than widening a list to every tile, and is reported in
 * `unresolvedVariables`.
 */
export function resolveFilterReferences<T extends DashboardFilter>(
  filter: T,
  values: ReferenceVariableValues | undefined,
): { filter: T; unresolvedVariables: string[] } {
  const keys = getFilterReferenceFields(filter).map(({ key }) => key);
  return {
    filter: mapReferenceFields(
      filter,
      keys,
      value => resolveVariableReference(value, values) || value,
    ),
    unresolvedVariables: getReferencedVariables(filter, keys).filter(
      name => !values?.get(name),
    ),
  };
}
