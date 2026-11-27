import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  getSloBurnRule,
  getSloGoodSql,
} from '@hyperdx/common-utils/dist/core/slo';
import { describeFilter } from '@hyperdx/common-utils/dist/filters';
import {
  describeSloAlertRule,
  getSloAlertRuleLabel,
  getSloAlertTarget,
  SLO_BURN_CONDITIONS,
  type SloApiResponse,
  type SloState,
  type SloStats,
} from '@hyperdx/common-utils/dist/slo';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Code,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';

import api from '@/api';

import { SloRecentFirings } from './SloRecentFirings';
import { SloAlertRuleBadge } from './SloStateBadge';
import {
  budgetColorVar,
  describeBurnWindow,
  formatBudget,
  formatBurnRate,
  formatCount,
  formatSli,
  formatSloWindow,
  formatTarget,
  getSloAlertStatus,
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

/**
 * The fast and slow burn alerts the SLO owns, each with its rule, channels
 * and recent firings. They are changed from the SLO's editor.
 */
export function SloAlertPanel({ slo }: { slo: SloApiResponse }) {
  const { data: webhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);
  const anyOn = SLO_BURN_CONDITIONS.some(({ rule }) =>
    getSloAlertTarget(slo.alerts, rule),
  );
  return (
    <Paper withBorder p="md" radius="sm" data-testid="slo-alert-panel">
      <Group justify="space-between" mb="xs">
        <Text fw={500}>Burn-rate alerts</Text>
        <Anchor component={Link} href={`/slos/${slo.id}/edit#alerts`} size="sm">
          {anyOn ? 'Edit' : 'Add an alert'}
        </Anchor>
      </Group>
      <Stack gap="md">
        {SLO_BURN_CONDITIONS.map(({ rule }) => {
          const target = getSloAlertTarget(slo.alerts, rule);
          const status = getSloAlertStatus(slo, rule);
          const sentence = describeSloAlertRule(rule, slo.window);
          const channels = (target?.channels ?? []).map(
            channel =>
              webhooks?.data?.find(w => w._id === channel.webhookId)?.name ??
              'a webhook',
          );
          return (
            <Stack key={rule} gap={4} data-testid={`slo-alert-panel-${rule}`}>
              <Group gap="xs">
                <Text size="sm" fw={500}>
                  {getSloAlertRuleLabel(rule)}
                </Text>
                <SloAlertRuleBadge slo={slo} rule={rule} />
              </Group>
              <Text size="sm" c={target ? undefined : 'dimmed'}>
                {target
                  ? `Notifies ${channels.join(', ')} when ${sentence}.`
                  : `Turn it on to be notified when ${sentence}.`}
              </Text>
              {target && status && <SloRecentFirings alertId={status.id} />}
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}

export function SloDefinitionPanel({
  slo,
  sourceName,
}: {
  slo: SloApiResponse;
  sourceName?: string;
}) {
  const { eligible, template, latency } = slo.indicator;
  const filters = eligible.filters ?? [];
  const status = slo.status;
  return (
    <Paper withBorder p="md" radius="sm" data-testid="slo-definition">
      <Text fw={500} mb="xs">
        Definition
      </Text>
      <Stack gap={6}>
        <Text size="sm">
          <Text span c="dimmed">
            Source:{' '}
          </Text>
          {sourceName ?? slo.source}
        </Text>
        <Text size="sm">
          <Text span c="dimmed">
            Eligible events:{' '}
          </Text>
          {eligible.where ? (
            <>
              <Code>{eligible.where}</Code> (
              {eligible.whereLanguage === 'sql' ? 'SQL' : 'Lucene'})
            </>
          ) : filters.length > 0 ? (
            'every event matching the filters below'
          ) : (
            'every event in the source'
          )}
        </Text>
        {filters.length > 0 && (
          <Group gap={6} data-testid="slo-definition-filters">
            <Text size="sm" c="dimmed">
              Filters:
            </Text>
            {filters.map(filter => (
              <Code key={describeFilter(filter)}>{describeFilter(filter)}</Code>
            ))}
          </Group>
        )}
        <Text size="sm">
          <Text span c="dimmed">
            Good events:{' '}
          </Text>
          {template === 'latency' && latency ? (
            <>
              <Code>{latency.expression}</Code> (stored in {latency.unit})
              within {latency.thresholdMs} ms
              {!latency.numeric &&
                (latency.requireDuration
                  ? '; events without a duration are left out'
                  : '; events without a duration count as bad')}
              . Counted as <Code>{getSloGoodSql(slo.indicator)}</Code>
            </>
          ) : (
            <Code>{slo.indicator.good}</Code>
          )}
        </Text>
        <Text size="sm">
          <Text span c="dimmed">
            Objective:{' '}
          </Text>
          {formatTarget(slo.target)} of eligible events are good over a rolling{' '}
          {formatSloWindow(slo.window)}
        </Text>
        {status && (
          <Text size="xs" c="dimmed">
            The SLO list uses a copy updated in the background: burn rate{' '}
            {formatDistanceToNowStrict(new Date(status.evaluatedAt))} ago
            {status.windowEvaluatedAt
              ? `, SLI and budget ${formatDistanceToNowStrict(new Date(status.windowEvaluatedAt))} ago (${status.durationMs} ms, ${formatCount(status.rowsRead)} rows read)`
              : ''}
            {status.state === 'error' && status.lastSuccessAt
              ? `. Last successful update ${formatDistanceToNowStrict(new Date(status.lastSuccessAt))} ago`
              : ''}
            .
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
