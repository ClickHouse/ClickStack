import { summarizeRows } from '@/mcp/tools/dashboards/queryTiles';

describe('summarizeRows', () => {
  it('reads a top-level array result as rows', () => {
    const text = JSON.stringify({ result: [{ a: 1 }, { a: 2 }] });
    expect(summarizeRows(text)).toEqual({ hasData: true, rowCount: 2 });
  });

  it('reads a { data: [...] } result as rows', () => {
    const text = JSON.stringify({ result: { data: [{ a: 1 }] } });
    expect(summarizeRows(text)).toEqual({ hasData: true, rowCount: 1 });
  });

  it("reports ClickHouse's read counts when the result carries statistics", () => {
    const text = JSON.stringify({
      result: {
        data: [{ a: 1 }],
        statistics: { elapsed: 0.01, rows_read: 50, bytes_read: 483 },
      },
    });
    expect(summarizeRows(text)).toEqual({
      hasData: true,
      rowCount: 1,
      rowsRead: 50,
      bytesRead: 483,
    });
  });

  it('omits both read counts when statistics are incomplete', () => {
    const text = JSON.stringify({
      result: { data: [{ a: 1 }], statistics: { rows_read: 50 } },
    });
    expect(summarizeRows(text)).toEqual({ hasData: true, rowCount: 1 });
  });

  it('reports hasData=false and rowCount=0 for an empty result set', () => {
    expect(summarizeRows(JSON.stringify({ result: [] }))).toEqual({
      hasData: false,
      rowCount: 0,
    });
    expect(summarizeRows(JSON.stringify({ result: { data: [] } }))).toEqual({
      hasData: false,
      rowCount: 0,
    });
  });

  it('returns {} for a payload whose result is not row-shaped', () => {
    // result present but neither an array nor a { data: [] } object.
    expect(
      summarizeRows(JSON.stringify({ result: { note: 'trimmed' } })),
    ).toEqual({});
    // no result key at all.
    expect(summarizeRows(JSON.stringify({ warnings: ['x'] }))).toEqual({});
  });

  it('returns {} for unparseable text', () => {
    expect(summarizeRows('not json')).toEqual({});
    expect(summarizeRows('')).toEqual({});
  });

  it('returns {} for JSON primitives (null / number)', () => {
    // Valid JSON, but not an object with a `result` key.
    expect(summarizeRows('null')).toEqual({});
    expect(summarizeRows('123')).toEqual({});
  });
});
