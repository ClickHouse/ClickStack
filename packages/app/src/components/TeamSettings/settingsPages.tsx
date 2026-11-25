import * as React from 'react';
import { type TeamClickHouseSettings } from '@hyperdx/common-utils/dist/types';
import {
  IconAdjustmentsHorizontal,
  IconBrandTerraform,
  IconDatabase,
  IconKey,
  IconPlugConnected,
  IconRobot,
  IconShieldLock,
  IconUsers,
  IconWebhook,
} from '@tabler/icons-react';

import { IS_IAC_EXPORT_ENABLED } from '@/config';

export type SettingsGroup = 'Data' | 'Team' | 'Alerting' | 'Developer';

export type SettingsPageId =
  | 'sources'
  | 'connections'
  | 'query-settings'
  | 'members'
  | 'security-policies'
  | 'webhooks'
  | 'api-keys'
  | 'mcp'
  | 'terraform';

/** A single setting inside a page, so search can find it. `anchor` is its element id. */
export type SettingsItem = {
  anchor: string;
  label: string;
  keywords?: string[];
};

/** One Team settings page: a sidebar entry, its `?tab=` value, and a spotlight action. */
export type SettingsPage = {
  id: SettingsPageId;
  group: SettingsGroup;
  label: string;
  description: string;
  icon: React.ReactNode;
  keywords: string[];
  badge?: string;
  /** External docs shown under the page description. */
  links?: { label: string; href: string }[];
  items?: SettingsItem[];
  // Only shown when the team restricts sign-in methods, which spotlight can't know.
  requiresAuthPolicy?: boolean;
};

/** Field labels on the query settings page, shared with search so they can't drift. */
export const QUERY_SETTINGS = {
  searchRowLimit: {
    label: 'Search row limit',
    keywords: ['rows', 'search page', 'results'],
  },
  queryTimeout: {
    label: 'Query timeout (seconds)',
    keywords: ['max execution time', 'slow'],
  },
  metadataMaxRowsToRead: {
    label: 'Max rows to read (metadata only)',
    keywords: ['metadata', 'rows'],
  },
  filterKeysFetchLimit: {
    label: 'Filter keys fetch limit',
    keywords: ['filters', 'map columns', 'attributes'],
  },
  filterValuesExactByDefault: {
    label: 'Default filter values',
    keywords: ['filters', 'exact', 'show all values'],
  },
  fieldMetadataDisabled: {
    label: 'Field metadata queries',
    keywords: ['metadata', 'fields'],
  },
  parallelizeWhenPossible: {
    label: 'Parallelize queries when possible',
    keywords: ['parallel', 'concurrency', 'series', 'windowed'],
  },
} satisfies Partial<
  Record<keyof TeamClickHouseSettings, { label: string; keywords: string[] }>
>;

export const querySettingAnchor = (key: string) => `setting-${key}`;

const API_DOCS = {
  label: 'Cloud API reference',
  href: 'https://clickhouse.com/docs/products/cloud/api-reference/organization/get-list-of-available-organizations#tag/ClickStack',
};
const TERRAFORM_DOCS = {
  label: 'Terraform provider',
  href: 'https://registry.terraform.io/providers/ClickHouse/clickhouse/latest/docs#clickstack',
};

export const SETTINGS_GROUPS: SettingsGroup[] = [
  'Data',
  'Team',
  'Alerting',
  'Developer',
];

