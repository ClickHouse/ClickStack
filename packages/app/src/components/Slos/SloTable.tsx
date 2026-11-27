import { useState } from 'react';
import { useRouter } from 'next/router';
import { formatDistanceToNowStrict } from 'date-fns';
import { Badge } from '@clickhouse/click-ui';
import type {
  SloApiResponse,
  SloBurnStats,
} from '@hyperdx/common-utils/dist/slo';
import { ActionIcon, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';

import { useSources } from '@/source';

import { SloRowMenu } from './SloRowMenu';
import { SloAlertBadge, SloStateBadge } from './SloStateBadge';
import {
  budgetColorVar,
  formatBudget,
  formatBurnRate,
  formatSli,
  formatSloGroup,
  formatTarget,
  getSloDisplayState,
} from './sloUtils';

const COLUMNS = 8;
/** Group names sit one step in from the SLO name, after its chevron. */
const GROUP_INDENT = 42;
/** Group rows sit under the SLO's row, like an alert's groups. */
const CHILD_ROW_STYLE = { backgroundColor: 'var(--color-bg-muted)' };

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

/** A grouped SLO's tracked groups, worst first, under its row. */
function SloGroupRows({ slo }: { slo: SloApiResponse }) {
  const router = useRouter();
  const groups = slo.status?.groups ?? [];
  const untracked = (slo.status?.groupCount ?? groups.length) - groups.length;
  return (
    <>
      {groups.map(group => (
        <Table.Tr
          key={group.value}
          data-testid="slo-group-row"
          style={{ ...CHILD_ROW_STYLE, cursor: 'pointer' }}
          onClick={() =>
            router.push(
              `/slos/${slo.id}?${new URLSearchParams({ group: group.value })}`,
            )
          }
        >
          <Table.Td>
            <Text size="sm" pl={GROUP_INDENT} truncate maw={360}>
              {formatSloGroup(group.value)}
            </Text>
          </Table.Td>
          <Table.Td>
            <SloStateBadge state={group.state} />
          </Table.Td>
          <Table.Td>
            <Text size="sm">{formatSli(group.sli)}</Text>
          </Table.Td>
          <BudgetCell budgetRemaining={group.budgetRemaining} />
          <BurnRateCell burn={group.burn} />
          <Table.Td colSpan={3} />
        </Table.Tr>
      ))}
      {(groups.length === 0 || untracked > 0) && (
        <Table.Tr style={CHILD_ROW_STYLE}>
          <Table.Td colSpan={COLUMNS}>
            <Text
              size="sm"
              c="dimmed"
              pl={GROUP_INDENT}
              data-testid="slo-groups-note"
            >
              {groups.length === 0
                ? 'The groups show after the first update.'
                : `${untracked} more ${untracked === 1 ? 'group has' : 'groups have'} fewer events and ${untracked === 1 ? 'is' : 'are'} not tracked.`}
            </Text>
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

function SloRow({
  slo,
  sourceName,
}: {
  slo: SloApiResponse;
  sourceName?: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const { status } = slo;
  const grouped = slo.groupBy != null;
  const groupCount = status?.groupCount;
  return (
    <>
      <Table.Tr
        data-testid="slo-row"
        style={{ cursor: 'pointer' }}
        onClick={() => router.push(`/slos/${slo.id}`)}
      >
        <Table.Td>
          <Group gap={4} wrap="nowrap" align="flex-start">
            {grouped ? (
              <ActionIcon
                variant="subtle"
                size="sm"
                aria-label={expanded ? 'Hide groups' : 'Show groups'}
                aria-expanded={expanded}
                onClick={e => {
                  e.stopPropagation();
                  setExpanded(v => !v);
                }}
                data-testid="slo-row-expand"
              >
                {expanded ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )}
              </ActionIcon>
            ) : (
              // Keeps the names of grouped and ungrouped SLOs aligned.
              <span style={{ width: 22, flexShrink: 0 }} />
            )}
            <Stack gap={2}>
              <Text size="sm" fw={500}>
                {slo.name}
              </Text>
              <Group gap={6}>
                <Text size="xs" c="dimmed">
                  {sourceName ?? 'Unknown source'}
                  {grouped &&
                    ` · by ${slo.groupBy}` +
                      (groupCount != null
                        ? `, ${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`
                        : '')}
                </Text>
                {slo.tags.map(tag => (
                  <Badge key={tag} text={tag} state="neutral" size="sm" />
                ))}
              </Group>
            </Stack>
          </Group>
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
        <Table.Td>
          <SloAlertBadge slo={slo} />
        </Table.Td>
        <Table.Td>
          <SloRowMenu slo={slo} />
        </Table.Td>
      </Table.Tr>
      {expanded && <SloGroupRows slo={slo} />}
    </>
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
            <Table.Th>Alert</Table.Th>
            <Table.Th w={48} />
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
