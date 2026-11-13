import {
  convertToDashboardTemplate,
  savedChartConfigSupportsAlerts,
} from '@/core/utils';
import { getBlockingRequiredFilterNames } from '@/dashboardFilterValues';
import {
  collectRefinementIssues,
  validateDashboardVariableReferences,
} from '@/dashboardValidation';
import {
  getDashboardVariableDeclarations,
  isReferenceVariableFilterType,
  validateVariableName,
} from '@/filters';
import {
  configUsesReferenceVariable,
  getConfigReferenceVariables,
  getConnectionVariableNames,
  getObjectName,
  getSourceVariableDeclarations,
  isSourceOfferedByVariable,
  isSourceVariableReferenceAccepted,
  parseVariableReference,
  resolveConfigReferences,
  resolveFilterReferences,
  resolveVariableReference,
  restoreConfigReferences,
} from '@/referenceVariables';
import {
  AdhocDashboardFilter,
  ConnectionDashboardFilter,
  DashboardFilter,
  DashboardFilterSchema,
  DataSourceDashboardFilter,
  DisplayType,
  QueryExpressionDashboardFilter,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  SourceKind,
} from '@/types';

const dataSourceFilter = (
  overrides: Partial<DataSourceDashboardFilter> = {},
): DataSourceDashboardFilter => ({
  id: 'ds',
  type: 'DATA_SOURCE',
  name: 'Logs source',
  variableName: 'logs',
  allowedSourceKinds: [SourceKind.Log],
  minSelections: 1,
  maxSelections: 1,
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  ...overrides,
});

const queriedFilter = (
  overrides: Partial<QueryExpressionDashboardFilter> = {},
): QueryExpressionDashboardFilter => ({
  id: 'q',
  type: 'QUERY_EXPRESSION',
  name: 'Service',
  expression: 'ServiceName',
  source: '$logs',
  ...overrides,
});

const connectionFilter = (
  overrides: Partial<ConnectionDashboardFilter> = {},
): ConnectionDashboardFilter => ({
  id: 'conn-filter',
  type: 'CONNECTION',
  name: 'Connection',
  variableName: 'conn',
  minSelections: 1,
  maxSelections: 1,
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  ...overrides,
});

const rawSqlConfig = (
  overrides: Partial<RawSqlSavedChartConfig> = {},
): RawSqlSavedChartConfig => ({
  configType: 'sql',
  displayType: DisplayType.Table,
  sqlTemplate: 'SELECT 1',
  connection: 'conn-1',
  ...overrides,
});

const lineConfig = (source: string): SavedChartConfig => ({
  source,
  displayType: DisplayType.Line,
  select: [{ aggFn: 'count', valueExpression: '' }],
  where: '',
  whereLanguage: 'lucene',
});

