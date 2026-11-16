import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Same server name the Team Settings snippets use, so a reinstall replaces
// an entry added by hand instead of adding a second one.
export const DEFAULT_MCP_SERVER_NAME = 'clickstack';

// The name is a TOML bare key in Codex's config and a `claude mcp add`
// argument, where a leading hyphen would read as a flag.
export function isValidServerName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
}

export interface McpServer {
  name: string;
  url: string;
  key: string;
  /** Sent as `x-hdx-team`. Unset means the key's default team. */
  teamId?: string;
}

export interface McpTeam {
  id: string;
  name: string;
  isCurrent: boolean;
}

export interface McpClient {
  id: 'claude-code' | 'codex' | 'cursor' | 'vscode';
  label: string;
  /** Where the key ends up, shown to the user after install. */
  location: string;
  detect: () => boolean;
  /** Whether an entry with this name is already configured. */
  has: (name: string) => boolean;
  install: (server: McpServer) => void;
}

export interface KeyIdentity {
  name: string;
  isServiceAccount: boolean;
}

export function mcpUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/mcp`;
}

/** Returns who the key authenticates as, or throws with a message for the user. */
export async function verifyKey(
  appUrl: string,
  key: string,
): Promise<KeyIdentity> {
  let res: Response;
  try {
    // The app's /api proxy strips its prefix, and the external API itself is
    // mounted at /api/v2, hence the doubled segment.
    res = await fetch(`${appUrl.replace(/\/+$/, '')}/api/api/v2`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (e) {
    throw new Error(
      `Could not reach ${appUrl}: ${e instanceof Error ? e.message : e}`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'The key was rejected. It may be wrong, revoked, or expired.',
    );
  }
  if (!res.ok) {
    throw new Error(`Could not check the key (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as {
    user?: { name?: string; email?: string; isVirtual?: boolean };
  };
  const user = body.user ?? {};
  return {
    // A service account's email is synthetic; its name is the key description.
    name: (user.isVirtual ? user.name : user.email) ?? user.name ?? 'unknown',
    isServiceAccount: !!user.isVirtual,
  };
}

/**
 * Teams the key can act on, read from the MCP server's own
 * `clickstack_list_teams` tool. Empty when the server has no such tool
 * (single-team deployments), so the caller skips the team choice. Throws when
 * the listing itself failed, so that is not mistaken for a single team.
 */
export async function listTeams(
  appUrl: string,
  key: string,
): Promise<McpTeam[]> {
  const res = await fetch(mcpUrl(appUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'clickstack_list_teams', arguments: {} },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // The endpoint answers with a one-message SSE stream.
  const message =
    text
      .split('\n')
      .find(line => line.startsWith('data:'))
      ?.slice(5) ?? text;
  const { result, error } = JSON.parse(message);
  // Only an unknown tool means "no team listing". The SDK reports it as an
  // error result (or a -32601/-32602 error); any other error is a failure.
  const failure: string | undefined = result?.isError
    ? String(result.content?.[0]?.text ?? 'tool error')
    : error
      ? String(error.message ?? 'error')
      : undefined;
  if (failure != null) {
    const unknownTool =
      /tool .*not found/i.test(failure) ||
      error?.code === -32601 ||
      error?.code === -32602;
    if (unknownTool) return [];
    throw new Error(failure);
  }
  const { teams } = JSON.parse(result.content[0].text);
  // The id ends up in a header value and, with several teams, a server name.
  return (teams as McpTeam[]).filter(
    t =>
      typeof t.id === 'string' &&
      isValidServerName(t.id) &&
      typeof t.name === 'string',
  );
}

/**
 * One server per chosen team. A single team (or none) keeps the server's
 * name; several teams get `<name>-<team>` each.
 */
export function teamServers(server: McpServer, teams: McpTeam[]): McpServer[] {
  if (teams.length <= 1) return [{ ...server, teamId: teams[0]?.id }];
  const slugs = teams.map(t =>
    t.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  );
  return teams.map((t, i) => {
    const slug = slugs[i];
    // Use the id when the name has no usable characters or two teams share it.
    const unique = slug && slugs.indexOf(slug) === slugs.lastIndexOf(slug);
    return {
      ...server,
      name: `${server.name}-${unique ? slug : t.id}`,
      teamId: t.id,
    };
  });
}

function onPath(command: string): boolean {
  return !spawnSync(command, ['--version'], { stdio: 'ignore' }).error;
}

function serverHeaders({ key, teamId }: McpServer): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    ...(teamId ? { 'x-hdx-team': teamId } : {}),
  };
}