export const SETTINGS_PAGES: SettingsPage[] = [
  {
    id: 'sources',
    group: 'Data',
    label: 'Sources',
    description: 'Tables to read logs, traces, metrics, and sessions from.',
    icon: <IconDatabase size={16} />,
    keywords: ['data', 'source', 'table', 'schema', 'logs', 'traces'],
  },
  {
    id: 'connections',
    group: 'Data',
    label: 'Connections',
    description: 'ClickHouse servers your sources connect to.',
    icon: <IconPlugConnected size={16} />,
    keywords: ['data', 'clickhouse', 'database', 'host', 'password'],
  },
  {
    id: 'query-settings',
    group: 'Data',
    label: 'Query settings',
    description: "ClickHouse settings for your team's queries.",
    icon: <IconAdjustmentsHorizontal size={16} />,
    keywords: ['clickhouse', 'query', 'advanced'],
    items: Object.entries(QUERY_SETTINGS).map(([key, setting]) => ({
      anchor: querySettingAnchor(key),
      ...setting,
    })),
  },
  {
    id: 'members',
    group: 'Team',
    label: 'Members',
    description: 'Invite and manage team members.',
    icon: <IconUsers size={16} />,
    keywords: ['users', 'invite', 'people', 'members', 'team'],
  },
  {
    id: 'security-policies',
    group: 'Team',
    label: 'Security policies',
    description: 'Allowed sign-in methods.',
    icon: <IconShieldLock size={16} />,
    keywords: ['access', 'auth', 'sso', 'login', 'security'],
    requiresAuthPolicy: true,
  },
  {
    id: 'webhooks',
    group: 'Alerting',
    label: 'Webhooks',
    description: 'Where alert notifications are sent.',
    icon: <IconWebhook size={16} />,
    keywords: ['integrations', 'slack', 'pagerduty', 'incident.io', 'alerts'],
  },
  {
    id: 'api-keys',
    group: 'Developer',
    label: 'API keys',
    description: 'Keys for ingestion, automation, and the API.',
    icon: <IconKey size={16} />,
    keywords: ['api', 'key', 'token'],
    links: [API_DOCS, TERRAFORM_DOCS],
    items: [
      {
        anchor: 'setting-ingestion-api-key',
        label: 'Ingestion API key',
        keywords: ['collector', 'sdk', 'otel'],
      },
      {
        anchor: 'setting-personal-access-key',
        label: 'Personal access key',
        keywords: ['mcp', 'api v2', 'terraform', 'bearer'],
      },
      {
        anchor: 'setting-org-api-keys',
        label: 'Organization API keys',
        keywords: ['org', 'service account', 'ci', 'automation'],
      },
    ],
  },
  {
    id: 'mcp',
    group: 'Developer',
    label: 'AI agents',
    description: 'Connect AI agents through the MCP server.',
    icon: <IconRobot size={16} />,
    keywords: ['mcp', 'ai', 'agents', 'llm', 'claude', 'cursor', 'codex'],
  },
  ...(IS_IAC_EXPORT_ENABLED
    ? [
        {
          id: 'terraform' as const,
          group: 'Developer' as const,
          label: 'Terraform export',
          description: "Export this team's resources as Terraform.",
          icon: <IconBrandTerraform size={16} />,
          keywords: ['terraform', 'iac', 'export', 'infrastructure'],
          badge: 'Experimental',
          links: [TERRAFORM_DOCS],
        },
      ]
    : []),
];

// Tab values and section anchors from before each setting had its own page.
// Bookmarks and docs still use them.
const LEGACY_TABS: Record<string, SettingsPageId> = {
  data: 'sources',
  team: 'members',
  access: 'security-policies',
  'api-agents': 'api-keys',
  integrations: 'webhooks',
  advanced: 'query-settings',
};
const LEGACY_ANCHORS: Record<string, SettingsPageId> = {
  sources: 'sources',
  'team-data-sources': 'sources',
  'team-data-connections': 'connections',
  'team-members': 'members',
  'team-access-security-policies': 'security-policies',
  'team-api-agents-api-keys': 'api-keys',
  'team-api-agents-org-api-keys': 'api-keys',
  'team-api-agents-mcp-server': 'mcp',
  'team-api-agents-iac': 'terraform',
  'team-integrations-webhooks': 'webhooks',
  'team-advanced-query-settings': 'query-settings',
};

/**
 * Picks the page for a `?tab=` value and URL hash. `legacyAnchor` is true
 * when the hash only existed to pick an old section, so callers can drop it.
 */
export function resolveSettingsPage(
  pages: SettingsPage[],
  tab: string | null,
  hash: string,
): { id: SettingsPageId; legacyAnchor: boolean } {
  const has = (id?: string): id is SettingsPageId =>
    id != null && pages.some(page => page.id === id);
  const fromAnchor = LEGACY_ANCHORS[hash];
  if (has(fromAnchor)) return { id: fromAnchor, legacyAnchor: true };
  const current = tab ?? undefined;
  if (has(current)) return { id: current, legacyAnchor: false };
  const fromTab = tab != null ? LEGACY_TABS[tab] : undefined;
  if (has(fromTab)) return { id: fromTab, legacyAnchor: false };
  return { id: pages[0].id, legacyAnchor: false };
}

const includes = (texts: string[], q: string) =>
  texts.some(text => text.toLowerCase().includes(q));

/**
 * Whether a page matches a search, and which of its settings do. A page whose
 * own name doesn't match still shows when one of its settings does.
 */
export function matchSettingsPage(
  page: SettingsPage,
  query: string,
): { visible: boolean; pageMatch: boolean; items: SettingsItem[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { visible: true, pageMatch: true, items: [] };
  const items = (page.items ?? []).filter(item =>
    includes([item.label, ...(item.keywords ?? [])], q),
  );
  const pageMatch = includes(
    [page.label, page.description, page.group, ...page.keywords],
    q,
  );
  return { visible: pageMatch || items.length > 0, pageMatch, items };
}
