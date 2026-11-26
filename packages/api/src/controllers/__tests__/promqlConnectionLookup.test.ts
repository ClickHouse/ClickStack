const mockGetSource = jest.fn();
const mockGetConnectionById = jest.fn();

jest.mock('@/controllers/sources', () => ({
  getSource: (...args: unknown[]) => mockGetSource(...args),
}));
jest.mock('@/controllers/connection', () => ({
  getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
}));

import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  getPromqlLabelCatalog,
  resolvePromqlTarget,
} from '@/controllers/promql';

const promqlSource = {
  kind: SourceKind.Promql,
  connection: 'conn-1',
  from: { databaseName: 'db', tableName: 'ts' },
};
const connection = { id: 'conn-1', host: 'http://ch:8123' };

describe('PromQL connection lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSource.mockResolvedValue(promqlSource);
  });

  it('resolvePromqlTarget defaults to the team-scoped lookup', async () => {
    mockGetConnectionById.mockResolvedValue(connection);

    const target = await resolvePromqlTarget('team-1', 'source-1', {
      selectPassword: false,
    });

    expect(target).toMatchObject({ connection, databaseName: 'db' });
    expect(mockGetConnectionById).toHaveBeenCalledWith(
      'team-1',
      'conn-1',
      false,
    );
  });

  it('resolvePromqlTarget uses the given lookup instead', async () => {
    const getConnection = jest.fn().mockResolvedValue(connection);

    const target = await resolvePromqlTarget('team-1', 'source-1', {
      selectPassword: true,
      getConnection,
    });

    expect(target).toMatchObject({ connection });
    expect(getConnection).toHaveBeenCalledWith('conn-1', {
      selectPassword: true,
    });
    expect(mockGetConnectionById).not.toHaveBeenCalled();
  });

  it('resolvePromqlTarget returns 404 when the lookup finds nothing', async () => {
    await expect(
      resolvePromqlTarget('team-1', 'source-1', {
        selectPassword: true,
        getConnection: async () => null,
      }),
    ).resolves.toEqual({ status: 404, error: 'Connection not found' });
  });

  it('getPromqlLabelCatalog uses the given lookup, with the password', async () => {
    const getConnection = jest.fn().mockResolvedValue(null);

    await expect(
      getPromqlLabelCatalog({
        teamId: 'team-1',
        source: promqlSource,
        startMs: 0,
        endMs: 1000,
        limit: 10,
        getConnection,
      }),
    ).rejects.toThrow('Connection not found');
    expect(getConnection).toHaveBeenCalledWith('conn-1', {
      selectPassword: true,
    });
    expect(mockGetConnectionById).not.toHaveBeenCalled();
  });
});
