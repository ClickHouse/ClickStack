import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import { Select } from '@mantine/core';

import { formatSloGroup, sloStateLabel } from './sloUtils';

const ALL_GROUPS = 'all';
// Option values carry a prefix: a group's value can be any string, empty too.
const GROUP_PREFIX = 'group:';

/**
 * Picks the group of a grouped SLO the page shows, or all groups together.
 * The tracked groups come worst first, with their state.
 */
export function SloGroupSelect({
  slo,
  group,
  onChange,
}: {
  slo: SloApiResponse;
  group?: string;
  onChange: (group: string | null) => void;
}) {
  const groups = slo.status?.groups ?? [];
  const states = new Map(groups.map(g => [g.value, g.state]));
  // A group from a link may be one the SLO does not track.
  const values = groups.map(g => g.value);
  if (group != null && !states.has(group)) values.unshift(group);
  const data = [
    { value: ALL_GROUPS, label: 'All groups' },
    ...values.map(value => {
      const state = states.get(value);
      return {
        value: `${GROUP_PREFIX}${value}`,
        label: `${formatSloGroup(value)}${state ? ` (${sloStateLabel(state)})` : ''}`,
      };
    }),
  ];
  return (
    <Select
      size="xs"
      w={260}
      searchable
      allowDeselect={false}
      aria-label={`Group by ${slo.groupBy}`}
      data={data}
      value={group != null ? `${GROUP_PREFIX}${group}` : ALL_GROUPS}
      onChange={value =>
        onChange(
          value?.startsWith(GROUP_PREFIX)
            ? value.slice(GROUP_PREFIX.length)
            : null,
        )
      }
      data-testid="slo-group-select"
    />
  );
}
