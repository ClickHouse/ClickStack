import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import { mapGranularityToExternalFormat } from '@hyperdx/common-utils/dist/externalSource';
import { Box, Button, Menu, Tooltip } from '@mantine/core';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';

function CheckSlot({ checked }: { checked: boolean }) {
  return checked ? <IconCheck size={14} /> : <Box w={14} />;
}

export function DashboardLiveButton({
  isLive,
  onToggleLive,
  refreshInterval,
  isAutoRefreshInterval,
  defaultRefreshInterval,
  refreshIntervalOptions,
  onRefreshIntervalChange,
}: {
  isLive: boolean;
  onToggleLive: () => void;
  refreshInterval: Granularity;
  isAutoRefreshInterval: boolean;
  defaultRefreshInterval: Granularity;
  refreshIntervalOptions: Granularity[];
  /** Undefined selects auto, which follows the date range's default. */
  onRefreshIntervalChange: (interval: Granularity | undefined) => void;
}) {
  const variant = isLive ? 'primary' : 'secondary';
  const intervalLabel = mapGranularityToExternalFormat(refreshInterval);
  const autoLabel = `Auto (${mapGranularityToExternalFormat(defaultRefreshInterval)})`;
  const triggerLabel = isAutoRefreshInterval ? autoLabel : intervalLabel;

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
            aria-label={`Refresh interval ${triggerLabel}`}
            data-testid="dashboard-refresh-interval-button"
            style={{
              borderInlineStart: '1px solid var(--color-border)',
            }}
          >
            {triggerLabel}
          </Button>
        </Menu.Target>
        <Menu.Dropdown data-testid="dashboard-refresh-interval-menu">
          <Menu.Label>Refresh every</Menu.Label>
          <Menu.Item
            onClick={() => onRefreshIntervalChange(undefined)}
            leftSection={<CheckSlot checked={isAutoRefreshInterval} />}
          >
            {autoLabel}
          </Menu.Item>
          <Menu.Divider />
          {refreshIntervalOptions.map(interval => (
            <Menu.Item
              key={interval}
              onClick={() => onRefreshIntervalChange(interval)}
              leftSection={
                <CheckSlot
                  checked={
                    !isAutoRefreshInterval && interval === refreshInterval
                  }
                />
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
