import { useMemo } from 'react';
import Head from 'next/head';
import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs';
import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
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
import { useSources } from '@/source';

import {
  compareSlos,
  DEFAULT_SLO_SORT,
  SLO_SORT_VALUES,
  type SloSort,
} from './sloListSort';
import { SloListToolbar } from './SloListToolbar';
import { SloTable } from './SloTable';
import {
  getSloDisplayState,
  SLO_DISPLAY_STATES,
  type SloDisplayState,
  sloStateLabel,
} from './sloUtils';

function matchesSearch(slo: SloApiResponse, term: string) {
  return [slo.name, slo.description ?? '', ...slo.tags]
    .join(' ')
    .toLowerCase()
    .includes(term.toLowerCase());
}

export default function SlosListPage() {
  const enabled = useSlosEnabledGuard();
  const title = usePageTitle('SLOs');
  const { data: slos, isPending, isError, refetch } = useSlos();

  const { data: allSources } = useSources();
  const [search, setSearch] = useQueryState('search');
  const [stateFilter, setStateFilter] = useQueryState(
    'state',
    parseAsStringEnum<SloDisplayState>(SLO_DISPLAY_STATES),
  );
  const [tagFilter, setTagFilter] = useQueryState(
    'tag',
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [sourceFilter, setSourceFilter] = useQueryState('source');
  // Worst first by default, so what needs attention is on top.
  const [sort, setSort] = useQueryState(
    'sort',
    parseAsStringEnum<SloSort>(SLO_SORT_VALUES).withDefault(DEFAULT_SLO_SORT),
  );

  const filtered = useMemo(() => {
    const term = search?.trim() ?? '';
    const tags = tagFilter.map(tag => tag.toLowerCase());
    return (slos ?? [])
      .filter(
        slo =>
          (!term || matchesSearch(slo, term)) &&
          (!stateFilter || getSloDisplayState(slo) === stateFilter) &&
          // Every tag picked, as the dashboards list filters.
          tags.every(tag => slo.tags.some(t => t.toLowerCase() === tag)) &&
          (!sourceFilter || slo.source === sourceFilter),
      )
      .sort(compareSlos(sort));
  }, [slos, search, stateFilter, tagFilter, sourceFilter, sort]);

  // The tags and sources the team's SLOs use, to filter by.
  const { tagOptions, sourceOptions } = useMemo(() => {
    const sourceIds = [...new Set((slos ?? []).map(slo => slo.source))];
    return {
      tagOptions: [...new Set((slos ?? []).flatMap(slo => slo.tags))].sort(),
      sourceOptions: sourceIds.map(id => ({
        value: id,
        label: allSources?.find(s => s.id === id)?.name ?? 'Unknown source',
      })),
    };
  }, [slos, allSources]);

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
            <SloListToolbar
              search={search ?? ''}
              onSearchChange={value => setSearch(value || null)}
              tags={tagOptions}
              tagFilter={tagFilter}
              onTagFilterChange={value =>
                setTagFilter(value.length > 0 ? value : null)
              }
              sources={sourceOptions}
              sourceFilter={sourceFilter}
              onSourceFilterChange={setSourceFilter}
              sort={sort}
              onSortChange={setSort}
            />
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
