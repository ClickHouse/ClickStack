import { Types } from 'mongoose';

import * as config from '@/config';
import { getSlo, getSloQueryContext, listSlos } from '@/controllers/slo';
import { getSloAlerts } from '@/controllers/sloAlert';
import { computeSloStatusNow } from '@/controllers/sloStatus';
import { AlertState } from '@/models/alert';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

jest.mock('@/controllers/slo', () => ({
  ...jest.requireActual('@/controllers/slo'),
  listSlos: jest.fn(),
  getSlo: jest.fn(),
  getSloQueryContext: jest.fn(),
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
    const slosTools = ['clickstack_get_slo'];
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
});
