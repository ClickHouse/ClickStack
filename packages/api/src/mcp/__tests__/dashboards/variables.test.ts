import { SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import {
  type ReferenceTargets,
  resolveDashboardVariables,
  resolveTileVariableReferences,
  withResolvedFilterVariableNames,
} from '@/mcp/tools/dashboards/variables';
import type {
  ExternalDashboardFilterWithId,
  ExternalDashboardTileWithId,
} from '@/utils/zod';

const sourceId = new mongoose.Types.ObjectId().toString();

function filter(
  overrides: Partial<ExternalDashboardFilterWithId> = {},
): ExternalDashboardFilterWithId {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    type: 'QUERY_EXPRESSION',
    name: 'Service',
    expression: 'ServiceName',
    sourceId,
    whereLanguage: 'sql',
    ...overrides,
  } as ExternalDashboardFilterWithId;
}

const variableFilter = filter({
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  variableName: 'service',
});

function staticFilter(
  overrides: Partial<
    Extract<ExternalDashboardFilterWithId, { type: 'STATIC_LIST' }>
  > = {},
): ExternalDashboardFilterWithId {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    type: 'STATIC_LIST',
    name: 'Environment',
    options: ['prod', 'staging', 'dev'],
    isBroadcastEnabled: false,
    isVariableEnabled: true,
    variableName: 'env',
    ...overrides,
  };
}

