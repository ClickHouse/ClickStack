import { Types } from 'mongoose';

import * as config from '@/config';
import {
  createSlo,
  deleteSlo,
  getSlo,
  getSloQueryContext,
  listSlos,
  runSloQuery,
  updateSlo,
} from '@/controllers/slo';
import { getSloAlerts } from '@/controllers/sloAlert';
import { computeSloStatusNow } from '@/controllers/sloStatus';
import { AlertState } from '@/models/alert';
import { Api400Error } from '@/utils/errors';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

jest.mock('@/controllers/slo', () => ({
  ...jest.requireActual('@/controllers/slo'),
  listSlos: jest.fn(),
  getSlo: jest.fn(),
  getSloQueryContext: jest.fn(),
  runSloQuery: jest.fn(),
  createSlo: jest.fn(),
  updateSlo: jest.fn(),
  deleteSlo: jest.fn(),
}));
jest.mock('@/controllers/sloAlert', () => ({ getSloAlerts: jest.fn() }));
jest.mock('@/controllers/sloStatus', () => ({
  computeSloStatusNow: jest.fn(),
}));

const sloId = new Types.ObjectId();
const slo: any = {
  _id: sloId,
  version: 1,
  team: new Types.ObjectId(),
  name: 'Checkout availability',
  tags: ['checkout'],
  source: new Types.ObjectId(),
  indicator: {
    template: 'availability',
    eligible: { where: "SpanKind = 'Server'", whereLanguage: 'sql' },
    good: "StatusCode != 'Error'",
  },
  target: 99.5,
  window: '30d',
  alerts: { fastBurn: { channels: [{ type: 'webhook', webhookId: 'w' }] } },
  status: {
    state: 'burning',
    sli: 0.99,
    budgetRemaining: 0.4,
    burn: [{ window: '1h', burnRate: 20 }],
  },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

// An SQL where clause and SQL filters render without reading metadata.
const queryContext: any = {
  source: {
    id: 'source-1',
    kind: 'trace',
    connection: 'connection-1',
    from: { databaseName: 'otel', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
  },
  clickhouseClient: {},
  metadata: {},
};

const connect = () =>
  createTestClient({ teamId: slo.team.toString(), userId: 'user-id' });

const toolNames = async () =>
  (await (await connect()).listTools()).tools.map(tool => tool.name);

describe('MCP SLO tool', () => {
  let slosEnabled: jest.ReplaceProperty<boolean>;

  beforeEach(() => {
    slosEnabled = jest.replaceProperty(config, 'IS_SLOS_ENABLED', true);
    jest.mocked(listSlos).mockResolvedValue([slo]);
    jest.mocked(getSlo).mockResolvedValue(slo);
    jest.mocked(getSloQueryContext).mockResolvedValue(queryContext);
    jest.mocked(getSloAlerts).mockResolvedValue(
      new Map([
        [
          sloId.toString(),
          {
            fastBurn: {
              id: 'alert-1',
              state: AlertState.ALERT,
              silencedUntil: null,
            },
          },
        ],
      ]),
    );
  });

  afterEach(() => slosEnabled.restore());

  it('is only registered while SLOs are enabled', async () => {
    const slosTools = [
      'clickstack_get_slo',
      'clickstack_preview_slo',
      'clickstack_save_slo',
      'clickstack_delete_slo',
    ];
    expect(await toolNames()).toEqual(expect.arrayContaining(slosTools));
    slosEnabled.replaceValue(false);
    const names = await toolNames();
    expect(slosTools.filter(name => names.includes(name))).toEqual([]);
  });

  it('lists SLOs as a summary, filtered by state', async () => {
    const client = await connect();
    const all = JSON.parse(
      getFirstText(await callTool(client, 'clickstack_get_slo')),
    );
    expect(all).toEqual([
      {
        id: sloId.toString(),
        name: 'Checkout availability',
        tags: ['checkout'],
        target: 99.5,
        window: '30d',
        groupBy: null,
        state: 'burning',
        sli: 0.99,
        budgetRemaining: 0.4,
        burnRate: 20,
        alertStates: { fastBurn: AlertState.ALERT, slowBurn: null },
      },
    ]);
    const healthy = JSON.parse(
      getFirstText(
        await callTool(client, 'clickstack_get_slo', { state: 'healthy' }),
      ),
    );
    expect(healthy).toEqual([]);
  });

  it('returns one SLO with its status as of now and the query for its bad events', async () => {
    const live = {
      ...slo.status,
      state: 'healthy',
      burn: [{ window: '1h', burnRate: 1 }],
    };
    jest.mocked(computeSloStatusNow).mockResolvedValue(live);
    const result = await callTool(await connect(), 'clickstack_get_slo', {
      id: sloId.toString(),
    });
    const detail = JSON.parse(getFirstText(result));
    expect(detail).toEqual(
      expect.objectContaining({
        id: sloId.toString(),
        indicator: slo.indicator,
        alerts: slo.alerts,
        alertStates: {
          fastBurn: {
            id: 'alert-1',
            state: AlertState.ALERT,
            silencedUntil: null,
          },
        },
        status: live,
        statusSource: 'live',
        // One where clause, which is all clickstack_search takes.
        badEventsWhere:
          "(SpanKind = 'Server') AND (NOT ifNull((StatusCode != 'Error'), 0))",
      }),
    );
    // Read for the calling team only.
    expect(getSlo).toHaveBeenCalledWith(slo.team.toString(), sloId.toString());
  });

  it('scopes the bad events of a grouped SLO to one group', async () => {
    jest
      .mocked(getSlo)
      .mockResolvedValue({ ...slo, groupBy: "ResourceAttributes['k8s.ns']" });
    jest.mocked(computeSloStatusNow).mockResolvedValue(slo.status);
    const url = jest.replaceProperty(config, 'FRONTEND_URL', 'http://app');
    try {
      const result = await callTool(await connect(), 'clickstack_get_slo', {
        id: sloId.toString(),
        group: "o'brien",
      });
      expect(JSON.parse(getFirstText(result))).toEqual(
        expect.objectContaining({
          groupBy: "ResourceAttributes['k8s.ns']",
          badEventsWhere:
            "(SpanKind = 'Server') AND " +
            "(toString(ResourceAttributes['k8s.ns']) = 'o''brien') AND " +
            "(NOT ifNull((StatusCode != 'Error'), 0))",
          url: `http://app/slos/${sloId}?group=o%27brien`,
        }),
      );
    } finally {
      url.restore();
    }
  });

  it('refuses a group for an SLO that is not grouped', async () => {
    const result = await callTool(await connect(), 'clickstack_get_slo', {
      id: sloId.toString(),
      group: 'checkout',
    });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not grouped');
  });

  it('falls back to the stored status when computing it fails', async () => {
    jest
      .mocked(computeSloStatusNow)
      .mockRejectedValue(new Error('Timeout error'));
    const result = await callTool(await connect(), 'clickstack_get_slo', {
      id: sloId.toString(),
    });
    expect(JSON.parse(getFirstText(result))).toEqual(
      expect.objectContaining({
        status: slo.status,
        statusSource: 'stored',
      }),
    );
  });

  it('reports a malformed or unknown id', async () => {
    const client = await connect();
    const malformed = await callTool(client, 'clickstack_get_slo', {
      id: 'nope',
    });
    expect(malformed.isError).toBe(true);
    expect(getFirstText(malformed)).toContain('Invalid SLO ID');

    jest.mocked(getSlo).mockResolvedValue(null);
    const unknown = await callTool(client, 'clickstack_get_slo', {
      id: new Types.ObjectId().toString(),
    });
    expect(unknown.isError).toBe(true);
    expect(getFirstText(unknown)).toContain('SLO not found');
  });

  describe('write tools', () => {
    // Call counts start from zero; the stubs set up above stay.
    beforeEach(() => jest.clearAllMocks());

    const definition = {
      name: 'Checkout availability',
      source: new Types.ObjectId().toString(),
      indicator: {
        template: 'availability',
        eligible: { where: "SpanKind = 'Server'", whereLanguage: 'sql' },
        good: "StatusCode != 'Error'",
      },
      target: 99.5,
      window: '30d',
    };

    it('saves each SLO of a batch on its own and says which failed', async () => {
      const created = new Types.ObjectId();
      jest
        .mocked(createSlo)
        .mockResolvedValueOnce({ ...slo, _id: created })
        .mockRejectedValueOnce(
          new Api400Error("The SLO's query failed: Unknown identifier"),
        );
      jest.mocked(updateSlo).mockResolvedValueOnce(null);
      const result = await callTool(await connect(), 'clickstack_save_slo', {
        slos: [
          definition,
          {
            ...definition,
            target: 100,
            indicator: { ...definition.indicator, good: '' },
          },
          { ...definition, name: 'Broken query' },
          { ...definition, id: new Types.ObjectId().toString() },
          { ...definition, id: 'nope' },
        ],
      });
      const body = JSON.parse(getFirstText(result));
      expect(body).toMatchObject({ saved: 1, failed: 4 });
      expect(body.results).toEqual([
        expect.objectContaining({ index: 0, ok: true, id: created.toString() }),
        {
          index: 1,
          ok: false,
          error: 'Invalid SLO definition',
          issues: expect.arrayContaining([
            {
              path: 'indicator.good',
              message: 'A good-event condition is required',
            },
            { path: 'target', message: 'Target must be below 100%' },
          ]),
        },
        {
          index: 2,
          ok: false,
          error: "The SLO's query failed: Unknown identifier",
        },
        { index: 3, ok: false, error: 'SLO not found' },
        { index: 4, ok: false, error: 'Invalid SLO ID' },
      ]);
      // For the calling team and user, with the schema's defaults.
      expect(createSlo).toHaveBeenCalledWith(
        slo.team.toString(),
        'user-id',
        expect.objectContaining({ version: 1, tags: [], target: 99.5 }),
      );
    });

    it('deletes an SLO of the calling team', async () => {
      const id = sloId.toString();
      jest
        .mocked(deleteSlo)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const client = await connect();
      const deleted = await callTool(client, 'clickstack_delete_slo', { id });
      expect(JSON.parse(getFirstText(deleted))).toEqual({ deleted: true, id });
      expect(deleteSlo).toHaveBeenCalledWith(slo.team.toString(), id);
      const missing = await callTool(client, 'clickstack_delete_slo', { id });
      expect(missing.isError).toBe(true);
      expect(getFirstText(missing)).toContain('SLO not found');
    });

    it('previews a definition over its window without saving it', async () => {
      // Enough metadata to render the counts query's SQL.
      const metadata = {
        getColumns: jest.fn().mockResolvedValue([]),
        getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
        getColumn: jest.fn().mockResolvedValue(undefined),
        getTableMetadata: jest
          .fn()
          .mockResolvedValue({ primary_key: 'Timestamp' }),
        getSkipIndices: jest.fn().mockResolvedValue([]),
        getSetting: jest.fn().mockResolvedValue(undefined),
        isClickHouseCloud: jest.fn().mockResolvedValue(false),
      };
      jest
        .mocked(getSloQueryContext)
        .mockResolvedValue({ ...queryContext, metadata });
      jest.mocked(runSloQuery).mockImplementation(async (_ctx, config) => {
        const aliases = JSON.stringify(config.select);
        const rows = aliases.includes('slo_group_count')
          ? [{ slo_group_count: '120' }]
          : aliases.includes('slo_eligible')
            ? [{ slo_eligible: '1000', slo_good: '990' }]
            : [{ slo_total: '1500' }];
        return { rows, rowsRead: 0, durationMs: 0 };
      });
      const client = await connect();
      const { name: _name, ...unnamed } = definition;
      const result = await callTool(client, 'clickstack_preview_slo', {
        definition: { ...unnamed, groupBy: 'ServiceName' },
      });
      expect(JSON.parse(getFirstText(result))).toEqual(
        expect.objectContaining({
          eligible: 1000,
          good: 990,
          bad: 10,
          excluded: 500,
          sli: 0.99,
          // 10 bad events against a budget of 5.
          budgetRemaining: expect.closeTo(-1),
          groupCount: 120,
          trackedGroups: 100,
          sql: expect.stringContaining("StatusCode != 'Error'"),
        }),
      );
      expect(createSlo).not.toHaveBeenCalled();

      const invalid = await callTool(client, 'clickstack_preview_slo', {
        definition: { ...definition, window: '90d' },
      });
      expect(invalid.isError).toBe(true);
      expect(getFirstText(invalid)).toContain('window');
    });
  });
});
