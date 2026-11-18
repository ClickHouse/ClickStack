import * as React from 'react';
import { useRouter } from 'next/router';
import { SpotlightActionData } from '@mantine/spotlight';
import {
  IconAdjustmentsHorizontal,
  IconApi,
  IconBrandTerraform,
  IconDatabase,
  IconDeviceDesktop,
  IconKey,
  IconMoon,
  IconRobot,
  IconSettings,
  IconSun,
  IconUserCog,
  IconUsers,
  IconWebhook,
} from '@tabler/icons-react';

import { IS_IAC_EXPORT_ENABLED, IS_LOCAL_MODE } from './config';
import { useUserPreferencesModal } from './UserPreferencesModal';
import { UserPreferences, useUserPreferences } from './useUserPreferences';

const GROUP_SETTINGS = 'Settings';
const GROUP_PREFERENCES = 'Preferences';

type TeamSettingsEntry = {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  // `?tab=` and the section anchor match the tab values and section ids in
  // TeamPage, which scrolls the anchored section into view.
  href: string;
  keywords: string[];
};

const TEAM_SETTINGS_ENTRIES: TeamSettingsEntry[] = [
  {
    id: 'settings-sources',
    label: 'Sources',
    description: 'Configure log, trace, metric, and session sources',
    icon: <IconDatabase size={16} />,
    href: '/team?tab=data#team-data-sources',
    keywords: ['settings', 'data', 'source', 'table', 'schema', 'logs'],
  },
  {
    id: 'settings-connections',
    label: 'Connections',
    description: 'Manage ClickHouse connections',
    icon: <IconDatabase size={16} />,
    href: '/team?tab=data#team-data-connections',
    keywords: ['settings', 'data', 'clickhouse', 'database', 'host'],
  },
  {
    id: 'settings-team-members',
    label: 'Team members',
    description: 'Invite and manage users on your team',
    icon: <IconUsers size={16} />,
    href: '/team?tab=team#team-members',
    keywords: ['settings', 'users', 'invite', 'people', 'members'],
  },
  {
    id: 'settings-api-keys',
    label: 'API keys',
    description: 'View your personal API key',
    icon: <IconKey size={16} />,
    href: '/team?tab=api-agents#team-api-agents-api-keys',
    keywords: ['settings', 'api', 'key', 'token', 'ingestion'],
  },
  ...(IS_LOCAL_MODE
    ? []
    : [
        {
          id: 'settings-org-api-keys',
          label: 'Organization API keys',
          description: 'Create and revoke organization API keys',
          icon: <IconApi size={16} />,
          href: '/team?tab=api-agents#team-api-agents-org-api-keys',
          keywords: ['settings', 'api', 'key', 'token', 'org'],
        },
      ]),
  {
    id: 'settings-mcp-server',
    label: 'MCP server',
    description: 'Connect your AI agents',
    icon: <IconRobot size={16} />,
    href: '/team?tab=api-agents#team-api-agents-mcp-server',
    keywords: ['settings', 'mcp', 'ai', 'agents', 'llm', 'claude', 'cursor'],
  },
  ...(IS_IAC_EXPORT_ENABLED
    ? [
        {
          id: 'settings-terraform-export',
          label: 'Export to Terraform',
          description: 'Export your configuration as Terraform',
          icon: <IconBrandTerraform size={16} />,
          href: '/team?tab=api-agents#team-api-agents-iac',
          keywords: ['settings', 'terraform', 'iac', 'export'],
        },
      ]
    : []),
  {
    id: 'settings-webhooks',
    label: 'Webhooks',
    description: 'Manage alert notification integrations',
    icon: <IconWebhook size={16} />,
    href: '/team?tab=integrations#team-integrations-webhooks',
    keywords: ['settings', 'integrations', 'slack', 'pagerduty', 'alerts'],
  },
  {
    id: 'settings-query-settings',
    label: 'Query settings',
    description: 'ClickHouse client settings for your team',
    icon: <IconAdjustmentsHorizontal size={16} />,
    href: '/team?tab=advanced#team-advanced-query-settings',
    keywords: ['settings', 'clickhouse', 'query', 'advanced', 'timeout'],
  },
];

const COLOR_MODE_ENTRIES: {
  colorMode: UserPreferences['colorMode'];
  label: string;
  icon: React.ReactNode;
}[] = [
  { colorMode: 'light', label: 'Use light mode', icon: <IconSun size={16} /> },
  { colorMode: 'dark', label: 'Use dark mode', icon: <IconMoon size={16} /> },
  {
    colorMode: 'system',
    label: 'Use system color mode',
    icon: <IconDeviceDesktop size={16} />,
  },
];

export const useSettingsSpotlightActions = (): SpotlightActionData[] => {
  const router = useRouter();
  const { open: openUserPreferences } = useUserPreferencesModal();
  const { setUserPreference } = useUserPreferences();

  return React.useMemo<SpotlightActionData[]>(() => {
    // The team page renders nothing in local mode, and AppNav hides its link.
    const teamActions: SpotlightActionData[] = IS_LOCAL_MODE
      ? []
      : [
          {
            id: 'team-settings',
            group: GROUP_SETTINGS,
            leftSection: <IconSettings size={16} />,
            label: 'Team settings',
            keywords: ['settings', 'team', 'configuration'],
            onClick: () => {
              router.push('/team');
            },
          },
          ...TEAM_SETTINGS_ENTRIES.map(entry => ({
            id: entry.id,
            group: GROUP_SETTINGS,
            leftSection: entry.icon,
            label: entry.label,
            description: entry.description,
            keywords: entry.keywords,
            onClick: () => {
              router.push(entry.href);
            },
          })),
        ];

    const colorModeActions: SpotlightActionData[] = COLOR_MODE_ENTRIES.map(
      entry => ({
        id: `preferences-color-mode-${entry.colorMode}`,
        group: GROUP_PREFERENCES,
        leftSection: entry.icon,
        label: entry.label,
        keywords: ['theme', 'color', 'appearance', 'light', 'dark', 'mode'],
        onClick: () => {
          setUserPreference({ colorMode: entry.colorMode });
        },
      }),
    );

    return [
      ...teamActions,
      {
        id: 'preferences',
        group: GROUP_PREFERENCES,
        leftSection: <IconUserCog size={16} />,
        label: 'Preferences',
        description: 'Time zone, time format, row click, font size, and theme',
        keywords: [
          'settings',
          'user',
          'time zone',
          'timezone',
          'utc',
          '12h',
          '24h',
          'font',
          'row click',
          'side panel',
          'appearance',
        ],
        onClick: openUserPreferences,
      },
      ...colorModeActions,
    ];
  }, [openUserPreferences, router, setUserPreference]);
};