describe('DataSourceDashboardFilterSchema', () => {
  it('accepts a data source filter', () => {
    expect(DashboardFilterSchema.safeParse(dataSourceFilter()).success).toBe(
      true,
    );
  });

  it('requires at least one allowed kind', () => {
    expect(
      DashboardFilterSchema.safeParse(
        dataSourceFilter({ allowedSourceKinds: [] }),
      ).success,
    ).toBe(false);
  });

  it('is always single-select and required', () => {
    expect(
      DashboardFilterSchema.safeParse({
        ...dataSourceFilter(),
        maxSelections: undefined,
      }).success,
    ).toBe(false);
    expect(
      DashboardFilterSchema.safeParse({
        ...dataSourceFilter(),
        minSelections: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      DashboardFilterSchema.safeParse({
        ...dataSourceFilter(),
        isGlobalRequirement: true,
      }).success,
    ).toBe(false);
  });
});

describe('parseVariableReference', () => {
  it.each([
    ['$logs', 'logs'],
    ['$Logs_2', 'Logs_2'],
    ['65f1c0ffee0000000000abcd', undefined],
    ['$', undefined],
    ['$1abc', undefined],
    ['x$logs', undefined],
    ['$logs ', undefined],
    [undefined, undefined],
  ])('parses %p as %p', (source, expected) => {
    expect(parseVariableReference(source)).toBe(expected);
  });
});

describe('resolveVariableReference', () => {
  it('passes source IDs through and resolves references', () => {
    expect(resolveVariableReference('abc', new Map([['logs', 'x']]))).toBe(
      'abc',
    );
    expect(resolveVariableReference('$logs', new Map([['logs', 'x']]))).toBe(
      'x',
    );
    expect(resolveVariableReference('$logs', new Map())).toBeUndefined();
    expect(resolveVariableReference(undefined, new Map())).toBeUndefined();
  });
});

describe('resolveConfigReferences', () => {
  const values = new Map([
    ['logs', 'abc'],
    ['conn', 'conn-1'],
  ]);

  it('replaces a source reference with the selected source', () => {
    expect(resolveConfigReferences(lineConfig('$logs'), values)).toEqual(
      lineConfig('abc'),
    );
  });

  it('replaces a connection reference with the selected connection', () => {
    expect(
      resolveConfigReferences(rawSqlConfig({ connection: '$conn' }), values),
    ).toEqual(rawSqlConfig({ connection: 'conn-1' }));
  });

  it('leaves unselected references and IDs as written', () => {
    expect(resolveConfigReferences(lineConfig('$logs'), new Map())).toEqual(
      lineConfig('$logs'),
    );
    expect(resolveConfigReferences(lineConfig('abc'), values)).toEqual(
      lineConfig('abc'),
    );
  });
});

describe('getConfigReferenceVariables', () => {
  it('names the variables a config source and connection reference', () => {
    expect(
      getConfigReferenceVariables(
        rawSqlConfig({ connection: '$conn', source: '$logs' }),
      ),
    ).toEqual(['logs', 'conn']);
    expect(getConfigReferenceVariables(lineConfig('abc'))).toEqual([]);
  });
});

describe('isSourceVariableReferenceAccepted', () => {
  const declarations = [
    { name: 'logs', allowedSourceKinds: [SourceKind.Log] },
    { name: 'any', allowedSourceKinds: [SourceKind.Log, SourceKind.Promql] },
  ];

  it('accepts a variable whose every kind the field accepts', () => {
    expect(
      isSourceVariableReferenceAccepted('$logs', declarations, [
        SourceKind.Log,
        SourceKind.Trace,
      ]),
    ).toBe(true);
  });

  it('rejects a variable offering a kind the field does not accept', () => {
    expect(
      isSourceVariableReferenceAccepted('$any', declarations, [SourceKind.Log]),
    ).toBe(false);
  });

  it('rejects an unknown variable and a source ID', () => {
    expect(
      isSourceVariableReferenceAccepted('$nope', declarations, [
        SourceKind.Log,
      ]),
    ).toBe(false);
    expect(
      isSourceVariableReferenceAccepted('abc', declarations, [SourceKind.Log]),
    ).toBe(false);
  });
});

describe('resolveFilterReferences', () => {
  it('resolves source and appliesToSourceIds', () => {
    const { filter, unresolvedVariables } = resolveFilterReferences(
      queriedFilter({ appliesToSourceIds: ['$logs', 'other'] }),
      new Map([['logs', 'abc']]),
    );
    expect(filter.source).toBe('abc');
    expect(filter.appliesToSourceIds).toEqual(['abc', 'other']);
    expect(unresolvedVariables).toEqual([]);
  });

  it('leaves unselected references as written so they match no tile', () => {
    const adhoc: AdhocDashboardFilter = {
      id: 'a',
      type: 'ADHOC',
      name: 'Conditions',
      sourceType: 'sql',
      sources: ['$logs'],
      isVariableEnabled: true,
    };
    const { filter, unresolvedVariables } = resolveFilterReferences(
      adhoc,
      new Map(),
    );
    expect(filter.sources).toEqual(['$logs']);
    expect(unresolvedVariables).toEqual(['logs']);
  });
});

describe('dashboard variable declarations', () => {
  it('keeps the first of two variables sharing a name', () => {
    expect(
      getSourceVariableDeclarations([
        dataSourceFilter(),
        dataSourceFilter({
          id: 'ds2',
          allowedSourceKinds: [SourceKind.Trace],
        }),
      ]),
    ).toEqual([
      {
        name: 'logs',
        allowedSourceKinds: [SourceKind.Log],
        connection: undefined,
      },
    ]);
  });

  it('keeps reference variables out of text variables', () => {
    const filters: DashboardFilter[] = [dataSourceFilter(), connectionFilter()];
    expect(getDashboardVariableDeclarations(filters)).toEqual([]);
    expect(getSourceVariableDeclarations(filters)).toEqual([
      { name: 'logs', allowedSourceKinds: [SourceKind.Log] },
    ]);
    expect(getConnectionVariableNames(filters)).toEqual(['conn']);
  });

  it('shares the variable name namespace with other filters', () => {
    expect(
      validateVariableName({
        value: 'logs',
        otherFilters: [dataSourceFilter()],
      }),
    ).toMatch(/used by another filter/);
  });
});

describe('alerts', () => {
  it('are not supported on tiles that use a connection variable', () => {
    expect(
      savedChartConfigSupportsAlerts(
        rawSqlConfig({ displayType: DisplayType.Line, connection: '$conn' }),
      ),
    ).toBe(false);
  });

  it('are not supported on tiles that use a data source variable', () => {
    expect(configUsesReferenceVariable(lineConfig('$logs'))).toBe(true);
    expect(savedChartConfigSupportsAlerts(lineConfig('$logs'))).toBe(false);
    expect(savedChartConfigSupportsAlerts(lineConfig('abc'))).toBe(true);
  });
});

describe('getBlockingRequiredFilterNames (connections)', () => {
  it('blocks a tile until its connection variable has a selection', () => {
    expect(
      getBlockingRequiredFilterNames({
        config: rawSqlConfig({ connection: '$conn' }),
        sourceId: undefined,
        unsatisfiedRequiredFilters: [connectionFilter()],
        referencedVariables: [],
        referenceVariableNames: ['conn'],
      }),
    ).toEqual(['Connection']);
  });
});

describe('getBlockingRequiredFilterNames', () => {
  it('blocks a tile until its data source variable has a selection', () => {
    const unsatisfied = [dataSourceFilter()];
    expect(
      getBlockingRequiredFilterNames({
        config: lineConfig('$logs'),
        sourceId: undefined,
        unsatisfiedRequiredFilters: unsatisfied,
        referencedVariables: [],
        referenceVariableNames: ['logs'],
      }),
    ).toEqual(['Logs source']);
    expect(
      getBlockingRequiredFilterNames({
        config: lineConfig('abc'),
        sourceId: 'abc',
        unsatisfiedRequiredFilters: unsatisfied,
        referencedVariables: [],
      }),
    ).toEqual([]);
  });
});

describe('validateDashboardVariableReferences', () => {
  const collectIssues = (
    tiles: { config: SavedChartConfig }[],
    filters: DashboardFilter[],
  ) =>
    collectRefinementIssues(ctx =>
      validateDashboardVariableReferences(tiles, filters, ctx),
    );

  it('accepts references to declared variables of compatible kinds', () => {
    expect(
      collectIssues(
        [{ config: lineConfig('$logs') }],
        [dataSourceFilter(), queriedFilter()],
      ),
    ).toEqual([]);
  });

  it('accepts connection references to a declared connection variable', () => {
    expect(
      collectIssues(
        [{ config: rawSqlConfig({ connection: '$conn' }) }],
        [connectionFilter(), dataSourceFilter({ connection: '$conn' })],
      ),
    ).toEqual([]);
  });

  it('rejects a connection reference that names no connection variable', () => {
    const issues = collectIssues(
      [{ config: rawSqlConfig({ connection: '$logs' }) }],
      [dataSourceFilter({ connection: '$nope' })],
    );
    expect(issues.map(issue => issue.path)).toEqual([
      ['tiles', 0, 'config', 'connection'],
      ['filters', 0, 'connection'],
    ]);
  });

  it('rejects a source reference to a connection variable', () => {
    expect(
      collectIssues([{ config: lineConfig('$conn') }], [connectionFilter()]),
    ).toHaveLength(1);
  });

  it('rejects a reference to an unknown variable', () => {
    const issues = collectIssues([{ config: lineConfig('$nope') }], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['tiles', 0, 'config', 'source']);
  });

  it.each<[string, { config: SavedChartConfig }[], DashboardFilter[]]>([
    [
      'a PromQL tile',
      [
        {
          config: {
            configType: 'promql',
            source: '$logs',
            displayType: DisplayType.Line,
            promqlExpression: [{ expression: 'up' }],
          },
        },
      ],
      [],
    ],
    [
      'a PromQL label filter',
      [],
      [
        {
          id: 'p',
          type: 'PROMETHEUS_LABEL',
          name: 'Job',
          source: '$logs',
          label: 'job',
          isBroadcastEnabled: false,
          isVariableEnabled: true,
        },
      ],
    ],
    [
      'an ad hoc filter of another source type',
      [],
      [
        {
          id: 'a',
          type: 'ADHOC',
          name: 'Conditions',
          sourceType: 'promql',
          sources: ['$logs'],
          isVariableEnabled: true,
        },
      ],
    ],
    [
      "a queried filter's applies-to list",
      [],
      [
        queriedFilter({
          source: 'abc',
          appliesToSourceIds: ['$logs'],
        }),
      ],
    ],
  ])(
    'rejects a logs-or-PromQL variable used by %s',
    (_label, tiles, filters) => {
      const issues = collectIssues(tiles, [
        dataSourceFilter({
          allowedSourceKinds: [SourceKind.Log, SourceKind.Promql],
        }),
        ...filters,
      ]);
      expect(issues.length).toBeGreaterThan(0);
    },
  );

  it('rejects a variable offering kinds the field does not accept', () => {
    const issues = collectIssues(
      [],
      [
        dataSourceFilter({
          allowedSourceKinds: [SourceKind.Log, SourceKind.Promql],
        }),
        queriedFilter(),
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['filters', 1, 'source']);
    expect(issues[0].message).toMatch(/promql/);
  });
});

describe('convertToDashboardTemplate (connections)', () => {
  it('keeps connection references and names a data source connection', () => {
    const template = convertToDashboardTemplate(
      {
        id: 'd',
        name: 'Dashboard',
        tags: [],
        tiles: [
          {
            id: 't',
            x: 0,
            y: 0,
            w: 6,
            h: 4,
            config: rawSqlConfig({ connection: '$conn' }),
          },
        ],
        filters: [
          connectionFilter(),
          dataSourceFilter({ connection: 'conn-1' }),
        ],
        savedFilterValues: [{ type: 'variable', name: 'conn', values: ['c'] }],
      },
      [],
      [{ id: 'conn-1', name: 'Primary', host: '', username: '' }],
    );
    expect(template.tiles[0].config).toMatchObject({ connection: '$conn' });
    expect(template.filters?.[1]).toMatchObject({ connection: 'Primary' });
    expect(template.savedFilterValues).toBeUndefined();
  });
});

describe('convertToDashboardTemplate', () => {
  it('keeps references and drops the saved data source selection', () => {
    const template = convertToDashboardTemplate(
      {
        id: 'd',
        name: 'Dashboard',
        tags: [],
        tiles: [
          { id: 't', x: 0, y: 0, w: 6, h: 4, config: lineConfig('$logs') },
        ],
        filters: [dataSourceFilter(), queriedFilter()],
        savedFilterValues: [
          { type: 'variable', name: 'logs', values: ['abc'] },
          { type: 'variable', name: 'env', values: ['prod'] },
        ],
      },
      [],
    );
    expect(template.tiles[0].config).toMatchObject({ source: '$logs' });
    expect(template.filters?.[1]).toMatchObject({ source: '$logs' });
    expect(template.savedFilterValues).toEqual([
      { type: 'variable', name: 'env', values: ['prod'] },
    ]);
  });
});

describe('resolveFilterReferences (connections)', () => {
  it("resolves a data source variable's connection reference", () => {
    expect(
      resolveFilterReferences(
        dataSourceFilter({ connection: '$conn' }),
        new Map([['conn', 'conn-1']]),
      ),
    ).toEqual({
      filter: dataSourceFilter({ connection: 'conn-1' }),
      unresolvedVariables: [],
    });
    expect(
      resolveFilterReferences(
        dataSourceFilter({ connection: '$conn' }),
        new Map(),
      ).unresolvedVariables,
    ).toEqual(['conn']);
  });
});

describe('restoreConfigReferences', () => {
  it('puts stored source and connection references back', () => {
    const stored = rawSqlConfig({ connection: '$conn', source: '$logs' });
    const resolved = resolveConfigReferences(
      stored,
      new Map([
        ['conn', 'conn-1'],
        ['logs', 'abc'],
      ]),
    );
    expect(
      restoreConfigReferences(
        { ...resolved, displayType: DisplayType.Number },
        stored,
      ),
    ).toEqual({ ...stored, displayType: DisplayType.Number });
  });

  it('keeps fields the stored config holds as IDs', () => {
    expect(
      restoreConfigReferences(
        rawSqlConfig({ connection: 'conn-2' }),
        rawSqlConfig({ connection: 'conn-1' }),
      ),
    ).toEqual(rawSqlConfig({ connection: 'conn-2' }));
  });
});

describe('isSourceOfferedByVariable', () => {
  const source = { kind: SourceKind.Log, connection: 'conn-1' };

  it('offers an enabled source of an allowed kind on the variable connection', () => {
    expect(
      isSourceOfferedByVariable(source, {
        allowedSourceKinds: [SourceKind.Log],
        connection: 'conn-1',
      }),
    ).toBe(true);
    expect(
      isSourceOfferedByVariable(source, {
        allowedSourceKinds: [SourceKind.Log],
      }),
    ).toBe(true);
  });

  it.each([
    ['another kind', source, { allowedSourceKinds: [SourceKind.Trace] }],
    [
      'another connection',
      source,
      { allowedSourceKinds: [SourceKind.Log], connection: 'conn-2' },
    ],
    [
      'an unresolved connection reference',
      source,
      { allowedSourceKinds: [SourceKind.Log], connection: '$conn' },
    ],
    [
      'a disabled source',
      { ...source, disabled: true },
      { allowedSourceKinds: [SourceKind.Log] },
    ],
  ])('does not offer %s', (_label, candidate, variable) => {
    expect(isSourceOfferedByVariable(candidate, variable)).toBe(false);
  });
});

describe('getObjectName', () => {
  const objects = [{ id: 'abc', name: 'Logs' }];

  it('names an object, keeps a reference, and is undefined for a missing ID', () => {
    expect(getObjectName('abc', objects)).toBe('Logs');
    expect(getObjectName('$logs', objects)).toBe('$logs');
    expect(getObjectName('nope', objects)).toBeUndefined();
  });
});

describe('isReferenceVariableFilterType', () => {
  it.each([
    ['DATA_SOURCE', true],
    ['CONNECTION', true],
    ['STATIC_LIST', false],
    [undefined, false],
  ] as const)('%p is %p', (type, expected) => {
    expect(isReferenceVariableFilterType(type)).toBe(expected);
  });
});
