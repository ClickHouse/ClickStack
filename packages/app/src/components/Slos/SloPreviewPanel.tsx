import {
  parseSloCountsRow,
  parseSloGroupCountRow,
  parseSloTotalRow,
} from '@hyperdx/common-utils/dist/core/slo';
import { computeSloStats } from '@hyperdx/common-utils/dist/core/sloStats';
import { SLO_MAX_GROUPS } from '@hyperdx/common-utils/dist/slo';
import {
  Accordion,
  Alert,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

import ChartSQLPreview from '@/components/ChartSQLPreview';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import type { SloPreviewRequest } from './sloForm';
import {
  budgetColorVar,
  formatBudget,
  formatCount,
  formatSli,
} from './sloUtils';

const PREVIEW_QUERY_OPTIONS = {
  queryKeyPrefix: 'slo-preview',
  refetchOnWindowFocus: false,
  retry: false,
};

function PreviewStat({
  label,
  value,
  color,
  testId,
}: {
  label: string;
  value: string;
  color?: string;
  testId?: string;
}) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text
        fw={600}
        size="lg"
        style={color ? { color } : undefined}
        data-testid={testId}
      >
        {value}
      </Text>
    </div>
  );
}

/** The preview's queries run from the browser, like any chart. */
function SloPreviewResults({
  request,
  target,
}: {
  request: SloPreviewRequest;
  target: number;
}) {
  const counts = useQueriedChartConfig(request.counts, PREVIEW_QUERY_OPTIONS);
  const total = useQueriedChartConfig(request.total, PREVIEW_QUERY_OPTIONS);
  // Runs only with a group-by; the config stands in otherwise.
  const groups = useQueriedChartConfig(request.groups ?? request.total, {
    ...PREVIEW_QUERY_OPTIONS,
    enabled: request.groups != null,
  });
  const error = counts.error ?? (request.groups ? groups.error : null);

  if (error) {
    return (
      <Alert variant="danger" title="The preview query failed">
        {error.message}
      </Alert>
    );
  }
  if (!counts.data) return <Skeleton h={120} />;

  // The preview covers the window; burn rates show once the SLO is saved.
  const stats = computeSloStats(
    parseSloCountsRow(counts.data.data),
    [],
    target,
  );
  const excluded = total.data
    ? Math.max(0, parseSloTotalRow(total.data.data) - stats.eligible)
    : undefined;
  const groupCount =
    request.groups && groups.data
      ? parseSloGroupCountRow(groups.data.data)
      : undefined;
  return (
    <Stack gap="sm">
      <SimpleGrid cols={3} spacing="xs">
        <PreviewStat
          label="Good"
          value={formatCount(stats.good)}
          testId="slo-preview-good"
        />
        <PreviewStat
          label="Bad"
          value={formatCount(stats.bad)}
          color="var(--color-text-danger)"
          testId="slo-preview-bad"
        />
        <PreviewStat
          label="Excluded"
          value={formatCount(excluded)}
          testId="slo-preview-excluded"
        />
        <PreviewStat
          label="SLI"
          value={formatSli(stats.sli)}
          testId="slo-preview-sli"
        />
        <PreviewStat
          label="Budget left"
          value={formatBudget(stats.budgetRemaining)}
          color={budgetColorVar(stats.budgetRemaining)}
        />
        {request.groups && (
          <PreviewStat
            label="Groups"
            value={
              groupCount != null && groupCount > SLO_MAX_GROUPS
                ? `${SLO_MAX_GROUPS} of ${formatCount(groupCount)}`
                : formatCount(groupCount)
            }
            testId="slo-preview-groups"
          />
        )}
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        Excluded events are in the source but outside the eligible events.
        {request.groups &&
          ` The numbers are for all groups together; each group gets its own once the SLO is saved.`}
      </Text>
      <Accordion variant="contained" chevronPosition="left">
        <Accordion.Item value="sql">
          <Accordion.Control>
            <Text size="xs">Generated SQL</Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs" data-testid="slo-preview-sql">
              <ChartSQLPreview config={request.counts} enableCopy />
              <Text size="xs" c="dimmed">
                All rows, for the excluded count
              </Text>
              <ChartSQLPreview config={request.total} enableCopy />
              {request.groups && (
                <>
                  <Text size="xs" c="dimmed">
                    Distinct groups
                  </Text>
                  <ChartSQLPreview config={request.groups} enableCopy />
                </>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

/** Dry-run counts for the definition being edited, before it is saved. */
export function SloPreviewPanel({
  request,
  isStale,
  target,
  onRun,
}: {
  request: SloPreviewRequest | null;
  /** The definition changed since the preview ran. */
  isStale: boolean;
  target: number;
  onRun: () => void;
}) {
  return (
    <Paper withBorder p="md" radius="sm" data-testid="slo-preview">
      <Group justify="space-between" mb="sm">
        <Text fw={500}>Preview</Text>
        <Button
          variant="secondary"
          size="xs"
          leftSection={<IconPlayerPlay size={14} />}
          onClick={onRun}
          data-testid="slo-preview-run"
        >
          {request ? 'Run again' : 'Run preview'}
        </Button>
      </Group>
      {request == null ? (
        <Text size="sm" c="dimmed">
          See good, bad and excluded events over the SLO window before you save.
        </Text>
      ) : (
        <Stack gap="sm">
          {isStale && (
            <Text size="xs" c="var(--color-text-warning)">
              The definition changed since this preview. Run it again to update
              the counts.
            </Text>
          )}
          <div style={{ opacity: isStale ? 0.6 : 1 }}>
            <SloPreviewResults request={request} target={target} />
          </div>
        </Stack>
      )}
    </Paper>
  );
}
