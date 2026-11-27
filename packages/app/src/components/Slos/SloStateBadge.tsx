import { Badge } from '@clickhouse/click-ui';
import {
  getSloAlertRuleLabel,
  getSloAlertTarget,
  SLO_BURN_CONDITIONS,
  type SloAlertRule,
  type SloApiResponse,
} from '@hyperdx/common-utils/dist/slo';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import { Group, Text, Tooltip } from '@mantine/core';

import { useFormatTime } from '@/useFormatTime';

import {
  getSloAlertStatus,
  sloAlertStateLabel,
  type SloDisplayState,
  sloStateDescription,
  sloStateLabel,
} from './sloUtils';

export function SloStateBadge({ state }: { state: SloDisplayState }) {
  const label = sloStateLabel(state);
  const badge = (() => {
    switch (state) {
      case 'breached':
        return <Badge text={label} state="danger" type="solid" />;
      case 'burning':
        return <Badge text={label} state="warning" type="solid" />;
      case 'error':
        return <Badge text={label} state="danger" />;
      case 'healthy':
        return <Badge text={label} state="success" />;
      case 'no_data':
      case 'pending':
        return <Badge text={label} state="neutral" />;
    }
  })();
  return (
    <Tooltip label={sloStateDescription(state)} openDelay={400} withArrow>
      <span data-testid={`slo-state-${state}`}>{badge}</span>
    </Tooltip>
  );
}

function AlertStateBadge({ state }: { state: AlertState }) {
  const label = sloAlertStateLabel(state);
  return state === AlertState.ALERT ? (
    <Badge text={label} state="danger" type="solid" />
  ) : (
    <Badge
      text={label}
      state={state === AlertState.OK ? 'success' : 'neutral'}
    />
  );
}

function SilencedBadge({ until }: { until: string }) {
  const formatTime = useFormatTime();
  return (
    <Tooltip
      label={`Notifications are silenced until ${formatTime(until)}`}
      withArrow
    >
      <span>
        <Badge text="Silenced" state="neutral" />
      </span>
    </Tooltip>
  );
}

/** One burn alert's state: off, missing, or as it runs. */
export function SloAlertRuleBadge({
  slo,
  rule,
}: {
  slo: SloApiResponse;
  rule: SloAlertRule;
}) {
  if (!getSloAlertTarget(slo.alerts, rule)) {
    return (
      <Text size="xs" c="dimmed">
        Off
      </Text>
    );
  }
  const status = getSloAlertStatus(slo, rule);
  if (!status) {
    return (
      <Tooltip
        label="The alert is missing. Save the SLO to set it up again."
        withArrow
      >
        <span>
          <Badge text="Not running" state="neutral" />
        </span>
      </Tooltip>
    );
  }
  return (
    <Group gap={4} wrap="nowrap" data-testid={`slo-alert-state-${rule}`}>
      <AlertStateBadge state={status.state} />
      {status.silencedUntil && <SilencedBadge until={status.silencedUntil} />}
    </Group>
  );
}

/**
 * The SLO's burn alerts at a glance: the worst state among those that are
 * on, each one in the tooltip, or "Off" when none is.
 */
export function SloAlertBadge({ slo }: { slo: SloApiResponse }) {
  const alerts = SLO_BURN_CONDITIONS.filter(
    ({ rule }) => getSloAlertTarget(slo.alerts, rule) != null,
  ).map(({ rule }) => ({
    label: getSloAlertRuleLabel(rule),
    status: getSloAlertStatus(slo, rule),
  }));
  if (alerts.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        Off
      </Text>
    );
  }
  // Settings without an alert behind them: the alert was removed and the SLO
  // was not updated. Saving the SLO creates it again.
  const missing = alerts.find(a => a.status == null);
  if (missing) {
    return (
      <Tooltip
        label={`The ${missing.label.toLowerCase()} alert is missing. Save the SLO to set it up again.`}
        withArrow
      >
        <span data-testid="slo-alert-state">
          <Badge text="Not running" state="neutral" />
        </span>
      </Tooltip>
    );
  }
  const states = alerts.map(a => ({
    label: a.label,
    state: a.status?.state ?? AlertState.OK,
  }));
  const state =
    states.find(s => s.state === AlertState.ALERT)?.state ?? states[0].state;
  const silencedUntil = alerts.find(a => a.status?.silencedUntil)?.status
    ?.silencedUntil;
  return (
    <Group gap={4} wrap="nowrap" data-testid="slo-alert-state">
      <Tooltip
        label={states
          .map(s => `${s.label}: ${sloAlertStateLabel(s.state)}`)
          .join('. ')}
        withArrow
      >
        <span>
          <AlertStateBadge state={state} />
        </span>
      </Tooltip>
      {silencedUntil && <SilencedBadge until={silencedUntil} />}
    </Group>
  );
}
