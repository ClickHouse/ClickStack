import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { findBodyResultColumn, useDenoisedRows } from '@/hooks/useDenoisedRows';
import { useGroupedPatterns } from '@/hooks/usePatterns';

jest.mock('@/hooks/usePatterns', () => ({
  LEVEL_COLUMN_ALIAS: '__hdx_level',
  DRAIN_EXTRA_DELIMITERS: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''),
  useGroupedPatterns: jest.fn(),
}));

const mockUseGroupedPatterns = jest.mocked(useGroupedPatterns);

const source = {
  id: 'logs',
  kind: SourceKind.Log,
  bodyExpression: 'Body',
  severityTextExpression: 'SeverityText',
} as unknown as TSource;

const config = (select: string): BuilderChartConfigWithDateRange => ({
  select,
  from: { databaseName: 'default', tableName: 'otel_logs' },
  where: '',
  timestampValueExpression: 'Timestamp',
  connection: 'local',
  dateRange: [new Date('2026-01-01'), new Date('2026-01-02')],
});

describe('findBodyResultColumn', () => {
  it('finds the body by its position in the select list', () => {
    expect(
      findBodyResultColumn(
        "Timestamp, Body AS msg, LogAttributes['k'] AS k",
        ['Timestamp', 'msg', 'k'],
        'Body',
      ),
    ).toBe('msg');
  });

  it('falls back to the column name for SELECT *', () => {
    expect(findBodyResultColumn('*', ['Timestamp', 'Body'], 'Body')).toBe(
      'Body',
    );
  });

  it('returns undefined when the body is not selected', () => {
    expect(
      findBodyResultColumn(
        'Timestamp, ServiceName',
        ['Timestamp', 'ServiceName'],
        'Body',
      ),
    ).toBeUndefined();
  });
});

const patternQueryState = {
  isLoading: false,
  error: null,
  miner: undefined,
  patternQueryConfig: undefined,
};

describe('useDenoisedRows', () => {
  beforeEach(() => {
    mockUseGroupedPatterns.mockReturnValue({
      data: {
        '1': {
          id: '1',
          pattern: 'info cache refreshed for <*>',
          count: 80,
          samples: [{ __hdx_level: 'info' }],
        },
        '2': {
          id: '2',
          pattern: 'user <*> logged in',
          count: 5,
          samples: [{ __hdx_level: 'info' }],
        },
      },
      sampledRowCount: 100,
      clusterTemplates: {
        '1': 'info cache refreshed for <*>',
        '2': 'user <*> logged in',
      },
      ...patternQueryState,
    });
  });

  it('removes noisy rows by the body column, not the last column', () => {
    const rows = [
      { Body: '\x1b[32minfo\x1b[39m: cache refreshed for ab12', k: 'x' },
      { Body: 'user bob logged in', k: 'y' },
      { Body: null, k: 'z' },
    ];
    const { result } = renderHook(() =>
      useDenoisedRows({
        config: config("Timestamp, Body, LogAttributes['k'] AS k"),
        source,
        columns: ['Timestamp', 'Body', 'k'],
        rows,
        enabled: true,
      }),
    );
    expect(mockUseGroupedPatterns).toHaveBeenLastCalledWith(
      expect.objectContaining({ bodyValueExpression: 'Body', enabled: true }),
    );
    expect(result.current.skipped).toBeUndefined();
    expect(result.current.noisyPatterns.map(p => p.id)).toEqual(['1']);
    expect(result.current.rows).toEqual([rows[1], rows[2]]);
  });

  it('never hides a pattern with error or warning samples', () => {
    mockUseGroupedPatterns.mockReturnValue({
      ...patternQueryState,
      sampledRowCount: 100,
      data: {
        '1': {
          id: '1',
          pattern: 'connection refused to <*>',
          count: 80,
          samples: [{ __hdx_level: 'INFO' }, { __hdx_level: 'ERROR' }],
        },
        '2': {
          id: '2',
          pattern: 'user <*> logged in',
          count: 20,
          samples: [{ __hdx_level: 'info' }],
        },
      },
      clusterTemplates: {
        '1': 'connection refused to <*>',
        '2': 'user <*> logged in',
      },
    });
    const rows = [
      { Body: 'connection refused to db1' },
      { Body: 'user bob logged in' },
    ];
    const { result } = renderHook(() =>
      useDenoisedRows({
        config: config('Timestamp, Body'),
        source,
        columns: ['Timestamp', 'Body'],
        rows,
        enabled: true,
      }),
    );
    expect(result.current.noisyPatterns.map(p => p.id)).toEqual(['2']);
    expect(result.current.rows).toEqual([rows[0]]);
  });

  it('skips denoising when the body is not in the results', () => {
    const rows = [{ ServiceName: 'api' }];
    const { result } = renderHook(() =>
      useDenoisedRows({
        config: config('Timestamp, ServiceName'),
        source,
        columns: ['Timestamp', 'ServiceName'],
        rows,
        enabled: true,
      }),
    );
    expect(mockUseGroupedPatterns).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(result.current.skipped).toBe('body_not_in_results');
    expect(result.current.rows).toBe(rows);
  });
});
