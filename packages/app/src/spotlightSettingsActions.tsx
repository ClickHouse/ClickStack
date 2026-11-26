import * as React from 'react';
import { useRouter } from 'next/router';
import { SpotlightActionData } from '@mantine/spotlight';
import {
  IconDeviceDesktop,
  IconMoon,
  IconSettings,
  IconSun,
  IconUserCog,
} from '@tabler/icons-react';

import { SETTINGS_PAGES } from './components/TeamSettings/settingsPages';
import { IS_LOCAL_MODE } from './config';
import { useUserPreferencesModal } from './UserPreferencesModal';
import { UserPreferences, useUserPreferences } from './useUserPreferences';

const GROUP_SETTINGS = 'Settings';
const GROUP_PREFERENCES = 'Preferences';

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
          ...SETTINGS_PAGES.filter(page => !page.requiresAuthPolicy).flatMap(
            page => [
              {
                id: `settings-${page.id}`,
                group: GROUP_SETTINGS,
                leftSection: page.icon,
                label: page.label,
                description: page.description,
                keywords: [
                  'settings',
                  page.group.toLowerCase(),
                  ...page.keywords,
                ],
                onClick: () => {
                  router.push(`/team?tab=${page.id}`);
                },
              },
              ...(page.items ?? []).map(item => ({
                id: `settings-${page.id}-${item.anchor}`,
                group: GROUP_SETTINGS,
                leftSection: page.icon,
                label: item.label,
                description: page.label,
                keywords: ['settings', ...(item.keywords ?? [])],
                onClick: () => {
                  router.push(`/team?tab=${page.id}#${item.anchor}`);
                },
              })),
            ],
          ),
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
