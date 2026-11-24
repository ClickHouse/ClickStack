import { useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import type { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Anchor,
  Breadcrumbs,
  Button,
  Container,
  Group,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import { usePageTitle } from '@/brand';
import { PageHeader } from '@/components/PageHeader';
import { withAppNavForSurface } from '@/layout';
import { useSlo, useSlosEnabledGuard } from '@/slo';
import { useSource } from '@/source';

import { SloCharts } from './SloCharts';
import { SloAlertPanel, SloDefinitionPanel } from './SloDetailPanels';
import {
  SloEventsDrawer,
  type SloEventsRange,
  type SloEventsRequest,
} from './SloEventsDrawer';
import { SloGroupSelect } from './SloGroupSelect';
import { SloNumbers } from './SloNumbers';
import { SloRowMenu } from './SloRowMenu';
import { SloStateBadge } from './SloStateBadge';
import { getSloDisplayState, getSloEventsRange } from './sloUtils';
import {
  type SloLiveStatus,
  useSloLiveStatus,
  useSloNow,
} from './useSloLiveStatus';

type SloGroupProps = {
  /** The group of a grouped SLO the page shows; all groups when unset. */
  group?: string;
  onGroupChange: (group: string | null) => void;
};

function SloDetailView({
  slo,
  source,
  now,
  live,
  liveError,
  group,
  onGroupChange,
}: SloGroupProps & {
  slo: SloApiResponse;
  source?: TSource;
  now?: Date;
  live?: SloLiveStatus;
  liveError?: Error | null;
}) {
  const router = useRouter();
  // Named with its section, as the alert detail page is.
  const title = usePageTitle(`${slo.name} - SLOs`);
  // The bad-events flyout lives in the URL, with its time range, so list
  // rows and alert notifications can open it directly:
  // ?bad=burn|window|custom&from&to.
  const [badEvents, setBadEvents] = useQueryStates({
    bad: parseAsStringEnum<SloEventsRange>(['burn', 'window', 'custom']),
    from: parseAsInteger,
    to: parseAsInteger,
  });

  const eventsRequest = useMemo<SloEventsRequest | null>(() => {
    const { bad, from, to } = badEvents;
    if (bad == null || from == null || to == null || to <= from) return null;
    return { range: bad, dateRange: [new Date(from), new Date(to)] };
  }, [badEvents]);

  // Ranges that end now are resolved here, when the flyout is opened.
  const openBadEvents = (range: 'burn' | 'window') => {
    const [from, to] = getSloEventsRange(slo, range, Date.now());
    void setBadEvents({ bad: range, from, to });
  };
  const onBucketSelect = useCallback(
    (start: Date, end: Date) =>
      setBadEvents({ bad: 'custom', from: start.getTime(), to: end.getTime() }),
    [setBadEvents],
  );
  // A grouped SLO is as bad as its worst group, which its stored state
  // knows and the live numbers of all groups together do not.
  const state =
    group != null
      ? (live?.state ??
        slo.status?.groups?.find(g => g.value === group)?.state ??
        'pending')
      : slo.groupBy != null
        ? getSloDisplayState(slo)
        : (live?.state ?? getSloDisplayState(slo));

  return (
    <div data-testid="slo-detail-page">
      <Head>
        <title>{title}</title>
      </Head>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs fz="sm">
            <Anchor component={Link} href="/slos" fz="sm" c="dimmed">
              SLOs
            </Anchor>
          </Breadcrumbs>
        }
        leading={
          <Group gap="sm">
            <Text fw={500} data-testid="slo-detail-name">
              {slo.name}
            </Text>
            <SloStateBadge state={state} />
            {slo.groupBy != null && (
              <SloGroupSelect
                slo={slo}
                group={group}
                onChange={onGroupChange}
              />
            )}
          </Group>
        }
        actions={
          <Group gap="xs" wrap="nowrap">
            <Button
              variant="primary"
              size="xs"
              leftSection={<IconSearch size={14} />}
              onClick={() => openBadEvents('burn')}
              data-testid="slo-view-bad-events"
            >
              View bad events
            </Button>
            <SloRowMenu slo={slo} onDeleted={() => router.push('/slos')} />
          </Group>
        }
      />
      <Container size="xl" py="md">
        <Stack gap="md">
          {slo.description && (
            <Text size="sm" c="dimmed">
              {slo.description}
            </Text>
          )}
          <SloNumbers
            slo={slo}
            group={group}
            hasSource={source != null}
            live={live}
            liveError={liveError}
          />
          {source && now && (
            <SloCharts
              slo={slo}
              source={source}
              now={now}
              group={group}
              onBucketSelect={onBucketSelect}
            />
          )}
          <SloAlertPanel slo={slo} />
          <SloDefinitionPanel slo={slo} sourceName={source?.name} />
        </Stack>
      </Container>
      <SloEventsDrawer
        slo={slo}
        source={source}
        group={group}
        request={eventsRequest}
        onRangeChange={openBadEvents}
        onClose={() => setBadEvents({ bad: null, from: null, to: null })}
      />
    </div>
  );
}

/** One SLO is computed when it is looked at, as every chart is. */
function SloDetailLive({
  slo,
  source,
  ...groupProps
}: SloGroupProps & {
  slo: SloApiResponse;
  source: TSource;
}) {
  const now = useSloNow();
  const { live, error } = useSloLiveStatus(slo, source, now, groupProps.group);
  return (
    <SloDetailView
      slo={slo}
      source={source}
      now={now}
      live={live}
      liveError={error}
      {...groupProps}
    />
  );
}

function SloDetailPage() {
  const enabled = useSlosEnabledGuard();
  const router = useRouter();
  const sloId =
    typeof router.query.sloId === 'string' ? router.query.sloId : undefined;
  const { data: slo, isPending, isError } = useSlo(sloId);
  const { data: source, isPending: isSourcePending } = useSource({
    id: slo?.source,
  });
  // The group in view, from list rows and alert notifications too.
  const [groupParam, setGroup] = useQueryState('group');

  if (!enabled) return null;
  if (isPending || (slo != null && isSourcePending)) {
    return (
      <Container size="xl" py="md">
        <Skeleton h={400} />
      </Container>
    );
  }
  if (isError || !slo) {
    return (
      <Container size="xl" py="md">
        <Alert variant="danger" title="SLO not found">
          <Anchor component={Link} href="/slos">
            Back to SLOs
          </Anchor>
        </Alert>
      </Container>
    );
  }
  const groupProps: SloGroupProps = {
    group: slo.groupBy != null ? (groupParam ?? undefined) : undefined,
    onGroupChange: value => void setGroup(value),
  };
  // A deleted source leaves the stored numbers, which say what went wrong.
  return source ? (
    <SloDetailLive slo={slo} source={source} {...groupProps} />
  ) : (
    <SloDetailView slo={slo} {...groupProps} />
  );
}

// Client only, like Search and the chart explorer: the SQL editors and the
// themed charts render differently on the server.
const SloDetailPageDynamic = dynamic(async () => SloDetailPage, { ssr: false });

// @ts-expect-error next/dynamic component type does not include the getLayout static
SloDetailPageDynamic.getLayout = withAppNavForSurface('slo');

export default SloDetailPageDynamic;
