import { formatDistanceToNowStrict } from 'date-fns';
import { Badge } from '@clickhouse/click-ui';
import type {
  SloApiResponse,
  SloBurnStats,
} from '@hyperdx/common-utils/dist/slo';
import { Group, Stack, Table, Text, Tooltip } from '@mantine/core';

import { useSources } from '@/source';

import { SloStateBadge } from './SloStateBadge';
import {
  budgetColorVar,
  formatBudget,
  formatBurnRate,
  formatSli,
  formatTarget,
  getSloDisplayState,
} from './sloUtils';

function Header({ label, help }: { label: string; help: string }) {
  return (
    <Table.Th>
      <Tooltip label={help} withArrow multiline w={260} openDelay={300}>
        <span>{label}</span>
      </Tooltip>
    </Table.Th>
  );
}

function BudgetCell({ budgetRemaining }: { budgetRemaining?: number | null }) {
  const overspent = budgetRemaining != null && budgetRemaining <= 0;
  return (
    <Table.Td>
      <Tooltip
        label={`${formatBudget(budgetRemaining)} of the budget left`}
        disabled={!overspent}
        withArrow
      >
        <Text size="sm" style={{ color: budgetColorVar(budgetRemaining) }}>
          {overspent ? 'Overspent' : formatBudget(budgetRemaining)}
        </Text>
      </Tooltip>
    </Table.Td>
  );
}

function BurnRateCell({ burn }: { burn?: SloBurnStats[] }) {
  return (
    <Table.Td>
      <Text size="sm">
        {formatBurnRate(burn?.[0]?.burnRate)}
        <Text span size="xs" c="dimmed">
          {burn?.[0] ? ` / ${burn[0].window}` : ''}
        </Text>
      </Text>
    </Table.Td>
  );
}

function SloRow({
  slo,
  sourceName,
}: {
  slo: SloApiResponse;
  sourceName?: string;
}) {
  const { status } = slo;
  return (
    <Table.Tr data-testid="slo-row">
      <Table.Td>
        <Stack gap={2}>
          <Text size="sm" fw={500}>
            {slo.name}
          </Text>
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              {sourceName ?? 'Unknown source'}
            </Text>
            {slo.tags.map(tag => (
              <Badge key={tag} text={tag} state="neutral" size="sm" />
            ))}
          </Group>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Tooltip
          label={
            status?.error
              ? status.error.slice(0, 300)
              : status
                ? `Updated ${formatDistanceToNowStrict(new Date(status.evaluatedAt))} ago`
                : 'Waiting for the first update'
          }
          withArrow
          multiline
          w={320}
        >
          <span>
            <SloStateBadge state={getSloDisplayState(slo)} />
          </span>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{formatSli(status?.sli)}</Text>
      </Table.Td>
      <BudgetCell budgetRemaining={status?.budgetRemaining} />
      <BurnRateCell burn={status?.burn} />
      <Table.Td>
        <Text size="sm">
          {formatTarget(slo.target)}
          <Text span size="xs" c="dimmed">
            {` / ${slo.window}`}
          </Text>
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

export function SloTable({ slos }: { slos: SloApiResponse[] }) {
  const { data: sources } = useSources();

  return (
    <Table.ScrollContainer minWidth={900}>
      <Table highlightOnHover verticalSpacing="xs" data-testid="slo-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>State</Table.Th>
            <Header
              label="SLI"
              help="The share of eligible events that were good over the SLO window."
            />
            <Header
              label="Budget left"
              help="How much of the allowed bad events is left for the window."
            />
            <Header
              label="Burn rate"
              help="How fast the budget is being spent: 1x spends it exactly over the window."
            />
            <Table.Th>Target</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {slos.map(slo => (
            <SloRow
              key={slo.id}
              slo={slo}
              sourceName={sources?.find(s => s.id === slo.source)?.name}
            />
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
