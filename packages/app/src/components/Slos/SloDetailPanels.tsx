import { getSloBurnRule } from '@hyperdx/common-utils/dist/core/slo';
import type {
  SloApiResponse,
  SloState,
  SloStats,
} from '@hyperdx/common-utils/dist/slo';
import { Paper, SimpleGrid, Text } from '@mantine/core';

import {
  budgetColorVar,
  describeBurnWindow,
  formatBudget,
  formatBurnRate,
  formatCount,
  formatSli,
  formatSloWindow,
  formatTarget,
} from './sloUtils';

function Stat({
  label,
  value,
  detail,
  color,
  testId,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
  color?: string;
  testId?: string;
}) {
  return (
    <Paper withBorder p="md" radius="sm" data-testid={testId}>
      <Text size="xs" c="dimmed" mb={4}>
        {label}
      </Text>
      <Text size="xl" fw={600} style={color ? { color } : undefined}>
        {value}
      </Text>
      {detail != null && (
        <Text size="xs" c="dimmed" mt={4}>
          {detail}
        </Text>
      )}
    </Paper>
  );
}

export function SloStatsGrid({
  slo,
  stats,
  state,
}: {
  slo: SloApiResponse;
  stats: SloStats;
  state: SloState;
}) {
  // The rule's conditions with their numbers, the 1h one first.
  const [hour, sixHours] = getSloBurnRule(slo.window).map((condition, i) => ({
    ...condition,
    ...stats.burn[i],
  }));
  const window = formatSloWindow(slo.window);
  return (
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
      <Stat
        testId="slo-stat-sli"
        label={`SLI, last ${window}`}
        value={formatSli(stats.sli)}
        color={
          stats.sli == null
            ? undefined
            : stats.sli * 100 >= slo.target
              ? 'var(--color-text-success)'
              : 'var(--color-text-danger)'
        }
        detail={`Target ${formatTarget(slo.target)}`}
      />
      <Stat
        testId="slo-stat-budget"
        label="Error budget left"
        value={formatBudget(stats.budgetRemaining)}
        color={budgetColorVar(stats.budgetRemaining)}
        detail={
          stats.budgetRemainingEvents >= 0
            ? `${formatCount(Math.round(stats.budgetRemainingEvents))} of ${formatCount(Math.round(stats.errorBudget))} allowed bad events left`
            : `Overspent by ${formatCount(Math.round(-stats.budgetRemainingEvents))} bad events`
        }
      />
      <Stat
        testId="slo-stat-burn"
        label={`Burn rate over ${describeBurnWindow(hour.window)}`}
        value={formatBurnRate(hour.burnRate)}
        color={state === 'burning' ? 'var(--color-text-danger)' : undefined}
        detail={`Fast burn at ${hour.threshold}x. Over ${describeBurnWindow(sixHours.window)}: ${formatBurnRate(sixHours.burnRate)} (slow burn at ${sixHours.threshold}x)`}
      />
      <Stat
        testId="slo-stat-events"
        label={`Events, last ${window}`}
        value={formatCount(stats.eligible)}
        detail={`${formatCount(stats.good)} good, ${formatCount(stats.bad)} bad`}
      />
    </SimpleGrid>
  );
}
