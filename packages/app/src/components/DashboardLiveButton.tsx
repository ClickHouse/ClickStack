import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import { mapGranularityToExternalFormat } from '@hyperdx/common-utils/dist/externalSource';
import { Box, Button, Menu, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';

export function DashboardLiveButton({
  isLive,
  onToggleLive,
  refreshInterval,
  defaultRefreshInterval,
  refreshIntervalOptions,
  onRefreshIntervalChange,
}: {
  isLive: boolean;
  onToggleLive: () => void;
  refreshInterval: Granularity;
  defaultRefreshInterval: Granularity;
  refreshIntervalOptions: Granularity[];
  onRefreshIntervalChange: (interval: Granularity) => void;
}) {
  const variant = isLive ? 'primary' : 'secondary';
  const intervalLabel = mapGranularityToExternalFormat(refreshInterval);

  return (
    <Button.Group>
      <Tooltip
        withArrow
        label={
          isLive
            ? `Auto-refreshing every ${intervalLabel}`
            : 'Enable auto-refresh'
        }
        fz="xs"
        color="gray"
      >
        <Button
          onClick={onToggleLive}
          size="sm"
          variant={variant}
          title={isLive ? 'Disable auto-refresh' : 'Enable auto-refresh'}
          data-testid="dashboard-live-button"
        >
          Live
        </Button>
      </Tooltip>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button
            size="sm"
            variant={variant}
            px="xs"
            rightSection={<IconChevronDown size={14} />}
            aria-label={`Refresh interval ${intervalLabel}`}
            data-testid="dashboard-refresh-interval-button"
            style={{
              borderInlineStart: '1px solid var(--color-border)',
            }}
          >
            {intervalLabel}
          </Button>
        </Menu.Target>
        <Menu.Dropdown data-testid="dashboard-refresh-interval-menu">
          <Menu.Label>Refresh every</Menu.Label>
          {refreshIntervalOptions.map(interval => (
            <Menu.Item
              key={interval}
              onClick={() => onRefreshIntervalChange(interval)}
              leftSection={
                interval === refreshInterval ? (
                  <IconCheck size={14} />
                ) : (
                  <Box w={14} />
                )
              }
              rightSection={
                interval === defaultRefreshInterval ? (
                  <Text size="xs" c="dimmed">
                    Default
                  </Text>
                ) : null
              }
            >
              {mapGranularityToExternalFormat(interval)}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </Button.Group>
  );
}