describe('resolveDashboardVariables', () => {
  it('returns an empty array for a dashboard with no filters', () => {
    // Empty, not undefined: an empty array still registers $__filter and
    // $__conditionalAll as macros, so a tile using one against a dashboard
    // that declares nothing fails with a message about the variable rather
    // than leaking macro text into ClickHouse.
    expect(resolveDashboardVariables(undefined, undefined)).toEqual({
      variables: [],
    });
    expect(resolveDashboardVariables([], undefined)).toEqual({
      variables: [],
    });
  });

  it('declares nothing for a broadcast-only filter', () => {
    expect(resolveDashboardVariables([filter()], undefined)).toEqual({
      variables: [],
    });
  });

  it('defaults every declared variable to an empty selection', () => {
    expect(resolveDashboardVariables([variableFilter], undefined)).toEqual({
      variables: [{ name: 'service', expression: 'ServiceName', values: [] }],
    });
  });

  it('applies a supplied selection', () => {
    expect(
      resolveDashboardVariables(
        [variableFilter],
        [{ name: 'service', values: ['checkout'] }],
      ),
    ).toEqual({
      variables: [
        { name: 'service', expression: 'ServiceName', values: ['checkout'] },
      ],
    });
  });

  it('leaves variables the caller did not mention empty', () => {
    const env = filter({
      name: 'Environment',
      expression: 'Env',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'env',
    });

    const resolved = resolveDashboardVariables(
      [variableFilter, env],
      [{ name: 'service', values: ['checkout'] }],
    );

    expect(resolved).toEqual({
      variables: [
        { name: 'service', expression: 'ServiceName', values: ['checkout'] },
        { name: 'env', expression: 'Env', values: [] },
      ],
    });
  });

  it('rejects a name the dashboard does not declare', () => {
    const resolved = resolveDashboardVariables(
      [variableFilter],
      [{ name: 'tenant', values: ['acme'] }],
    );

    expect(resolved).toHaveProperty('error');
    if (!('error' in resolved)) throw new Error('expected an error');
    expect(resolved.error).toContain('tenant');
    expect(resolved.error).toContain('Available variables: service');
  });

  it('lists (none) when the dashboard declares no variables at all', () => {
    const resolved = resolveDashboardVariables(
      [filter()],
      [{ name: 'service', values: ['checkout'] }],
    );

    if (!('error' in resolved)) throw new Error('expected an error');
    expect(resolved.error).toContain('Available variables: (none)');
  });

  it('rejects several values for a single-select variable', () => {
    const resolved = resolveDashboardVariables(
      [staticFilter({ maxSelections: 1 })],
      [{ name: 'env', values: ['prod', 'staging'] }],
    );

    if (!('error' in resolved)) throw new Error('expected an error');
    expect(resolved.error).toContain('"env"');
    expect(resolved.error).toContain('single-select');
  });

  it('applies one value to a single-select variable', () => {
    expect(
      resolveDashboardVariables(
        [staticFilter({ maxSelections: 1 })],
        [{ name: 'env', values: ['prod'] }],
      ),
    ).toEqual({
      variables: [
        {
          name: 'env',
          expression: undefined,
          values: ['prod'],
          maxSelections: 1,
        },
      ],
    });
  });

  it('declares a variable for a static filter', () => {
    expect(resolveDashboardVariables([staticFilter()], undefined)).toEqual({
      variables: [{ name: 'env', expression: undefined, values: [] }],
    });
  });

  it('applies a selection within a static filter options', () => {
    expect(
      resolveDashboardVariables(
        [staticFilter()],
        [{ name: 'env', values: ['prod', 'dev'] }],
      ),
    ).toEqual({
      variables: [
        { name: 'env', expression: undefined, values: ['prod', 'dev'] },
      ],
    });
  });

  it('accepts an empty selection for a static filter', () => {
    expect(
      resolveDashboardVariables(
        [staticFilter()],
        [{ name: 'env', values: [] }],
      ),
    ).toEqual({
      variables: [{ name: 'env', expression: undefined, values: [] }],
    });
  });

  it('rejects a value outside a static filter options', () => {
    const resolved = resolveDashboardVariables(
      [staticFilter()],
      [{ name: 'env', values: ['prod', 'prod-2'] }],
    );

    if (!('error' in resolved)) throw new Error('expected an error');
    expect(resolved.error).toContain('"env"');
    expect(resolved.error).toContain('"prod-2"');
    expect(resolved.error).not.toContain('"prod"');
    expect(resolved.error).toContain('prod, staging, dev');
  });

  it('collects every offending variable into one error', () => {
    const tier = staticFilter({
      name: 'Tier',
      options: ['free', 'paid'],
      variableName: 'tier',
    });

    const resolved = resolveDashboardVariables(
      [staticFilter(), tier],
      [
        { name: 'env', values: ['nope'] },
        { name: 'tier', values: ['enterprise'] },
      ],
    );

    if (!('error' in resolved)) throw new Error('expected an error');
    expect(resolved.error).toContain('"env"');
    expect(resolved.error).toContain('"tier"');
  });

  it('leaves query-expression variables unconstrained', () => {
    expect(
      resolveDashboardVariables(
        [variableFilter],
        [{ name: 'service', values: ['anything-at-all'] }],
      ),
    ).toEqual({
      variables: [
        {
          name: 'service',
          expression: 'ServiceName',
          values: ['anything-at-all'],
        },
      ],
    });
  });

  it('truncates the options preview in the error', () => {
    const options = Array.from({ length: 25 }, (_, i) => `opt${i}`);
    const resolved = resolveDashboardVariables(
      [staticFilter({ options })],
      [{ name: 'env', values: ['nope'] }],
    );

    if (!('error' in resolved)) throw new Error('expected an error');
    expect(resolved.error).toContain('… and 5 more');
    expect(resolved.error).not.toContain('opt24');
  });

  it('polices the options of the filter that owns a duplicated name', () => {
    const shadowed = staticFilter({ variableName: 'service' });
    expect(
      resolveDashboardVariables(
        [variableFilter, shadowed],
        [{ name: 'service', values: ['not-an-option'] }],
      ),
    ).toEqual({
      variables: [
        {
          name: 'service',
          expression: 'ServiceName',
          values: ['not-an-option'],
        },
      ],
    });
  });

  it('lets the last entry win on a repeated name', () => {
    const resolved = resolveDashboardVariables(
      [variableFilter],
      [
        { name: 'service', values: ['a'] },
        { name: 'service', values: ['b'] },
      ],
    );

    expect(resolved).toEqual({
      variables: [
        { name: 'service', expression: 'ServiceName', values: ['b'] },
      ],
    });
  });
});

