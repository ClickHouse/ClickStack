import { useMemo } from 'react';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  buildSloBadEventsSearch,
  getSloBurnRule,
} from '@hyperdx/common-utils/dist/core/slo';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import { DisplayType, type TSource } from '@hyperdx/common-utils/dist/types';
import { Drawer, Group, SegmentedControl, Stack, Text } from '@mantine/core';

import DBSqlRowTableWithSideBar from '@/components/DBSqlRowTableWithSidebar';
import { DrawerHeader } from '@/components/DrawerUtils';
import { useFormatTime } from '@/useFormatTime';
import { useZIndex, ZIndexContext } from '@/zIndex';

import {
  formatBurnWindow,
  formatCount,
  formatSloGroup,
  formatSloWindow,
  getSourceDefaultSelect,
} from './sloUtils';

export type SloEventsRange = 'burn' | 'window' | 'custom';

export type SloEventsRequest = {
  range: SloEventsRange;
  dateRange: [Date, Date];
};

/**
 * Flyout with an SLO's bad events, so they can be examined without leaving
 * the SLO. The table is Search's own results table, fed by the same filters
 * the SLO counts with. The time range comes from the caller, who resolves it
 * when the flyout opens.
 */
export function SloEventsDrawer({
  slo,
  source,
  group,
  request,
  onRangeChange,
  onClose,
}: {
  slo: SloApiResponse;
  source?: TSource;
  /** One group of a grouped SLO. */
  group?: string;
  request: SloEventsRequest | null;
  onRangeChange: (range: 'burn' | 'window') => void;
  onClose: () => void;
}) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;
  const formatTime = useFormatTime();
  // The burn rule's first window, the last hour.
  const burn = getSloBurnRule(slo.window)[0];
  const isLatency = slo.indicator.template === 'latency';
  const dateRange = request?.dateRange;

  const config = useMemo(() => {
    if (!source || !dateRange) return undefined;
    const defaultSelect = getSourceDefaultSelect(source);
    const search = buildSloBadEventsSearch(slo, defaultSelect, group);
    const sourceOrderBy =
      'orderByExpression' in source ? source.orderByExpression?.trim() : '';
    return {
      ...buildSearchChartConfig(source, {
        where: search.where,
        whereLanguage: search.whereLanguage,
        filters: search.filters,
        select: search.select ?? defaultSelect,
        orderBy:
          search.orderBy ??
          (sourceOrderBy ||
            `${getFirstTimestampValueExpression(source.timestampValueExpression)} DESC`),
        displayType: DisplayType.Search,
        dateRange,
      }),
      dateRange,
    };
  }, [source, dateRange, slo, group]);

  // The SLO's own count for the burn window, so a small difference from late
  // data is not a surprise.
  const status = slo.status;
  const storedBurn = (
    group != null ? status?.groups?.find(g => g.value === group) : status
  )?.burn[0];
  const sloBadCount =
    request?.range === 'burn' && storedBurn?.window === burn.window
      ? storedBurn.bad
      : undefined;

  return (
    <Drawer
      opened={request != null}
      onClose={onClose}
      position="right"
      size="80vw"
      withCloseButton={false}
      zIndex={drawerZIndex}
      styles={{ body: { padding: 0, height: '100vh' } }}
      data-testid="slo-events-drawer"
    >
      <ZIndexContext value={drawerZIndex}>
        <Stack gap={0} h="100vh">
          <DrawerHeader
            header={`Bad events: ${slo.name}${group != null ? ` (${formatSloGroup(group)})` : ''}`}
            onClose={onClose}
          />
          <Group px="md" py="xs" gap="sm" wrap="wrap">
            <SegmentedControl
              size="xs"
              value={request?.range ?? 'burn'}
              onChange={value =>
                onRangeChange(value === 'window' ? 'window' : 'burn')
              }
              data={[
                {
                  value: 'burn',
                  label: `Last ${formatBurnWindow(burn.window)}`,
                },
                {
                  value: 'window',
                  label: `Last ${formatSloWindow(slo.window)}`,
                },
                ...(request?.range === 'custom'
                  ? [{ value: 'custom', label: 'Selected range' }]
                  : []),
              ]}
              data-testid="slo-events-range"
            />
            {dateRange && (
              <Text size="xs" c="dimmed">
                {formatTime(dateRange[0], { format: 'short' })} to{' '}
                {formatTime(dateRange[1], { format: 'short' })}.
                {isLatency ? ' Slowest first.' : ''}
                {sloBadCount != null
                  ? ` The SLO counted ${formatCount(sloBadCount)} bad events at its last update.`
                  : ''}
              </Text>
            )}
          </Group>
          <div style={{ flex: 1, minHeight: 0 }}>
            {config && source && (
              <DBSqlRowTableWithSideBar
                sourceId={source.id}
                config={config}
                isLive={false}
                queryKeyPrefix="slo-bad-events"
              />
            )}
          </div>
        </Stack>
      </ZIndexContext>
    </Drawer>
  );
}
