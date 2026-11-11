import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  mcpUrl,
  upsertCodexServer,
  upsertJsonServer,
  verifyKey,
} from '@/mcp/install';

const server = { url: 'https://example.com/api/mcp', key: 'hdx_org_abc' };

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdx-mcp-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('mcpUrl', () => {
  it('appends /api/mcp without doubling slashes', () => {
    expect(mcpUrl('https://example.com/')).toBe('https://example.com/api/mcp');
  });
});

describe('upsertJsonServer', () => {
  it('adds the server and keeps other servers and settings', () => {
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ theme: 'dark', mcpServers: { other: { url: 'x' } } }),
    );
    upsertJsonServer(file, 'mcpServers', { url: server.url });
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
      theme: 'dark',
      mcpServers: { other: { url: 'x' }, clickstack: { url: server.url } },
    });
  });

  it('creates the file and its directory with owner-only permissions', () => {
    const file = path.join(dir, 'nested', 'mcp.json');
    upsertJsonServer(file, 'servers', { url: server.url });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('tightens an existing config to owner-only before writing the key', () => {
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    upsertJsonServer(file, 'servers', { url: server.url });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refuses JSON that is not an object', () => {
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, 'null');
    expect(() => upsertJsonServer(file, 'servers', {})).toThrow(
      /Could not parse/,
    );
  });

  it('refuses to rewrite a file it cannot parse', () => {
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, '{ // comment\n "servers": {} }');
    expect(() => upsertJsonServer(file, 'servers', {})).toThrow(
      /Could not parse/,
    );
    expect(fs.readFileSync(file, 'utf-8')).toContain('// comment');
  });
});

describe('upsertCodexServer', () => {
  it('replaces an existing clickstack table and keeps the rest', () => {
    const file = path.join(dir, 'config.toml');
    fs.writeFileSync(
      file,
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.clickstack]',
        'url = "https://old/api/mcp"',
        '',
        '[mcp_servers.clickstack.env]',
        'A = "1"',
        '',
        '[mcp_servers.other]',
        'command = "other"',
        '',
      ].join('\n'),
    );
    upsertCodexServer(file, server);
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain('[mcp_servers.other]\ncommand = "other"');
    expect(out).not.toContain('https://old');
    expect(out).not.toContain('[mcp_servers.clickstack.env]');
    expect(
      out
        .trimEnd()
        .endsWith(
          [
            '[mcp_servers.clickstack]',
            'url = "https://example.com/api/mcp"',
            'http_headers = { Authorization = "Bearer hdx_org_abc" }',
          ].join('\n'),
        ),
    ).toBe(true);
  });

  it('creates the config when Codex has none yet', () => {
    const file = path.join(dir, '.codex', 'config.toml');
    upsertCodexServer(file, server);
    expect(fs.readFileSync(file, 'utf-8')).toBe(
      '[mcp_servers.clickstack]\nurl = "https://example.com/api/mcp"\nhttp_headers = { Authorization = "Bearer hdx_org_abc" }\n',
    );
  });
});

describe('verifyKey', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const respond = (status: number, body: unknown = {}) => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(body, { status }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('names an org key by its description and checks through the app proxy', async () => {
    const fetchMock = respond(200, {
      user: { name: 'terraform', email: 'sa-1@x.invalid', isVirtual: true },
    });
    await expect(verifyKey('https://example.com/', 'k')).resolves.toEqual({
      name: 'terraform',
      isServiceAccount: true,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/api/api/v2', {
      headers: { Authorization: 'Bearer k' },
    });
  });

  it('names a personal key by email', async () => {
    respond(200, { user: { name: 'Ada', email: 'ada@example.com' } });
    await expect(verifyKey('https://example.com', 'k')).resolves.toEqual({
      name: 'ada@example.com',
      isServiceAccount: false,
    });
  });

  it('rejects a revoked or wrong key', async () => {
    respond(401);
    await expect(verifyKey('https://example.com', 'k')).rejects.toThrow(
      /rejected/,
    );
  });
});