describe('withResolvedFilterVariableNames', () => {
  it('leaves a broadcast-only filter untouched', () => {
    const broadcastOnly = filter();
    expect(withResolvedFilterVariableNames([broadcastOnly])).toEqual([
      broadcastOnly,
    ]);
  });

  it('leaves an explicit variableName untouched', () => {
    expect(withResolvedFilterVariableNames([variableFilter])).toEqual([
      variableFilter,
    ]);
  });

  it('fills in the name derived from the display name when omitted', () => {
    const noExplicitName = filter({
      name: 'Service Name',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: undefined,
    });

    expect(withResolvedFilterVariableNames([noExplicitName])).toEqual([
      { ...noExplicitName, variableName: 'Service_Name' },
    ]);
  });

  it('fills in the derived name on a static filter', () => {
    const noExplicitName = staticFilter({
      name: 'Deploy Env',
      variableName: undefined,
    });

    expect(withResolvedFilterVariableNames([noExplicitName])).toEqual([
      { ...noExplicitName, variableName: 'Deploy_Env' },
    ]);
  });
});

describe('resolveTileVariableReferences', () => {
  const objectId = () => new mongoose.Types.ObjectId().toString();
  const connectionId = objectId();
  const traceSourceId = objectId();
  const targets: ReferenceTargets = {
    sources: [
      { id: traceSourceId, kind: SourceKind.Trace, connection: connectionId },
    ],
    connectionIds: new Set([connectionId]),
  };

  const referenceVariableFields = {
    minSelections: 1,
    maxSelections: 1,
    isBroadcastEnabled: false,
    isVariableEnabled: true,
  } as const;
  const connectionVariable: ExternalDashboardFilterWithId = {
    ...referenceVariableFields,
    id: objectId(),
    type: 'CONNECTION',
    name: 'Connection',
    variableName: 'conn',
  };
  const tracesVariable = (
    connection?: string,
  ): ExternalDashboardFilterWithId => ({
    ...referenceVariableFields,
    id: objectId(),
    type: 'DATA_SOURCE',
    name: 'Traces source',
    variableName: 'traces',
    allowedSourceKinds: [SourceKind.Trace],
    connectionId: connection,
  });

  const builderTile: ExternalDashboardTileWithId = {
    id: 'builder',
    name: 'Builder',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    config: {
      displayType: 'number',
      sourceId: '$traces',
      select: [{ aggFn: 'count', where: '' }],
    },
  };
  const rawSqlTile: ExternalDashboardTileWithId = {
    id: 'raw-sql',
    name: 'Raw SQL',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    config: {
      configType: 'sql',
      displayType: 'table',
      connectionId: '$conn',
      sqlTemplate: 'SELECT 1',
    },
  };

  const resolve = (
    tile: ExternalDashboardTileWithId,
    filters: ExternalDashboardFilterWithId[],
    selections: Record<string, string[]>,
  ) =>
    resolveTileVariableReferences(
      tile,
      filters,
      Object.entries(selections).map(([name, values]) => ({ name, values })),
      [],
      targets,
    );

  it("resolves a connection reference to the variable's selection", () => {
    const result = resolve(rawSqlTile, [connectionVariable], {
      conn: [connectionId],
    });

    expect(result).toEqual({
      tile: {
        ...rawSqlTile,
        config: { ...rawSqlTile.config, connectionId },
      },
    });
  });

  it('resolves a source on the connection its connection variable selects', () => {
    const result = resolve(
      builderTile,
      [connectionVariable, tracesVariable('$conn')],
      { conn: [connectionId], traces: [traceSourceId] },
    );

    expect(result).toEqual({
      tile: {
        ...builderTile,
        config: { ...builderTile.config, sourceId: traceSourceId },
      },
    });
  });

  it.each<{
    case: string;
    tile: ExternalDashboardTileWithId;
    filters: ExternalDashboardFilterWithId[];
    selections: Record<string, string[]>;
    variable: string;
  }>([
    {
      case: 'a source selection that is not a source',
      tile: builderTile,
      filters: [tracesVariable()],
      selections: { traces: [connectionId] },
      variable: '$traces',
    },
    {
      case: 'a source variable whose connection variable has no selection',
      tile: builderTile,
      filters: [connectionVariable, tracesVariable('$conn')],
      selections: { traces: [traceSourceId] },
      variable: '$conn',
    },
    {
      case: 'a connection selection that is not a connection',
      tile: rawSqlTile,
      filters: [connectionVariable],
      selections: { conn: [traceSourceId] },
      variable: '$conn',
    },
  ])('rejects $case', ({ tile, filters, selections, variable }) => {
    expect(resolve(tile, filters, selections)).toEqual({
      error: expect.stringContaining(`${variable} variable`),
    });
  });
});
