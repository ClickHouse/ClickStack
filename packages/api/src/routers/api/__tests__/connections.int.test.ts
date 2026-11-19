import { ObjectId } from 'mongodb';
import { Types } from 'mongoose';

import * as config from '@/config';
import { clearBackendProbeCache } from '@/controllers/promql';
import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';

const mockFetch = jest.mocked(global.fetch);

// What the router's `format_query` probe sees from a server that does, or does
// not, have the prometheus_api_v1 handler configured.
const probeAnswer = (status: number, body: string) =>
  new Response(body, { status });

describe('connections router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
    clearBackendProbeCache();
    mockFetch.mockReset();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('only returns connections belonging to the current team through GET /connections', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    await Connection.create({
      team: team._id,
      name: 'My Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });
    await Connection.create({
      team: new ObjectId(),
      name: 'Other Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });

    const res = await agent.get('/connections').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('My Team Connection');
  });

  it('persists isPrometheusEndpoint through POST /connections', async () => {
    const { agent } = await getLoggedInAgent(server);

    const res = await agent
      .post('/connections')
      .send({
        name: 'Prom-enabled',
        host: 'http://thanos:10902',
        username: '',
        password: '',
        isPrometheusEndpoint: true,
      })
      .expect(200);

    const stored = await Connection.findById(res.body.id);
    expect(stored?.host).toBe('http://thanos:10902');
    expect(stored?.isPrometheusEndpoint).toBe(true);
  });

  it('persists isPrometheusEndpoint through PUT /connections/:id', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const created = await Connection.create({
      team: team._id,
      name: 'No-prom',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });

    await agent
      .put(`/connections/${created._id.toString()}`)
      .send({
        id: created._id.toString(),
        name: 'No-prom',
        host: 'http://thanos:10902',
        username: '',
        password: '',
        isPrometheusEndpoint: true,
      })
      .expect(200);

    const stored = await Connection.findById(created._id);
    expect(stored?.host).toBe('http://thanos:10902');
    expect(stored?.isPrometheusEndpoint).toBe(true);
  });

  it('toggles isPrometheusEndpoint back to false through PUT', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const created = await Connection.create({
      team: team._id,
      name: 'Prom',
      host: 'http://thanos:10902',
      username: '',
      password: '',
      isPrometheusEndpoint: true,
    });

    await agent
      .put(`/connections/${created._id.toString()}`)
      .send({
        id: created._id.toString(),
        name: 'Prom',
        host: config.CLICKHOUSE_HOST,
        username: 'default',
        password: '',
        isPrometheusEndpoint: false,
      })
      .expect(200);

    const stored = await Connection.findById(created._id);
    expect(stored?.host).toBe(config.CLICKHOUSE_HOST);
    expect(stored?.isPrometheusEndpoint).toBe(false);
  });

  describe('GET /connections/:id/prometheus-http-api', () => {
    const createClickHouseConnection = (teamId: Types.ObjectId) =>
      Connection.create({
        team: teamId,
        name: 'CH',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });

    it('rejects unauthenticated requests with 401', async () => {
      await getAgent(server)
        .get(`/connections/${new ObjectId().toString()}/prometheus-http-api`)
        .expect(401);
    });

    it('rejects an id that is not an ObjectId with 400', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent.get('/connections/nope/prometheus-http-api').expect(400);
    });

    it("returns 404 for another team's connection", async () => {
      const { agent } = await getLoggedInAgent(server);
      const other = await Connection.create({
        team: new ObjectId(),
        name: 'Other',
        host: config.CLICKHOUSE_HOST,
        username: 'default',
        password: '',
      });

      await agent
        .get(`/connections/${other._id.toString()}/prometheus-http-api`)
        .expect(404);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reports a Prometheus endpoint as not serving it, without probing', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const connection = await Connection.create({
        team: team._id,
        name: 'Thanos',
        host: 'http://thanos:10902',
        username: '',
        password: '',
        isPrometheusEndpoint: true,
      });

      const res = await agent
        .get(`/connections/${connection._id.toString()}/prometheus-http-api`)
        .expect(200);

      expect(res.body).toEqual({ supported: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reports a server with the handler as serving it', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const connection = await createClickHouseConnection(team._id);
      mockFetch.mockResolvedValue(
        probeAnswer(200, JSON.stringify({ status: 'success', data: 'up' })),
      );

      const res = await agent
        .get(`/connections/${connection._id.toString()}/prometheus-http-api`)
        .expect(200);

      expect(res.body).toEqual({ supported: true });
      expect(String(mockFetch.mock.calls[0][0])).toContain(
        '/prometheus/api/v1/format_query',
      );
    });

    it('reports a server without the handler as not serving it', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const connection = await createClickHouseConnection(team._id);
      mockFetch.mockResolvedValue(probeAnswer(404, 'Not found.\n'));

      const res = await agent
        .get(`/connections/${connection._id.toString()}/prometheus-http-api`)
        .expect(200);

      expect(res.body).toEqual({ supported: false });
    });

    it('keeps the answer between requests', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const connection = await createClickHouseConnection(team._id);
      mockFetch.mockResolvedValue(
        probeAnswer(200, JSON.stringify({ status: 'success', data: 'up' })),
      );

      for (let i = 0; i < 2; i++) {
        await agent
          .get(`/connections/${connection._id.toString()}/prometheus-http-api`)
          .expect(200);
      }

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('answers false rather than failing when the probe is inconclusive', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const connection = await createClickHouseConnection(team._id);
      mockFetch.mockResolvedValue(probeAnswer(502, 'Bad gateway'));

      const res = await agent
        .get(`/connections/${connection._id.toString()}/prometheus-http-api`)
        .expect(200);

      expect(res.body).toEqual({ supported: false });
    });
  });
});
