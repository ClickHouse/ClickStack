import { DisplayType } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import {
  getServer,
  makeAlertChartConfig,
  makeTile,
  RAW_SQL_ALERT_TEMPLATE,
} from '@/fixtures';
import Alert, {
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import * as checkAlertTasks from '@/tasks/checkAlerts';
import { getScheduledWindowStart } from '@/tasks/checkAlerts';
import {
  AlertProvider,
  AlertTaskType,
  loadProvider,
} from '@/tasks/checkAlerts/providers';

const MOCK_SAVED_SEARCH: any = {
  id: 'fake-saved-search-id',
};

// Mock logger to suppress error output in tests for this file
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
describe('DefaultAlertProvider', () => {
  let provider: AlertProvider;
  const server = getServer();

  beforeAll(async () => {
    provider = await loadProvider('default');
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    if (provider) {
      await provider.asyncDispose();
    }
    await server.stop();
  });

  describe('getAlertTasks', () => {
    it('should return empty array when no alerts exist', async () => {
      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should process a single saved search alert', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create connection
      const connection = await Connection.create({
        team: team._id,
        name: 'Test Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'test',
      });

      // Create source
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      // Create saved search
      const savedSearch = await SavedSearch.create({
        team: team._id,
        name: 'Test Search',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source._id,
        tags: [],
      });

      // Create alert
      const alert = await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch._id.toString(),
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1);
      expect(result[0].conn.id).toBe(connection.id);
      expect(result[0].alerts).toHaveLength(1);
      expect(result[0].alerts[0].taskType).toBe(AlertTaskType.SAVED_SEARCH);
      expect(result[0].alerts[0].alert.id).toBe(alert.id);

      // Type narrowing for SAVED_SEARCH alert
      if (result[0].alerts[0].taskType === AlertTaskType.SAVED_SEARCH) {
        expect(result[0].alerts[0].savedSearch.name).toBe('Test Search');
      }
    });

    it('should process a single tile alert', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create connection
      const connection = await Connection.create({
        team: team._id,
        name: 'Test Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'test',
      });

      // Create source
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      // Create tile with source
      const tile = makeTile({
        id: 'test-tile-123',
        sourceId: source._id.toString(),
      });

      // Create dashboard
      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [tile],
      });

      // Create alert
      const alert = await createAlert(
        team._id,
        {
          source: AlertSource.TILE,
          dashboardId: dashboard._id.toString(),
          tileId: tile.id,
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1);
      expect(result[0].conn.id).toBe(connection.id);
      expect(result[0].alerts).toHaveLength(1);
      expect(result[0].alerts[0].taskType).toBe(AlertTaskType.TILE);
      expect(result[0].alerts[0].alert.id).toBe(alert.id);

      // Type narrowing for TILE alert
      if (result[0].alerts[0].taskType === AlertTaskType.TILE) {
        expect(result[0].alerts[0].tile.id).toBe(tile.id);
        expect(result[0].alerts[0].dashboard.name).toBe('Test Dashboard');

        // Validate source is proper ISource object
        const alertSource = result[0].alerts[0].source;
        expect(alertSource).toBeDefined();
        expect(alertSource!.connection).toBe(connection.id); // Should be ObjectId, not populated IConnection
        expect(alertSource!.name).toBe('Test Source');
        expect(alertSource!.kind).toBe('log');
        expect(alertSource!.team).toBeDefined();
        expect(alertSource!.from?.databaseName).toBe('default');
        expect(alertSource!.from?.tableName).toBe('logs');
        expect(alertSource!.timestampValueExpression).toBe('timestamp');

        // Ensure it's a plain object, not a mongoose document
        expect((alertSource as any).toObject).toBeUndefined(); // mongoose documents have toObject method
        expect((alertSource as any).save).toBeUndefined(); // mongoose documents have save method
      }
    });

    it('should skip alerts with missing saved search', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create alert directly in database with non-existent saved search
      // This simulates an alert that exists but references a deleted saved search
      await Alert.create({
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: new mongoose.Types.ObjectId(), // Non-existent ID
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with no source field', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create alert directly without source
      await Alert.create({
        team: team._id,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
        // Missing source field
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should group multiple alerts with the same connection', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create single connection
      const connection = await Connection.create({
        team: team._id,
        name: 'Shared Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'test',
      });

      // Create source
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      // Create saved search and alert
      const savedSearch = await SavedSearch.create({
        team: team._id,
        name: 'Test Search',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source._id,
        tags: [],
      });

      const savedSearchAlert = await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch._id.toString(),
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      // Create tile and alert
      const tile = makeTile({
        id: 'test-tile-123',
        sourceId: source._id.toString(),
      });

      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [tile],
      });

      const tileAlert = await createAlert(
        team._id,
        {
          source: AlertSource.TILE,
          dashboardId: dashboard._id.toString(),
          tileId: tile.id,
          threshold: 15,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '15m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1); // Should group into one task
      expect(result[0].conn.id).toBe(connection.id);
      expect(result[0].alerts).toHaveLength(2); // Both alerts should be in the same task

      const alertIds = result[0].alerts.map(a => a.alert.id).sort();
      expect(alertIds).toEqual([savedSearchAlert.id, tileAlert.id].sort());
    });

    it('should create separate tasks for different connections', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create two different connections
      const connection1 = await Connection.create({
        team: team._id,
        name: 'Connection 1',
        host: 'http://localhost:8123',
        username: 'test1',
        password: 'test1',
      });

      const connection2 = await Connection.create({
        team: team._id,
        name: 'Connection 2',
        host: 'http://localhost:8124',
        username: 'test2',
        password: 'test2',
      });

      // Create sources for each connection
      const source1 = await Source.create({
        team: team._id,
        name: 'Source 1',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection1._id,
      });

      const source2 = await Source.create({
        team: team._id,
        name: 'Source 2',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection2._id,
      });

      // Create saved searches and alerts
      const savedSearch1 = await SavedSearch.create({
        team: team._id,
        name: 'Search 1',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source1._id,
        tags: [],
      });

      const savedSearch2 = await SavedSearch.create({
        team: team._id,
        name: 'Search 2',
        select: 'message',
        where: 'level: warn',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source2._id,
        tags: [],
      });

      await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch1._id.toString(),
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch2._id.toString(),
          threshold: 15,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '15m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(2); // Should create separate tasks

      const connectionIds = result.map(task => task.conn.id).sort();
      expect(connectionIds).toEqual([connection1.id, connection2.id].sort());

      // Each task should have one alert
      expect(result[0].alerts).toHaveLength(1);
      expect(result[1].alerts).toHaveLength(1);
    });

    it('should skip alerts with missing dashboard', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create alert directly in database with non-existent dashboard
      // This simulates an alert that exists but references a deleted dashboard
      await Alert.create({
        team: team._id,
        source: AlertSource.TILE,
        dashboard: new mongoose.Types.ObjectId(), // Non-existent ID
        tileId: 'some-tile-id',
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with missing tile in dashboard', async () => {
      const team = await createTeam({ name: 'Test Team' });

      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [makeTile({ id: 'existing-tile' })],
      });

      // Create alert directly in database with non-existent tile ID
      await Alert.create({
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard._id,
        tileId: 'non-existent-tile', // Non-existent tile ID
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with missing source', async () => {
      const team = await createTeam({ name: 'Test Team' });

      const tile = makeTile({
        id: 'test-tile',
        sourceId: new mongoose.Types.ObjectId().toString(), // Non-existent source
      });

      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [tile],
      });

      // Create alert directly in database
      await Alert.create({
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard._id,
        tileId: tile.id,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with missing connection', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create source with non-existent connection
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: new mongoose.Types.ObjectId(), // Non-existent connection
      });

      const savedSearch = await SavedSearch.create({
        team: team._id,
        name: 'Test Search',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source._id,
        tags: [],
      });

      // Create alert directly in database
      await Alert.create({
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with unsupported source type', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create alert with invalid source
      await Alert.create({
        team: team._id,
        source: 'UNSUPPORTED_SOURCE' as any,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should include password field in connection for saved search alerts', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create connection with specific password
      const connection = await Connection.create({
        team: team._id,
        name: 'Test Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'secret-password-123',
      });

      // Create source
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      // Create saved search
      const savedSearch = await SavedSearch.create({
        team: team._id,
        name: 'Test Search',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source._id,
        tags: [],
      });

      // Create alert
      await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch._id.toString(),
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1);
      expect(result[0].conn.password).toBe('secret-password-123');
      expect(result[0].conn.username).toBe('test');
      expect(result[0].conn.host).toBe('http://localhost:8123');
    });

    it('should include password field in connection for tile alerts', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create connection with specific password
      const connection = await Connection.create({
        team: team._id,
        name: 'Test Connection',
        host: 'http://localhost:8124',
        username: 'tile-user',
        password: 'tile-secret-password-456',
      });

      // Create source
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      // Create tile with source
      const tile = makeTile({
        id: 'test-tile-123',
        sourceId: source._id.toString(),
      });

      // Create dashboard
      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [tile],
      });

      // Create alert
      await createAlert(
        team._id,
        {
          source: AlertSource.TILE,
          dashboardId: dashboard._id.toString(),
          tileId: tile.id,
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1);
      expect(result[0].conn.password).toBe('tile-secret-password-456');
      expect(result[0].conn.username).toBe('tile-user');
      expect(result[0].conn.host).toBe('http://localhost:8124');
    });

    describe('history fetch gating (HDX-4791)', () => {
      afterEach(() => {
        jest.restoreAllMocks();
      });

      // Alerts created by the helpers use interval '5m' with no schedule
      // offset, matching processAlert's window computation.
      const currentWindowStart = () =>
        getScheduledWindowStart(new Date(), 5, 0);

      it('skips the per-group history fetch and seeds a sentinel for alerts already evaluated in the current window', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
        );
        // Use a 1d interval so the current window (start of the UTC day)
        // cannot roll over mid-test.
        await Alert.updateOne({ _id: alert._id }, { $set: { interval: '1d' } });
        const windowStart = getScheduledWindowStart(new Date(), 1440, 0);
        await AlertHistory.create({
          alert: alert._id,
          createdAt: windowStart,
          state: AlertState.ALERT,
          group: 'group-a',
        });

        const findSpy = jest.spyOn(AlertHistory, 'find');
        const result = await provider.getAlertTasks();

        // The gate (a findOne per alert) decided the alert was already
        // evaluated this window, so the per-group range find never runs.
        expect(findSpy).not.toHaveBeenCalled();

        expect(result).toHaveLength(1);
        const details = result[0].alerts[0];
        const sentinel = details.previousMap.get(alert.id);
        expect(sentinel).toBeDefined();
        expect(sentinel!.createdAt).toEqual(windowStart);
        expect(sentinel!.state).toBe(AlertState.ALERT);
      });

      it('fetches full per-group history for grouped alerts that are due', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
          { groupBy: 'ServiceName' },
        );
        // Latest history is from a previous window -> the alert is due.
        const previousWindowStart = new Date(
          currentWindowStart().getTime() - 5 * 60_000,
        );
        await AlertHistory.create({
          alert: alert._id,
          createdAt: previousWindowStart,
          state: AlertState.ALERT,
          group: 'group-a',
        });
        await AlertHistory.create({
          alert: alert._id,
          createdAt: previousWindowStart,
          state: AlertState.OK,
          group: 'group-b',
        });

        const findSpy = jest.spyOn(AlertHistory, 'find');
        const result = await provider.getAlertTasks();

        expect(findSpy).toHaveBeenCalledTimes(1);

        expect(result).toHaveLength(1);
        const details = result[0].alerts[0];
        const groupA = details.previousMap.get(`${alert.id}||group-a`);
        expect(groupA).toBeDefined();
        expect(groupA!.state).toBe(AlertState.ALERT);
        expect(groupA!.createdAt).toEqual(previousWindowStart);
        expect(details.previousMap.get(`${alert.id}||group-b`)!.state).toBe(
          AlertState.OK,
        );
      });

      it('seeds non-grouped due alerts from the gate row without a range scan (HDX-4980)', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
        );
        // Several previous windows of history; the newest row carries the
        // state the previousMap must reflect.
        const windowMs = 5 * 60_000;
        const base = currentWindowStart().getTime();
        await AlertHistory.create({
          alert: alert._id,
          createdAt: new Date(base - 3 * windowMs),
          state: AlertState.OK,
          group: '',
        });
        await AlertHistory.create({
          alert: alert._id,
          createdAt: new Date(base - 2 * windowMs),
          state: AlertState.OK,
          group: '',
        });
        const newest = await AlertHistory.create({
          alert: alert._id,
          createdAt: new Date(base - windowMs),
          state: AlertState.ALERT,
          group: '',
          fired: true,
        });

        const findSpy = jest.spyOn(AlertHistory, 'find');
        const result = await provider.getAlertTasks();

        // The gate's findOne already fetched the latest row; a non-grouped
        // alert must not pay for the per-group range scan.
        expect(findSpy).not.toHaveBeenCalled();

        expect(result).toHaveLength(1);
        const details = result[0].alerts[0];
        // Seeded entry is exactly what the legacy range scan would have
        // reduced to: the newest row, including state and fired.
        const previous = details.previousMap.get(alert.id);
        expect(previous).toBeDefined();
        expect(previous!.createdAt).toEqual(newest.createdAt);
        expect(previous!.state).toBe(AlertState.ALERT);
        expect(previous!.fired).toBe(true);
      });

      it('skips the per-group history fetch for alerts with no history at all', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
        );

        const findSpy = jest.spyOn(AlertHistory, 'find');
        const result = await provider.getAlertTasks();

        // No history exists, so there is nothing to range-scan.
        expect(findSpy).not.toHaveBeenCalled();

        // The alert is still due and loaded, just with an empty previousMap.
        expect(result).toHaveLength(1);
        const details = result[0].alerts[0];
        expect(details.alert.id).toBe(alert.id);
        expect(details.previousMap.get(alert.id)).toBeUndefined();
      });

      it('skips a grouped alert already evaluated this window, from the sentinel alone', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
          { groupBy: 'ServiceName' },
        );
        // Use a 1d interval so the current window (start of the UTC day)
        // cannot roll over mid-test.
        await Alert.updateOne({ _id: alert._id }, { $set: { interval: '1d' } });
        const windowStart = getScheduledWindowStart(new Date(), 1440, 0);
        for (const group of ['ServiceName:a', 'ServiceName:b']) {
          await AlertHistory.create({
            alert: alert._id,
            createdAt: windowStart,
            state: AlertState.ALERT,
            group,
            fired: true,
          });
        }

        const [task] = checkAlertTasks.partitionPreviousMapsByAlert(
          await provider.getAlertTasks(),
        );
        const details = task.alerts[0];
        // No per-group rows were loaded, only the sentinel.
        expect([...details.previousMap.keys()]).toEqual([alert.id]);

        const clickhouseClient = await provider.getClickHouseClient(task.conn);
        const querySpy = jest.spyOn(clickhouseClient, 'queryChartConfig');
        await checkAlertTasks.processAlert(
          task.now,
          details,
          clickhouseClient,
          task.conn.id,
          provider,
          new Map(),
        );

        expect(querySpy).not.toHaveBeenCalled();
        expect(await AlertHistory.countDocuments({ alert: alert._id })).toBe(2);
      });

      it('reads the last evaluation for a grouped alert whose latest rows are older than the scan window', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
          { groupBy: 'ServiceName' },
        );
        // 5m interval: the per-group scan covers 1 day, so a 2-day-old
        // evaluation is outside it but inside the 7-day latest-row lookup.
        const twoDaysAgo = new Date(
          currentWindowStart().getTime() - 2 * 24 * 60 * 60_000,
        );
        await AlertHistory.create({
          alert: alert._id,
          createdAt: twoDaysAgo,
          state: AlertState.ALERT,
          group: 'ServiceName:a',
          fired: true,
          groupValues: [{ key: 'ServiceName', value: 'a' }],
        });
        await AlertHistory.create({
          alert: alert._id,
          createdAt: twoDaysAgo,
          state: AlertState.OK,
          group: 'ServiceName:b',
        });
        // An earlier evaluation and a failed one must not be picked up.
        await AlertHistory.create({
          alert: alert._id,
          createdAt: new Date(twoDaysAgo.getTime() - 5 * 60_000),
          state: AlertState.ALERT,
          group: 'ServiceName:c',
        });
        await AlertHistory.create({
          alert: alert._id,
          createdAt: twoDaysAgo,
          state: AlertState.ERROR,
        });

        const result = await provider.getAlertTasks();

        expect(result).toHaveLength(1);
        const { previousMap } = result[0].alerts[0];
        expect([...previousMap.keys()].sort()).toEqual([
          `${alert.id}||ServiceName:a`,
          `${alert.id}||ServiceName:b`,
        ]);
        const groupA = previousMap.get(`${alert.id}||ServiceName:a`);
        expect(groupA?.createdAt).toEqual(twoDaysAgo);
        expect(groupA?.state).toBe(AlertState.ALERT);
        expect(groupA?.fired).toBe(true);
        expect(groupA?.groupValues).toEqual([
          { key: 'ServiceName', value: 'a' },
        ]);
        expect(previousMap.get(`${alert.id}||ServiceName:b`)?.state).toBe(
          AlertState.OK,
        );
      });

      it('reads only the last evaluation for a due grouped alert that a value of 0 does not breach', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
          { groupBy: 'ServiceName' },
        );
        const windowMs = 5 * 60_000;
        const lastEvaluation = new Date(
          currentWindowStart().getTime() - windowMs,
        );
        // Older evaluations: 'old' last reported OK, so it has no row in the
        // last evaluation and no state worth keeping.
        for (let i = 2; i <= 4; i++) {
          await AlertHistory.create({
            alert: alert._id,
            createdAt: new Date(lastEvaluation.getTime() - i * windowMs),
            state: AlertState.OK,
            group: 'old',
          });
        }
        await AlertHistory.create({
          alert: alert._id,
          createdAt: lastEvaluation,
          state: AlertState.ALERT,
          group: 'a',
          fired: true,
        });
        await AlertHistory.create({
          alert: alert._id,
          createdAt: lastEvaluation,
          state: AlertState.OK,
          group: 'b',
        });

        const findSpy = jest.spyOn(AlertHistory, 'find');
        const result = await provider.getAlertTasks();

        // One find, on the last evaluation's createdAt: no lookback scan.
        expect(findSpy).toHaveBeenCalledTimes(1);
        expect(findSpy.mock.calls[0][0]).toMatchObject({
          createdAt: lastEvaluation,
        });
        const { previousMap } = result[0].alerts[0];
        expect([...previousMap.keys()].sort()).toEqual([
          `${alert.id}||a`,
          `${alert.id}||b`,
        ]);
        const groupA = previousMap.get(`${alert.id}||a`);
        expect(groupA?.state).toBe(AlertState.ALERT);
        expect(groupA?.fired).toBe(true);
      });

      it('keeps the lookback scan for a grouped alert that a value of 0 breaches', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
          { groupBy: 'ServiceName' },
        );
        await Alert.updateOne(
          { _id: alert._id },
          { $set: { thresholdType: AlertThresholdType.BELOW, threshold: 1 } },
        );
        const windowMs = 5 * 60_000;
        const lastEvaluation = new Date(
          currentWindowStart().getTime() - windowMs,
        );
        // 'gone' stopped reporting while in ALERT. A value of 0 breaches, so
        // processAlert writes no OK row for it and only the scan finds it.
        await AlertHistory.create({
          alert: alert._id,
          createdAt: new Date(lastEvaluation.getTime() - 2 * windowMs),
          state: AlertState.ALERT,
          group: 'gone',
          fired: true,
        });
        await AlertHistory.create({
          alert: alert._id,
          createdAt: lastEvaluation,
          state: AlertState.OK,
          group: 'a',
        });

        const result = await provider.getAlertTasks();

        const { previousMap } = result[0].alerts[0];
        expect([...previousMap.keys()].sort()).toEqual([
          `${alert.id}||a`,
          `${alert.id}||gone`,
        ]);
        expect(previousMap.get(`${alert.id}||gone`)?.state).toBe(
          AlertState.ALERT,
        );
      });

      it('treats an alert as due when its window start cannot be computed', async () => {
        const { alert } = await createValidSavedSearchAlert(
          await createConnectionAndSource(),
        );
        // 1d interval and a row at the current window start: without the
        // failure this alert would be skipped, with only a sentinel entry.
        await Alert.updateOne({ _id: alert._id }, { $set: { interval: '1d' } });
        await AlertHistory.create({
          alert: alert._id,
          createdAt: getScheduledWindowStart(new Date(), 1440, 0),
          state: AlertState.ALERT,
          fired: true,
        });
        const windowStartSpy = jest
          .spyOn(checkAlertTasks, 'getAlertWindowStart')
          .mockImplementation(() => {
            throw new Error('lookup failed');
          });

        const result = await provider.getAlertTasks();

        expect(windowStartSpy).toHaveBeenCalled();
        expect(result).toHaveLength(1);
        // The sentinel carries no `fired`; the real previous row does.
        const previous = result[0].alerts[0].previousMap.get(alert.id);
        expect(previous?.state).toBe(AlertState.ALERT);
        expect(previous?.fired).toBe(true);
      });

      let team: Awaited<ReturnType<typeof createTeam>>;

      beforeEach(async () => {
        team = await createTeam({ name: 'Test Team' });
      });

      const createConnectionAndSource = async () => {
        const connection = await Connection.create({
          team: team._id,
          name: 'Test Connection',
          host: 'http://localhost:8123',
          username: 'test',
          password: 'test',
        });
        const source = await Source.create({
          team: team._id,
          name: 'Test Source',
          kind: 'log',
          from: { databaseName: 'default', tableName: 'logs' },
          timestampValueExpression: 'timestamp',
          connection: connection._id,
        });
        return { connection, source };
      };

      const createValidSavedSearchAlert = async (
        { source }: Awaited<ReturnType<typeof createConnectionAndSource>>,
        { groupBy }: { groupBy?: string } = {},
      ) => {
        const savedSearch = await SavedSearch.create({
          team: team._id,
          name: 'Test Search',
          select: 'message',
          where: 'level: error',
          whereLanguage: 'lucene',
          orderBy: 'timestamp',
          source: source._id,
          tags: [],
        });
        const alert = await createAlert(
          team._id,
          {
            source: AlertSource.SAVED_SEARCH,
            savedSearchId: savedSearch._id.toString(),
            threshold: 10,
            thresholdType: AlertThresholdType.ABOVE,
            interval: '5m',
            ...(groupBy ? { groupBy } : {}),
            channel: {
              type: 'webhook',
              webhookId: new mongoose.Types.ObjectId().toString(),
            },
          },
          new mongoose.Types.ObjectId(),
        );
        return { alert };
      };
    });

    it('should process a single inline alert', async () => {
      const team = await createTeam({ name: 'Test Team' });

      const connection = await Connection.create({
        team: team._id,
        name: 'Test Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'test',
      });

      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      const chartConfig = makeAlertChartConfig({
        sourceId: source._id.toString(),
      });

      const alert = await createAlert(
        team._id,
        {
          source: AlertSource.INLINE,
          chartConfig,
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1);
      // Builder inline alerts derive their connection from the source
      expect(result[0].conn.id).toBe(connection.id);
      expect(result[0].alerts).toHaveLength(1);
      expect(result[0].alerts[0].taskType).toBe(AlertTaskType.INLINE);
      expect(result[0].alerts[0].alert.id).toBe(alert.id);

      if (result[0].alerts[0].taskType === AlertTaskType.INLINE) {
        expect(result[0].alerts[0].chartConfig).toMatchObject({
          source: source._id.toString(),
        });
        expect(result[0].alerts[0].source?.name).toBe('Test Source');
      }
    });

    // The stale-pairing scenario: write-path validation ties a raw-SQL
    // config's source to its connection, but the source can be moved to a
    // different connection afterwards. The worker must not expand
    // $__sourceTable/metricTables from the moved source while executing
    // through the pinned connection.
    const setupRawSqlSourceMove = async () => {
      const team = await createTeam({ name: 'Test Team' });
      const connection = await Connection.create({
        team: team._id,
        name: 'Original Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'test',
      });
      const otherConnection = await Connection.create({
        team: team._id,
        name: 'Other Connection',
        host: 'http://localhost:8124',
        username: 'test',
        password: 'test',
      });
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });
      return { team, connection, otherConnection, source };
    };

    it('drops raw-SQL inline alert source metadata when the source moved to a different connection', async () => {
      const { team, connection, otherConnection, source } =
        await setupRawSqlSourceMove();

      await createAlert(
        team._id,
        {
          source: AlertSource.INLINE,
          chartConfig: {
            configType: 'sql',
            displayType: DisplayType.Line,
            sqlTemplate: RAW_SQL_ALERT_TEMPLATE,
            connection: connection._id.toString(),
            source: source._id.toString(),
          },
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      let result = await provider.getAlertTasks();
      expect(result).toHaveLength(1);
      expect(result[0].alerts[0].taskType).toBe(AlertTaskType.INLINE);
      if (result[0].alerts[0].taskType === AlertTaskType.INLINE) {
        expect(result[0].alerts[0].source?.name).toBe('Test Source');
      }

      await Source.updateOne(
        { _id: source._id },
        { $set: { connection: otherConnection._id } },
      );

      result = await provider.getAlertTasks();
      expect(result).toHaveLength(1);
      // Still executes through the alert's pinned connection...
      expect(result[0].conn.id).toBe(connection.id);
      // ...but without the moved source's metadata.
      if (result[0].alerts[0].taskType === AlertTaskType.INLINE) {
        expect(result[0].alerts[0].source).toBeUndefined();
      }
    });

    it('drops raw-SQL tile alert source metadata when the source moved to a different connection', async () => {
      const { team, connection, otherConnection, source } =
        await setupRawSqlSourceMove();

      const tile = {
        id: 'raw-sql-tile-123',
        x: 1,
        y: 1,
        w: 1,
        h: 1,
        config: {
          configType: 'sql' as const,
          displayType: DisplayType.Line,
          sqlTemplate: RAW_SQL_ALERT_TEMPLATE,
          connection: connection._id.toString(),
          source: source._id.toString(),
        },
      };
      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [tile],
      });

      await createAlert(
        team._id,
        {
          source: AlertSource.TILE,
          dashboardId: dashboard._id.toString(),
          tileId: tile.id,
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      let result = await provider.getAlertTasks();
      expect(result).toHaveLength(1);
      expect(result[0].alerts[0].taskType).toBe(AlertTaskType.TILE);
      if (result[0].alerts[0].taskType === AlertTaskType.TILE) {
        expect(result[0].alerts[0].source?.name).toBe('Test Source');
      }

      await Source.updateOne(
        { _id: source._id },
        { $set: { connection: otherConnection._id } },
      );

      result = await provider.getAlertTasks();
      expect(result).toHaveLength(1);
      expect(result[0].conn.id).toBe(connection.id);
      if (result[0].alerts[0].taskType === AlertTaskType.TILE) {
        expect(result[0].alerts[0].source).toBeUndefined();
      }
    });
  });

  describe('buildLogSearchLink', () => {
    it('should build correct URL with basic parameters', () => {
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toBe(
        'http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false',
      );
    });

    it('should handle different saved search IDs', () => {
      const customSavedSearch: any = {
        id: 'custom-search-123',
        team: new mongoose.Types.ObjectId(),
        source: new mongoose.Types.ObjectId(),
        select: 'Body',
        where: 'Body: "error"',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        tags: ['test'],
      };
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: customSavedSearch,
      });

      expect(result).toContain('/search/custom-search-123?');
      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091239103');
      expect(result).toContain('isLive=false');
    });

    it('should handle different date ranges', () => {
      const result = provider.buildLogSearchLink({
        startTime: new Date('2024-01-01T00:00:00.000Z'),
        endTime: new Date('2024-01-01T23:59:59.999Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('/search/fake-saved-search-id?');
      expect(result).toContain('from=1704067200000');
      expect(result).toContain('to=1704153599999');
      expect(result).toContain('isLive=false');
    });

    it('should handle very close dates', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:03.104Z'); // 1ms difference

      const result = provider.buildLogSearchLink({
        startTime,
        endTime,
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091183104');
      expect(result).toContain('isLive=false');
    });

    it('should handle same start and end time', () => {
      const sameTime = new Date('2023-03-17T22:13:03.103Z');

      const result = provider.buildLogSearchLink({
        startTime: sameTime,
        endTime: sameTime,
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091183103');
      expect(result).toContain('isLive=false');
    });

    it('should handle saved search ID with special characters', () => {
      const specialSavedSearch: any = {
        id: 'search-with-special-chars-123_456',
        team: new mongoose.Types.ObjectId(),
        source: new mongoose.Types.ObjectId(),
        select: 'Body',
        where: 'Body: "error"',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        tags: ['test'],
      };
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: specialSavedSearch,
      });

      expect(result).toContain('/search/search-with-special-chars-123_456?');
    });

    it('should always include isLive=false parameter', () => {
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('isLive=false');
    });

    it('should generate valid URL structure', () => {
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      // Should be a valid URL
      expect(() => new URL(result)).not.toThrow();

      const url = new URL(result);
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('app');
      expect(url.port).toBe('8080');
      expect(url.pathname).toBe('/search/fake-saved-search-id');

      const params = url.searchParams;
      expect(params.get('from')).toBe('1679091183103');
      expect(params.get('to')).toBe('1679091239103');
      expect(params.get('isLive')).toBe('false');
    });
  });

  describe('buildChartLink', () => {
    it('should build correct URL with basic parameters', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      // Should contain dashboard ID in path
      expect(result).toContain('/dashboards/dashboard-123?');

      // Should have from, to, and granularity parameters
      expect(result).toContain('from=');
      expect(result).toContain('to=');
      expect(result).toContain('granularity=');
    });

    it('should extend time range by 7x granularity', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:59.103Z');
      const granularity = '5m';

      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity,
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // 5 minutes = 5 * 60 * 1000 = 300000ms
      // 7x granularity = 7 * 300000 = 2100000ms
      const expectedFrom = startTime.getTime() - 2100000;
      const expectedTo = endTime.getTime() + 2100000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
    });

    it('should handle different granularities', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:59.103Z');

      // Test 1 minute granularity
      const result1m = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '1m',
      });

      const url1m = new URL(result1m);
      const from1m = parseInt(url1m.searchParams.get('from') || '0');
      const to1m = parseInt(url1m.searchParams.get('to') || '0');

      // 1 minute = 1 * 60 * 1000 = 60000ms
      // 7x granularity = 7 * 60000 = 420000ms
      expect(from1m).toBe(startTime.getTime() - 420000);
      expect(to1m).toBe(endTime.getTime() + 420000);

      // Test 1 hour granularity
      const result1h = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '1h',
      });

      const url1h = new URL(result1h);
      const from1h = parseInt(url1h.searchParams.get('from') || '0');
      const to1h = parseInt(url1h.searchParams.get('to') || '0');

      // 1 hour = 1 * 60 * 60 * 1000 = 3600000ms
      // 7x granularity = 7 * 3600000 = 25200000ms
      expect(from1h).toBe(startTime.getTime() - 25200000);
      expect(to1h).toBe(endTime.getTime() + 25200000);
    });

    it('should handle different dashboard IDs', () => {
      const result = provider.buildChartLink({
        dashboardId: 'custom-dashboard-456',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      expect(result).toContain('/dashboards/custom-dashboard-456?');
    });

    it('should handle dashboard ID with special characters', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-with-special-chars_123-456',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      expect(result).toContain(
        '/dashboards/dashboard-with-special-chars_123-456?',
      );
    });

    it('should generate valid URL structure', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      // Should be a valid URL
      expect(() => new URL(result)).not.toThrow();

      const url = new URL(result);
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('app');
      expect(url.port).toBe('8080');
      expect(url.pathname).toBe('/dashboards/dashboard-123');

      const params = url.searchParams;
      expect(params.has('from')).toBe(true);
      expect(params.has('to')).toBe(true);
      expect(params.has('granularity')).toBe(true);
    });

    it('should include highlightedTileId when tileId is provided', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
        tileId: 'tile-abc-789',
      });

      const url = new URL(result);
      expect(url.searchParams.get('highlightedTileId')).toBe('tile-abc-789');
    });

    it('should omit highlightedTileId when tileId is undefined', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      const url = new URL(result);
      expect(url.searchParams.has('highlightedTileId')).toBe(false);
    });

    it('should omit highlightedTileId when tileId is an empty string', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
        tileId: '',
      });

      const url = new URL(result);
      expect(url.searchParams.has('highlightedTileId')).toBe(false);
    });

    it('should handle very close dates', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:03.104Z'); // 1ms difference

      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '5m',
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // Should still extend by 7x granularity even for very close dates
      const expectedFrom = startTime.getTime() - 7 * 5 * 60 * 1000;
      const expectedTo = endTime.getTime() + 7 * 5 * 60 * 1000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
    });

    it('should handle same start and end time', () => {
      const sameTime = new Date('2023-03-17T22:13:03.103Z');

      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: sameTime,
        endTime: sameTime,
        granularity: '5m',
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // Should still extend by 7x granularity
      const expectedFrom = sameTime.getTime() - 7 * 5 * 60 * 1000;
      const expectedTo = sameTime.getTime() + 7 * 5 * 60 * 1000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
    });
  });
});
