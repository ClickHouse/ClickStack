import { useCallback } from 'react';
import SqlString from 'sqlstring';
import { Separator } from '@clickhouse/click-ui';
import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Button, Group, Stack, Text } from '@mantine/core';
import {
  IconActivity,
  IconClock,
  IconSearch,
  IconTarget,
  IconTargetOff,
} from '@tabler/icons-react';

import { formatDurationMs } from '@/utils';

import {
  buildServiceMapDimensionsWhere,
  formatServiceMapDimensions,
} from './dimensions';
import {
  buildServiceMapErrorWhere,
  ERROR_RATE_HIGH,
  formatApproximateNumber,
  formatRate,
  navigateToTraceSearch,
} from './utils';

import styles from './ServiceMap.module.scss';

export default function ServiceMapTooltip({
  totalRequests,
  errorPercentage,
  latencyMs,
  requestsPerSecond,
  source,
  dateRange,
  serviceName,
  dimensions,
  groupBy,
  isSingleTrace,
  isFocused,
  onFocus,
}: {
  totalRequests: number;
  errorPercentage: number;
  // p50/p95/p99 already converted to milliseconds; omitted when unavailable.
  latencyMs?: { p50: number; p95: number; p99: number };
  // Throughput; omitted for single-trace maps where a rate is meaningless.
  requestsPerSecond?: number;
  source: TTraceSource;
  dateRange: [Date, Date];
  serviceName: string;
  // Values of the extra group-by expressions for this node, in groupBy order.
  dimensions: string[];
  // The extra group-by SQL expressions, so search links can pin each value.
  groupBy: string[];
  isSingleTrace?: boolean;
  // Whether the map is currently scoped to this service (the focus toggle is on)
  // — flips the focus CTA to a "clear" action.
  isFocused?: boolean;
  // When provided, renders an action that scopes the map to this service and its
  // immediate dependencies (or clears that scope when already focused).
  onFocus?: () => void;
}) {
  const requestText = `${isSingleTrace ? totalRequests : formatApproximateNumber(totalRequests)} incoming request${
    totalRequests !== 1 ? 's' : ''
  }`;
  const errorsText = `${errorPercentage.toFixed(2)}% errors`;
  // Only alarm (red) once errors are non-trivial; a fraction of a percent reads
  // as amber and a clean service stays neutral-danger-free.
  const errorColor =
    errorPercentage >= ERROR_RATE_HIGH
      ? 'var(--color-text-danger)'
      : 'var(--color-chart-warning)';

  const dimensionsLabel = formatServiceMapDimensions(dimensions);
  const dimensionsWhere = buildServiceMapDimensionsWhere(groupBy, dimensions);

  const handleRequestsClick = useCallback(() => {
    navigateToTraceSearch({
      dateRange,
      source,
      where:
        SqlString.format("? = ? AND ? IN ('Server', 'Consumer')", [
          SqlString.raw(source.serviceNameExpression ?? 'ServiceName'),
          serviceName,
          SqlString.raw(source.spanKindExpression ?? 'SpanKind'),
        ]) + dimensionsWhere,
    });
  }, [dateRange, source, serviceName, dimensionsWhere]);

  const handleErrorsClick = useCallback(() => {
    navigateToTraceSearch({
      dateRange,
      source,
      where:
        buildServiceMapErrorWhere({
          serviceNameExpression: source.serviceNameExpression ?? 'ServiceName',
          serviceName,
          spanKindExpression: source.spanKindExpression ?? 'SpanKind',
          statusCodeExpression: source.statusCodeExpression ?? 'StatusCode',
        }) + dimensionsWhere,
    });
  }, [dateRange, source, serviceName, dimensionsWhere]);

  const showMetrics =
    totalRequests > 0 && (requestsPerSecond != null || latencyMs != null);

  return (
    <Stack className={styles.toolbar} gap={4} align="stretch" miw={220}>
      <Text
        fw={600}
        size="sm"
        c="var(--color-text)"
        px="xs"
        pt={4}
        lineClamp={1}
        title={serviceName}
      >
        {serviceName}
      </Text>
      {dimensionsLabel ? (
        <Text
          size="xs"
          c="var(--color-text-muted)"
          px="xs"
          lineClamp={1}
          title={dimensionsLabel}
          data-testid="service-map-tooltip-dimensions"
        >
          {dimensionsLabel}
        </Text>
      ) : null}
      <Separator size="xs" />
      <Button
        onClick={handleRequestsClick}
        variant="subtle"
        size="xs"
        color="var(--color-text)"
        justify="space-between"
        fullWidth
        rightSection={<IconSearch size={14} />}
      >
        {requestText}
      </Button>
      {errorPercentage > 0 ? (
        <Button
          onClick={handleErrorsClick}
          variant="subtle"
          size="xs"
          color={errorColor}
          justify="space-between"
          fullWidth
          rightSection={<IconSearch size={14} />}
        >
          {errorsText}
        </Button>
      ) : null}
      {showMetrics ? (
        <Stack gap={4} px="xs" py={2} c="var(--color-text)">
          {requestsPerSecond != null ? (
            <Group gap={6} wrap="nowrap">
              <IconActivity size={14} />
              <Text size="xs">{formatRate(requestsPerSecond)}</Text>
            </Group>
          ) : null}
          {latencyMs != null ? (
            <Group gap={6} wrap="nowrap">
              <IconClock size={14} />
              {/* Percentiles are estimated (approximate quantiles, over sampled
                  spans), so prefix each value with ~. */}
              <Text size="xs">
                p50 ~{formatDurationMs(latencyMs.p50)} · p95 ~
                {formatDurationMs(latencyMs.p95)} · p99 ~
                {formatDurationMs(latencyMs.p99)}
              </Text>
            </Group>
          ) : null}
        </Stack>
      ) : null}
      {onFocus ? (
        <>
          <Separator size="xs" />
          <Button
            onClick={onFocus}
            variant="secondary"
            size="xs"
            justify="center"
            fullWidth
            leftSection={
              isFocused ? <IconTargetOff size={14} /> : <IconTarget size={14} />
            }
          >
            {isFocused ? 'Clear focus' : 'Focus on this service'}
          </Button>
        </>
      ) : null}
    </Stack>
  );
}
