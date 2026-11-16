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
  isValidServerName,
  listTeams,
  mcpClients,
  mcpUrl,
  teamServers,
  upsertCodexServer,
  upsertJsonServer,
  verifyKey,
} from '@/mcp/install';

const server = {
  name: 'clickstack',
  url: 'https://example.com/api/mcp',
  key: 'hdx_org_abc',
};

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
    upsertJsonServer(file, 'mcpServers', 'clickstack', { url: server.url });
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
      theme: 'dark',
      mcpServers: { other: { url: 'x' }, clickstack: { url: server.url } },
    });
  });

  it('keeps an entry installed under another name', () => {
    const file = path.join(dir, 'mcp.json');
    upsertJsonServer(file, 'mcpServers', 'clickstack', { url: 'a' });
    upsertJsonServer(file, 'mcpServers', 'clickstack-staging', { url: 'b' });
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).mcpServers).toEqual({
      clickstack: { url: 'a' },
      'clickstack-staging': { url: 'b' },
    });
  });

  it('creates the file and its directory with owner-only permissions', () => {
    const file = path.join(dir, 'nested', 'mcp.json');
    upsertJsonServer(file, 'servers', 'clickstack', { url: server.url });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('tightens an existing config to owner-only before writing the key', () => {
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    upsertJsonServer(file, 'servers', 'clickstack', { url: server.url });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refuses JSON that is not an object', () => {
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, 'null');
    expect(() => upsertJsonServer(file, 'servers', 'clickstack', {})).toThrow(
      /Could not parse/,
    );
  });

  it('refuses to rewrite a file it cannot parse', () => {
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, '{ // comment\n "servers": {} }');
    expect(() => upsertJsonServer(file, 'servers', 'clickstack', {})).toThrow(
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

  it('keeps a table installed under a name that shares a prefix', () => {
    const file = path.join(dir, 'config.toml');
    upsertCodexServer(file, { ...server, name: 'clickstack-staging' });
    upsertCodexServer(file, { ...server, url: 'https://prd/api/mcp' });
    upsertCodexServer(file, { ...server, url: 'https://prd2/api/mcp' });
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toContain(
      '[mcp_servers.clickstack-staging]\nurl = "https://example.com/api/mcp"',
    );
    expect(out).toContain(
      '[mcp_servers.clickstack]\nurl = "https://prd2/api/mcp"',
    );
    expect(out).not.toContain('https://prd/');
  });

  it('writes the team header when a team was chosen', () => {
    const file = path.join(dir, 'config.toml');
    upsertCodexServer(file, { ...server, teamId: 't1' });
    expect(fs.readFileSync(file, 'utf-8')).toContain(
      'http_headers = { Authorization = "Bearer hdx_org_abc", x-hdx-team = "t1" }',
    );
  });

  it('creates the config when Codex has none yet', () => {
    const file = path.join(dir, '.codex', 'config.toml');
    upsertCodexServer(file, server);
    expect(fs.readFileSync(file, 'utf-8')).toBe(
      '[mcp_servers.clickstack]\nurl = "https://example.com/api/mcp"\nhttp_headers = { Authorization = "Bearer hdx_org_abc" }\n',
    );
  });
});

describe('mcpClients', () => {
  const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));
  const install = (id: string, teamId?: string) =>
    mcpClients(dir, 'linux')
      .find(c => c.id === id)!
      .install({ ...server, name: 'clickstack-prd', teamId });

  it('writes the team header for Cursor and VS Code', () => {
    install('cursor', 't1');
    install('vscode', 't1');
    const headers = { Authorization: 'Bearer hdx_org_abc', 'x-hdx-team': 't1' };
    expect(
      readJson(path.join(dir, '.cursor', 'mcp.json')).mcpServers[
        'clickstack-prd'
      ].headers,
    ).toEqual(headers);
    expect(
      readJson(path.join(dir, '.config', 'Code', 'User', 'mcp.json')).servers[
        'clickstack-prd'
      ].headers,
    ).toEqual(headers);
  });

  it('writes no team header when no team was chosen', () => {
    install('cursor');
    expect(
      readJson(path.join(dir, '.cursor', 'mcp.json')).mcpServers[
        'clickstack-prd'
      ].headers,
    ).toEqual({ Authorization: 'Bearer hdx_org_abc' });
  });
});

describe('teamServers', () => {
  const team = (id: string, name: string) => ({ id, name, isCurrent: false });

  it('keeps the name for one team and for no team', () => {
    expect(teamServers(server, [])).toEqual([{ ...server, teamId: undefined }]);
    expect(teamServers(server, [team('a', 'Demo')])).toEqual([
      { ...server, teamId: 'a' },
    ]);
  });

  it('names one entry per team, falling back to the id on a clash', () => {
    expect(
      teamServers(server, [
        team('a', 'Prod EU'),
        team('b', 'Demo!'),
        team('c', 'demo'),
        team('d', '***'),
      ]).map(s => [s.name, s.teamId]),
    ).toEqual([
      ['clickstack-prod-eu', 'a'],
      ['clickstack-b', 'b'],
      ['clickstack-c', 'c'],
      ['clickstack-d', 'd'],
    ]);
  });
});

describe('isValidServerName', () => {
  it('rejects names that would break a TOML table header', () => {
    expect(isValidServerName('clickstack-prd_2')).toBe(true);
    expect(isValidServerName('a.b')).toBe(false);
    expect(isValidServerName('a]')).toBe(false);
    expect(isValidServerName('-h')).toBe(false);
    expect(isValidServerName('')).toBe(false);
  });
});

describe('listTeams', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const respondText = (text: string, status = 200) => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(text, { status });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };
  const sse = (toolText: string) =>
    `event: message\ndata: ${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: toolText }] },
    })}\n\n`;
  const toolError = `event: message\ndata: ${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      isError: true,
      content: [{ type: 'text', text: 'MCP error -32602: Tool not found' }],
    },
  })}\n\n`;

  it('reads teams from the MCP endpoint', async () => {
    const teams = [
      { id: 'a', name: 'Demo', isCurrent: true },
      { id: 'b', name: 'Prod', isCurrent: false },
    ];
    const fetchMock = respondText(sse(JSON.stringify({ teams })));
    await expect(listTeams('https://example.com/', 'k')).resolves.toEqual(
      teams,
    );
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/api/mcp');
  });

  it('returns no teams when the server has no team listing', async () => {
    respondText(toolError);
    await expect(listTeams('https://example.com', 'k')).resolves.toEqual([]);
  });

  it('throws when the listing failed, so it is not read as one team', async () => {
    respondText('Too many requests', 429);
    await expect(listTeams('https://example.com', 'k')).rejects.toThrow(/429/);
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
