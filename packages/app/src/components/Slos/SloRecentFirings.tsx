import { useMemo, useState } from 'react';
import { formatDistanceStrict } from 'date-fns';
import {
  AlertState,
  type AlertTransition,
} from '@hyperdx/common-utils/dist/types';
import { Skeleton, Stack, Table, Text } from '@mantine/core';

import api from '@/api';
import { FormatTime } from '@/useFormatTime';

const RECENT_FIRINGS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FIRINGS_SHOWN = 10;

export type AlertEpisode = { start: string; end?: string };

/**
 * The alert's firing episodes, newest first, from its state changes: each
 * firing to the next recovery, or still open. Times are evaluation times,
 * when the notifications went out.
 */
export function getAlertEpisodes(
  transitions: AlertTransition[],
): AlertEpisode[] {
  const episodes: AlertEpisode[] = [];
  let start: string | undefined;
  for (const { state, createdAt } of transitions) {
    if (state === AlertState.ALERT) {
      start ??= createdAt;
    } else if (start != null) {
      episodes.push({ start, end: createdAt });
      start = undefined;
    }
  }
  if (start != null) episodes.push({ start });
  return episodes.reverse();
}

/**
 * When one of the SLO's burn alerts fired in the last 7 days, newest
 * first.
 */
export function SloRecentFirings({
  alertId,
  grouped,
}: {
  alertId: string;
  /** A grouped SLO's alert fires when any of its groups does. */
  grouped: boolean;
}) {
  const [dateRange] = useState<[Date, Date]>(() => [
    new Date(Date.now() - RECENT_FIRINGS_MS),
    new Date(),
  ]);
  const { data, isLoading } = api.useAlertHistory(alertId, dateRange);
  const episodes = useMemo(() => getAlertEpisodes(data?.data ?? []), [data]);

  if (isLoading) return <Skeleton h={40} />;
  if (episodes.length === 0) {
    return (
      <Text size="sm" c="dimmed" data-testid="slo-recent-firings">
        Did not fire in the last 7 days.
      </Text>
    );
  }
  const hidden = episodes.length - MAX_FIRINGS_SHOWN;
  return (
    <Stack gap={4} data-testid="slo-recent-firings">
      <Text size="sm" fw={500}>
        Fired {episodes.length === 1 ? 'once' : `${episodes.length} times`} in
        the last 7 days
        {grouped && (
          <Text span size="sm" c="dimmed" fw={400}>
            {' '}
            (counting when any group was firing)
          </Text>
        )}
      </Text>
      <Table verticalSpacing={4} withRowBorders={false} maw={560}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Fired</Table.Th>
            <Table.Th>Resolved</Table.Th>
            <Table.Th>For</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {episodes.slice(0, MAX_FIRINGS_SHOWN).map(({ start, end }) => (
            <Table.Tr key={start}>
              <Table.Td>
                <FormatTime value={start} />
              </Table.Td>
              <Table.Td>
                {end ? (
                  <FormatTime value={end} />
                ) : (
                  <Text span size="sm" c="var(--color-text-danger)">
                    Still firing
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {/* An open episode runs until the history was read. */}
                {formatDistanceStrict(
                  new Date(start),
                  end ? new Date(end) : dateRange[1],
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {hidden > 0 && (
        <Text size="xs" c="dimmed">
          {hidden} earlier {hidden === 1 ? 'firing is' : 'firings are'} not
          shown.
        </Text>
      )}
    </Stack>
  );
}
