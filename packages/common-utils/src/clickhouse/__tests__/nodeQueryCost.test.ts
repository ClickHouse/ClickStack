import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';

import {
  ClickhouseClient,
  getQueryCost,
  withQueryCost,
} from '@/clickhouse/node';

/** Answers every query with the statistics `statsFor` gives for its SQL. */
class FakeServerClient extends ClickhouseClient {
  constructor(private statsFor: (query: string) => object | undefined) {
    super({ host: 'http://localhost:8123' });
  }

  protected getClient(): NodeClickHouseClient {
    return {
      query: async ({ query }: { query: string }) => ({
        json: async () => ({ data: [], statistics: this.statsFor(query) }),
      }),
    } as unknown as NodeClickHouseClient;
  }
}

const run = async (client: ClickhouseClient, query: string) =>
  (await client.query({ query, shouldSkipApplySettings: true })).json();

const client = new FakeServerClient(query =>
  query === 'SELECT none'
    ? undefined
    : { elapsed: 0.5, rows_read: 10, bytes_read: 100 },
);

describe('withQueryCost', () => {
  it('sums the statistics of the JSON results read in it', async () => {
    const { result, cost } = await withQueryCost(async () => {
      await run(client, 'SELECT 1');
      await run(client, 'SELECT 2');
      // No statistics in the body: not counted.
      await run(client, 'SELECT none');
      return getQueryCost();
    });

    const expected = { elapsed: 1, rows_read: 20, bytes_read: 200, queries: 2 };
    expect(result).toEqual(expected);
    expect(cost).toEqual(expected);
  });

  it('adds a nested meter to the enclosing one, not the reverse', async () => {
    const { result: inner, cost: outer } = await withQueryCost(async () => {
      await run(client, 'SELECT outer');
      const { cost } = await withQueryCost(() => run(client, 'SELECT inner'));
      return cost;
    });

    expect(inner).toMatchObject({ rows_read: 10, queries: 1 });
    expect(outer).toMatchObject({ rows_read: 20, queries: 2 });
  });

  it('counts nothing outside a meter', async () => {
    await run(client, 'SELECT 1');
    expect(getQueryCost()).toBeUndefined();
  });
});
