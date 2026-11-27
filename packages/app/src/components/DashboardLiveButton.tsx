import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import { mapGranularityToExternalFormat } from '@hyperdx/common-utils/dist/externalSource';
import { Box, Button, Menu, Tooltip } from '@mantine/core';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';

function IntervalItem({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      data-checked={checked}
      onClick={onClick}
      leftSection={checked ? <IconCheck size={14} /> : <Box w={14} />}
    >
      {label}
    </Menu.Item>
  );
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
          <IntervalItem
            label={autoLabel}
            checked={isAutoRefreshInterval}
            onClick={() => onRefreshIntervalChange(undefined)}
          />
          {refreshIntervalOptions.length > 0 && <Menu.Divider />}
          {refreshIntervalOptions.map(interval => (
            <IntervalItem
              key={interval}
              label={mapGranularityToExternalFormat(interval)}
              checked={!isAutoRefreshInterval && interval === refreshInterval}
              onClick={() => onRefreshIntervalChange(interval)}
            />
          ))}
        </Menu.Dropdown>
      </Menu>
    </Button.Group>
  );
}
