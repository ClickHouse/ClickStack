import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import { Alert, Skeleton } from '@mantine/core';

import { SloStatsGrid } from './SloDetailPanels';
import type { SloLiveStatus } from './useSloLiveStatus';

/**
 * The numbers on the page, for the SLO or one of its groups: computed now
 * when the source is there (live), or the stored snapshot the list uses when
 * it is not, or until live ones load.
 */
export function SloNumbers({
  slo,
  group,
  hasSource,
  live,
  liveError,
}: {
  slo: SloApiResponse;
  group?: string;
  hasSource: boolean;
  live?: SloLiveStatus;
  liveError?: Error | null;
}) {
  const { status } = slo;
  if (live) {
    return <SloStatsGrid slo={slo} stats={live.stats} state={live.state} />;
  }
  // An SLO that never updated successfully has no stored numbers to show.
  const usable =
    status != null && (status.state !== 'error' || status.lastSuccessAt)
      ? status
      : null;
  const stored =
    group != null ? usable?.groups?.find(g => g.value === group) : usable;
  return (
    <>
      {liveError ? (
        <Alert variant="danger" title="Could not compute the numbers">
          {liveError.message}
        </Alert>
      ) : (
        status?.state === 'error' && (
          <Alert variant="danger" title="The last update failed">
            {status.error}
          </Alert>
        )
      )}
      {stored ? (
        <SloStatsGrid slo={slo} stats={stored} state={stored.state} />
      ) : hasSource && !liveError ? (
        <Skeleton h={110} />
      ) : (
        <Alert variant="info" title="No numbers yet">
          The SLO is updated in the background, within a few minutes of a save.
        </Alert>
      )}
    </>
  );
}
