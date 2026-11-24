const mockGetSource = jest.fn();
const mockGetSources = jest.fn();

jest.mock('@/controllers/sources', () => ({
  getSource: (...args: unknown[]) => mockGetSource(...args),
  getSources: (...args: unknown[]) => mockGetSources(...args),
}));

import { SourceKind } from '@hyperdx/common-utils/dist/types';

import type { McpContext } from '@/mcp/tools/types';
import {
  getMcpSource,
  getMcpSources,
  getVisibleMcpSource,
  getVisibleMcpSources,
} from '@/mcp/utils/sources';

const logSource = { _id: 'log-1', kind: SourceKind.Log };
const promqlSource = { _id: 'promql-1', kind: SourceKind.Promql };

const context = (promqlEnabled: boolean): McpContext => ({
  teamId: 'team-1',
  userId: 'user-1',
  promqlEnabled,
});

describe('MCP source lookup', () => {
  beforeEach(() => {
    mockGetSource.mockReset();
    mockGetSources.mockReset();
  });

  it('getMcpSource scopes the lookup to the caller team', async () => {
    mockGetSource.mockResolvedValue(logSource);
    await expect(getMcpSource(context(true), 'log-1')).resolves.toBe(logSource);
    expect(mockGetSource).toHaveBeenCalledWith('team-1', 'log-1');
  });

  it('getMcpSource returns null when the source is not found', async () => {
    mockGetSource.mockResolvedValue(null);
    await expect(getMcpSource(context(true), 'missing')).resolves.toBeNull();
  });

  it('getMcpSource and getMcpSources do not hide PromQL sources', async () => {
    mockGetSource.mockResolvedValue(promqlSource);
    mockGetSources.mockResolvedValue([logSource, promqlSource]);
    await expect(getMcpSource(context(false), 'promql-1')).resolves.toBe(
      promqlSource,
    );
    await expect(getMcpSources(context(false))).resolves.toEqual([
      logSource,
      promqlSource,
    ]);
    expect(mockGetSources).toHaveBeenCalledWith('team-1');
  });

  it('getVisibleMcpSources drops PromQL sources only while PromQL is off', async () => {
    mockGetSources.mockResolvedValue([logSource, promqlSource]);
    await expect(getVisibleMcpSources(context(false))).resolves.toEqual([
      logSource,
    ]);
    await expect(getVisibleMcpSources(context(true))).resolves.toEqual([
      logSource,
      promqlSource,
    ]);
  });

  it('getVisibleMcpSource returns null for a hidden or missing source', async () => {
    mockGetSource.mockResolvedValue(promqlSource);
    await expect(
      getVisibleMcpSource(context(false), 'promql-1'),
    ).resolves.toBeNull();
    await expect(getVisibleMcpSource(context(true), 'promql-1')).resolves.toBe(
      promqlSource,
    );

    mockGetSource.mockResolvedValue(null);
    await expect(
      getVisibleMcpSource(context(true), 'missing'),
    ).resolves.toBeNull();
  });
});
