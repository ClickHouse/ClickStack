import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import type { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Anchor,
  Breadcrumbs,
  Container,
  Group,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';

import { usePageTitle } from '@/brand';
import { PageHeader } from '@/components/PageHeader';
import { withAppNavForSurface } from '@/layout';
import { useSlo, useSlosEnabledGuard } from '@/slo';
import { useSource } from '@/source';

import { SloNumbers } from './SloNumbers';
import { SloRowMenu } from './SloRowMenu';
import { SloStateBadge } from './SloStateBadge';
import { getSloDisplayState } from './sloUtils';
import {
  type SloLiveStatus,
  useSloLiveStatus,
  useSloNow,
} from './useSloLiveStatus';

function SloDetailView({
  slo,
  source,
  live,
  liveError,
}: {
  slo: SloApiResponse;
  source?: TSource;
  live?: SloLiveStatus;
  liveError?: Error | null;
}) {
  const router = useRouter();
  // Named with its section, as the alert detail page is.
  const title = usePageTitle(`${slo.name} - SLOs`);
  const state = live?.state ?? getSloDisplayState(slo);

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
          </Group>
        }
        actions={
          <Group gap="xs" wrap="nowrap">
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
            hasSource={source != null}
            live={live}
            liveError={liveError}
          />
        </Stack>
      </Container>
    </div>
  );
}

/** One SLO is computed when it is looked at, as every chart is. */
function SloDetailLive({
  slo,
  source,
}: {
  slo: SloApiResponse;
  source: TSource;
}) {
  const now = useSloNow();
  const { live, error } = useSloLiveStatus(slo, source, now);
  return (
    <SloDetailView slo={slo} source={source} live={live} liveError={error} />
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
  // A deleted source leaves the stored numbers, which say what went wrong.
  return source ? (
    <SloDetailLive slo={slo} source={source} />
  ) : (
    <SloDetailView slo={slo} />
  );
}

// Client only, like Search and the chart explorer: the SQL editors and the
// themed charts render differently on the server.
const SloDetailPageDynamic = dynamic(async () => SloDetailPage, { ssr: false });

// @ts-expect-error next/dynamic component type does not include the getLayout static
SloDetailPageDynamic.getLayout = withAppNavForSurface('slo');

export default SloDetailPageDynamic;
