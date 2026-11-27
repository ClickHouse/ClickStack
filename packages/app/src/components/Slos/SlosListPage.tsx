import { useMemo } from 'react';
import Head from 'next/head';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { compareSlosWorstFirst } from '@hyperdx/common-utils/dist/core/sloStats';
import {
  Alert,
  Button,
  Container,
  Flex,
  Group,
  Skeleton,
  Text,
} from '@mantine/core';
import { IconTargetArrow } from '@tabler/icons-react';

import { usePageTitle } from '@/brand';
import EmptyState from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { withAppNavForSurface } from '@/layout';
import { useSlos, useSlosEnabledGuard } from '@/slo';

import { SloTable } from './SloTable';
import {
  getSloDisplayState,
  SLO_DISPLAY_STATES,
  type SloDisplayState,
  sloStateLabel,
} from './sloUtils';

export default function SlosListPage() {
  const enabled = useSlosEnabledGuard();
  const title = usePageTitle('SLOs');
  const { data: slos, isPending, isError, refetch } = useSlos();

  const [stateFilter, setStateFilter] = useQueryState(
    'state',
    parseAsStringEnum<SloDisplayState>(SLO_DISPLAY_STATES),
  );

  // Worst first, so what needs attention is on top.
  const filtered = useMemo(
    () =>
      (slos ?? [])
        .filter(slo => !stateFilter || getSloDisplayState(slo) === stateFilter)
        .sort(compareSlosWorstFirst),
    [slos, stateFilter],
  );

  const counts = useMemo(() => {
    const result = new Map<SloDisplayState, number>();
    for (const slo of slos ?? []) {
      const state = getSloDisplayState(slo);
      result.set(state, (result.get(state) ?? 0) + 1);
    }
    return result;
  }, [slos]);

  if (!enabled) return null;
  const hasNone = !isPending && !isError && (slos ?? []).length === 0;

  return (
    <div
      data-testid="slos-page"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
    >
      <Head>
        <title>{title}</title>
      </Head>
      <PageHeader title="SLOs" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {hasNone ? (
          <Flex align="center" justify="center" style={{ flex: 1 }}>
            <EmptyState
              icon={<IconTargetArrow size={32} />}
              title="No SLOs yet"
              description="Define a target for the share of good events in your logs or traces, and get alerted when the error budget burns too fast."
            />
          </Flex>
        ) : (
          <Container maw={1500} w="100%" py="md">
            <Group gap="xs" mb="sm" data-testid="slo-state-summary">
              {/* Counted once loaded, so a failed load never reads as 0. */}
              {slos && (
                <Text size="sm" fw={500}>
                  {slos.length === 1 ? '1 SLO' : `${slos.length} SLOs`}
                </Text>
              )}
              {SLO_DISPLAY_STATES.filter(s => counts.get(s)).map(s => (
                <Button
                  key={s}
                  size="compact-xs"
                  variant={stateFilter === s ? 'primary' : 'secondary'}
                  onClick={() => setStateFilter(stateFilter === s ? null : s)}
                >
                  {counts.get(s)} {sloStateLabel(s).toLowerCase()}
                </Button>
              ))}
            </Group>
            {isPending ? (
              <Skeleton h={200} />
            ) : isError ? (
              <Alert variant="danger" title="Failed to load SLOs">
                <Group gap="xs">
                  Something went wrong fetching your SLOs.
                  <Button
                    variant="secondary"
                    size="compact-xs"
                    onClick={() => refetch()}
                  >
                    Retry
                  </Button>
                </Group>
              </Alert>
            ) : filtered.length > 0 ? (
              <SloTable slos={filtered} />
            ) : (
              <EmptyState
                variant="card"
                icon={<IconTargetArrow size={32} />}
                title="No matching SLOs"
                description="Try adjusting your search or filters."
              />
            )}
          </Container>
        )}
      </div>
    </div>
  );
}

SlosListPage.getLayout = withAppNavForSurface('slo');