/** Sets `<topKey>.<name>` in a JSON config, keeping everything else. */
export function upsertJsonServer(
  file: string,
  topKey: string,
  name: string,
  entry: Record<string, unknown>,
): void {
  let config: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      // Rewriting a file we can't parse (e.g. JSONC comments) would lose them.
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Could not parse ${file}. Add the server by hand.`);
    }
    config = parsed as Record<string, unknown>;
  }
  const servers = (config[topKey] ?? {}) as Record<string, unknown>;
  config[topKey] = { ...servers, [name]: entry };
  writePrivate(file, `${JSON.stringify(config, null, 2)}\n`);
}

// writeFileSync's `mode` only applies on create, so tighten existing files too.
function writePrivate(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** Replaces the `[mcp_servers.<name>]` table (and its subtables) in Codex's config.toml. */
export function upsertCodexServer(file: string, server: McpServer): void {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const header = codexTableHeader(server.name);
  const kept: string[] = [];
  let skipping = false;
  // shortcut: line-based table removal, no TOML parser. Fine for tables we
  // wrote; a hand-written multi-line value inside ours could be split.
  for (const line of existing.split('\n')) {
    if (line.trimStart().startsWith('[')) {
      skipping = header.test(line.trim());
    }
    if (!skipping) kept.push(line);
  }
  const body = kept.join('\n').trimEnd();
  const table = [
    `[mcp_servers.${server.name}]`,
    `url = ${tomlString(server.url)}`,
    `http_headers = { ${Object.entries(serverHeaders(server))
      .map(([k, v]) => `${k} = ${tomlString(v)}`)
      .join(', ')} }`,
  ].join('\n');
  writePrivate(file, `${body ? `${body}\n\n` : ''}${table}\n`);
}

function vscodeUserDir(home: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User');
  }
  if (platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      'Code',
      'User',
    );
  }
  return path.join(home, '.config', 'Code', 'User');
}

function readJsonObject(file: string): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) ?? {};
  } catch {
    return {};
  }
}

function hasKey(servers: unknown, name: string): boolean {
  return servers != null && Object.hasOwn(servers, name);
}

function codexTableHeader(name: string): RegExp {
  return new RegExp(`^\\[mcp_servers\\.${name}(\\.|\\])`);
}

function runClaude(args: string[]): void {
  const res = spawnSync('claude', args, { encoding: 'utf-8' });
  if (res.error || res.status !== 0) {
    throw new Error(
      (res.stderr || res.error?.message || 'claude mcp add failed').trim(),
    );
  }
}

export function mcpClients(
  home = os.homedir(),
  platform = process.platform,
): McpClient[] {
  const codexConfig = path.join(home, '.codex', 'config.toml');
  const cursorConfig = path.join(home, '.cursor', 'mcp.json');
  const vscodeDir = vscodeUserDir(home, platform);
  const vscodeConfig = path.join(vscodeDir, 'mcp.json');

  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      location: 'Claude Code user config (~/.claude.json)',
      detect: () => onPath('claude'),
      has: name => {
        const config = readJsonObject(path.join(home, '.claude.json'));
        return (
          hasKey(config.mcpServers, name) ||
          hasKey(config.projects?.[process.cwd()]?.mcpServers, name)
        );
      },
      install: server => {
        const { name, url } = server;
        // `mcp add` refuses to overwrite, so drop any earlier entry first. A
        // local-scope entry for this directory would also shadow the new one.
        for (const scope of ['local', 'user']) {
          spawnSync('claude', ['mcp', 'remove', '--scope', scope, name], {
            stdio: 'ignore',
          });
        }
        runClaude([
          'mcp',
          'add',
          '--scope',
          'user',
          '--transport',
          'http',
          name,
          url,
          ...Object.entries(serverHeaders(server)).flatMap(([k, v]) => [
            '--header',
            `${k}: ${v}`,
          ]),
        ]);
      },
    },
    {
      id: 'codex',
      label: 'Codex',
      location: codexConfig,
      detect: () => fs.existsSync(path.dirname(codexConfig)) || onPath('codex'),
      has: name =>
        fs.existsSync(codexConfig) &&
        fs
          .readFileSync(codexConfig, 'utf-8')
          .split('\n')
          .some(line => codexTableHeader(name).test(line.trim())),
      install: server => upsertCodexServer(codexConfig, server),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      location: cursorConfig,
      detect: () => fs.existsSync(path.dirname(cursorConfig)),
      has: name => hasKey(readJsonObject(cursorConfig).mcpServers, name),
      install: server =>
        upsertJsonServer(cursorConfig, 'mcpServers', server.name, {
          url: server.url,
          headers: serverHeaders(server),
        }),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      location: vscodeConfig,
      detect: () => fs.existsSync(vscodeDir),
      has: name => hasKey(readJsonObject(vscodeConfig).servers, name),
      install: server =>
        upsertJsonServer(vscodeConfig, 'servers', server.name, {
          type: 'http',
          url: server.url,
          headers: serverHeaders(server),
        }),
    },
  ];
}
