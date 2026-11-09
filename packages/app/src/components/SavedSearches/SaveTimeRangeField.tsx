import { useMemo } from 'react';
import { RelativeDateRange } from '@hyperdx/common-utils/dist/types';
import { Group, Text, Tooltip } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

import {
  CurrentTimeRange,
  formatRelativeDuration,
  getSaveTimeRangeOutcome,
  isLiveTailDuration,
} from './savedSearchTimeRange';

const TOOLTIP =
  'A saved search opens with the time range selected when you save it. To change it, pick a different range in the time picker and save again. Ranges that end in the past are not saved.';

function describeOpensWith(range: RelativeDateRange | null): string {
  if (range == null) return 'Opens in live tail';
  const duration = formatRelativeDuration(range.value);
  return isLiveTailDuration(range.value * 1000)
    ? `Opens in live tail for the past ${duration}`
    : `Opens with the past ${duration}`;
}

export function useSaveTimeRangeField({
  openedAtMs,
  isLive,
  liveIntervalMs,
  searchedTimeRange,
  stored,
  isUpdate,
}: {
  /** When the modal was opened, or null while it is closed. */
  openedAtMs: number | null;
  isLive: boolean;
  liveIntervalMs: number;
  searchedTimeRange: [Date, Date];
  stored: RelativeDateRange | null | undefined;
  isUpdate: boolean;
}) {
  // Live updates pause while the save modal is open, so the window is stable.
  return useMemo(() => {
    const current: CurrentTimeRange = isLive
      ? { kind: 'live', intervalMs: liveIntervalMs }
      : { kind: 'window', range: searchedTimeRange };
    return getSaveTimeRangeOutcome({
      current,
      stored,
      isUpdate,
      nowMs: openedAtMs ?? 0,
    });
  }, [openedAtMs, isLive, liveIntervalMs, searchedTimeRange, stored, isUpdate]);
}

export function SaveTimeRangeField({
  opensWith,
}: {
  opensWith: RelativeDateRange | null;
}) {
  return (
    <Group gap={6} data-testid="save-search-time-range">
      <Text size="xs">{describeOpensWith(opensWith)}</Text>
      <Tooltip label={TOOLTIP} multiline w={280} withArrow>
        <IconInfoCircle size={14} aria-label="How the time range is saved" />
      </Tooltip>
    </Group>
  );
}
