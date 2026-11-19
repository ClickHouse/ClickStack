import { ClickHouseClient, createClient } from '@clickhouse/client';

// The row side panel (packages/app: mergePath, buildJSONExtractQuery) builds
// these expressions for values inside arrays. Its unit tests only compare SQL
// text; these check that ClickHouse accepts each form and matches the row.
describe('row panel expressions for JSON array elements', () => {
  let client: ClickHouseClient;

  const DATABASE = 'default';
  const TABLE_NAME = 'json_array_paths_int_test';

  beforeAll(async () => {
    client = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });

    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE_NAME} (
        Id UInt32,
        message JSON,
        Body String
      )
      ENGINE = MergeTree
      ORDER BY Id`,
    });

    await client.insert({
      table: `${DATABASE}.${TABLE_NAME}`,
      values: [
        {
          Id: 1,
          message: {
            config: JSON.stringify({ host: 'h1' }),
            events: [
              { name: 'first' },
              { name: 'second', payload: JSON.stringify({ k: 'v1' }) },
            ],
          },
          Body: JSON.stringify({ events: [{ name: 'x', n: 1.5, ok: true }] }),
        },
        {
          Id: 2,
          message: {
            config: JSON.stringify({ host: 'h2' }),
            events: [{ name: 'second' }, { name: 'first' }],
          },
          Body: JSON.stringify({ events: [{ name: 'y', n: 2, ok: false }] }),
        },
      ],
      format: 'JSONEachRow',
    });
  });

  afterAll(async () => {
    await client.command({
      query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE_NAME}`,
    });
    await client.close();
  });

  const idsWhere = async (where: string) => {
    const result = await client.query({
      query: `SELECT Id FROM ${DATABASE}.${TABLE_NAME} WHERE ${where} ORDER BY Id`,
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ Id: number }>();
    return rows.map(r => Number(r.Id));
  };

  it.each([
    // JSON column, value inside an array element
    ["toString(message.`events`[2].`name`) = 'second'", [1]],
    // String column holding JSON with an array
    ["JSONExtractString(Body, 'events', 1, 'name') = 'x'", [1]],
    ["JSONExtractFloat(Body, 'events', 1, 'n') = 2", [2]],
    ["JSONExtractBool(Body, 'events', 1, 'ok') = true", [1]],
    // JSON-column subpath holding a JSON string
    ["JSONExtractString(toString(message.`config`), 'host') = 'h2'", [2]],
    // JSON string under a JSON-column array element
    [
      "JSONExtractString(toString(message.`events`[2].`payload`), 'k') = 'v1'",
      [1],
    ],
  ])('%s', async (where, ids) => {
    expect(await idsWhere(where)).toEqual(ids);
  });
});
