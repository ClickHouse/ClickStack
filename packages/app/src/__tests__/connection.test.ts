const mockConfig = { IS_LOCAL_MODE: false };
jest.mock('@/config', () => ({
  HDX_LOCAL_DEFAULT_CONNECTIONS: undefined,
  get IS_LOCAL_MODE() {
    return mockConfig.IS_LOCAL_MODE;
  },
}));

const mockHdxServer = jest.fn();
jest.mock('@/api', () => ({
  hdxServer: (...args: unknown[]) => mockHdxServer(...args),
}));

import { fetchPrometheusHttpApiSupport } from '@/connection';

const answers = (body: unknown) =>
  mockHdxServer.mockReturnValue({ json: () => Promise.resolve(body) });

describe('fetchPrometheusHttpApiSupport', () => {
  beforeEach(() => {
    mockHdxServer.mockReset();
    mockConfig.IS_LOCAL_MODE = false;
  });

  it('asks the server about the connection', async () => {
    answers({ supported: true });

    await expect(fetchPrometheusHttpApiSupport('conn-1')).resolves.toBe(true);
    expect(mockHdxServer).toHaveBeenCalledWith(
      'connections/conn-1/prometheus-http-api',
    );
  });

  it('reports a server that does not serve it', async () => {
    answers({ supported: false });

    await expect(fetchPrometheusHttpApiSupport('conn-1')).resolves.toBe(false);
  });

  it('reports false when the server cannot be asked', async () => {
    mockHdxServer.mockReturnValue({
      json: () => Promise.reject(new Error('boom')),
    });

    await expect(fetchPrometheusHttpApiSupport('conn-1')).resolves.toBe(false);
  });

  it('does not ask the server about a local-mode connection', async () => {
    mockConfig.IS_LOCAL_MODE = true;

    await expect(fetchPrometheusHttpApiSupport('local')).resolves.toBe(false);
    expect(mockHdxServer).not.toHaveBeenCalled();
  });
});
