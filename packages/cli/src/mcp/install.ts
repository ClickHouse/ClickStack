import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Same server name the Team Settings snippets use, so a reinstall replaces
// an entry added by hand instead of adding a second one.
const MCP_SERVER_NAME = 'clickstack';

export interface McpServer {
  url: string;
  key: string;
}

export interface McpClient {
  id: 'claude-code' | 'codex' | 'cursor' | 'vscode';
  label: string;
  /** Where the key ends up, shown to the user after install. */
  location: string;
  detect: () => boolean;
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

function onPath(command: string): boolean {
  return !spawnSync(command, ['--version'], { stdio: 'ignore' }).error;
}

function authHeaders(key: string) {
  return { Authorization: `Bearer ${key}` };
}

/** Sets `<topKey>.<MCP_SERVER_NAME>` in a JSON config, keeping everything else. */
export function upsertJsonServer(
  file: string,
  topKey: string,
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
  config[topKey] = { ...servers, [MCP_SERVER_NAME]: entry };
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

/** Replaces the `[mcp_servers.clickstack]` table (and its subtables) in Codex's config.toml. */
export function upsertCodexServer(file: string, server: McpServer): void {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const header = new RegExp(`^\\[mcp_servers\\.${MCP_SERVER_NAME}(\\.|\\])`);
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
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `url = ${tomlString(server.url)}`,
    `http_headers = { Authorization = ${tomlString(`Bearer ${server.key}`)} }`,
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
      install: ({ url, key }) => {
        // `mcp add` refuses to overwrite, so drop any earlier entry first. A
        // local-scope entry for this directory would also shadow the new one.
        for (const scope of ['local', 'user']) {
          spawnSync(
            'claude',
            ['mcp', 'remove', '--scope', scope, MCP_SERVER_NAME],
            {
              stdio: 'ignore',
            },
          );
        }
        runClaude([
          'mcp',
          'add',
          '--scope',
          'user',
          '--transport',
          'http',
          MCP_SERVER_NAME,
          url,
          '--header',
          `Authorization: Bearer ${key}`,
        ]);
      },
    },
    {
      id: 'codex',
      label: 'Codex',
      location: codexConfig,
      detect: () => fs.existsSync(path.dirname(codexConfig)) || onPath('codex'),
      install: server => upsertCodexServer(codexConfig, server),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      location: cursorConfig,
      detect: () => fs.existsSync(path.dirname(cursorConfig)),
      install: ({ url, key }) =>
        upsertJsonServer(cursorConfig, 'mcpServers', {
          url,
          headers: authHeaders(key),
        }),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      location: vscodeConfig,
      detect: () => fs.existsSync(vscodeDir),
      install: ({ url, key }) =>
        upsertJsonServer(vscodeConfig, 'servers', {
          type: 'http',
          url,
          headers: authHeaders(key),
        }),
    },
  ];
}
