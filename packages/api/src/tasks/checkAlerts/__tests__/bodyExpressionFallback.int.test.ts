import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  getMetadata,
  Metadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import * as config from '@/config';
import { createTeam } from '@/controllers/team';
import { bulkInsertLogs, getServer } from '@/fixtures';
import Connection from '@/models/connection';
import { ISource, LogSource, Source } from '@/models/source';
import { computeAliasWithClauses } from '@/tasks/checkAlerts';
import { fetchSampleLines } from '@/tasks/checkAlerts/template';

describe('log body fallback in alert queries', () => {
  const server = getServer();
  let source: ISource;
  let clickhouseClient: ClickhouseClient;
  let metadata: Metadata;
  const savedSearch = {
    id: 'body-fallback',
    select: 'Body AS message',
    where: 'needle',
    whereLanguage: 'lucene' as const,
  };
  let startTime: Date;
  let endTime: Date;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const team = await createTeam({ name: 'Body fallback' });
    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    source = await LogSource.create({
      team: team._id,
      connection: connection._id,
      name: 'Logs',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      bodyExpression: 'Body',
    });
    clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });
    metadata = getMetadata(clickhouseClient);
    const now = new Date();
    startTime = new Date(now.getTime() - 60_000);
    endTime = new Date(now.getTime() + 60_000);
    await bulkInsertLogs([
      {
        Body: 'needle in body',
        ServiceName: 'api',
        SeverityText: 'error',
        Timestamp: now,
      },
      {
        Body: 'other',
        ServiceName: 'needle',
        SeverityText: 'info',
        Timestamp: now,
      },
    ]);
  });

  afterEach(async () => {
    await clickhouseClient.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('renders saved-search aliases with a body-only source', async () => {
    const clauses = await computeAliasWithClauses(
      savedSearch,
      source,
      metadata,
    );
    expect(clauses).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'message' })]),
    );
  });

  it('includes only matching body rows in notification samples', async () => {
    const sample = await fetchSampleLines({
      clickhouseClient,
      metadata,
      source,
      savedSearch,
      startTime,
      endTime,
    });
    expect(sample).toContain('needle in body');
    expect(sample).not.toContain('other');
  });

  it('keeps an explicit implicit column ahead of the body for notification samples', async () => {
    await LogSource.updateOne(
      { _id: source.id },
      { $set: { implicitColumnExpression: 'ServiceName' } },
    );
    const updated = await Source.findById(source.id);
    expect(updated).not.toBeNull();
    const sample = await fetchSampleLines({
      clickhouseClient,
      metadata,
      source: updated!,
      savedSearch,
      startTime,
      endTime,
    });
    expect(sample).toContain('other');
    expect(sample).not.toContain('needle in body');
  });

  it('does not introduce a body fallback for trace sources', async () => {
    const traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: source.team,
      connection: source.connection,
      name: 'Traces',
      from: { databaseName: 'default', tableName: 'otel_traces' },
      timestampValueExpression: 'Timestamp',
      spanNameExpression: 'SpanName',
    });
    await expect(
      computeAliasWithClauses(
        { ...savedSearch, select: 'SpanName AS span' },
        traceSource,
        metadata,
      ),
    ).rejects.toThrow(
      'Can not search bare text without an implicit column set.',
    );
  });
});
