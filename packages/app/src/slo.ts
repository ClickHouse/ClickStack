import { useEffect } from 'react';
import { useRouter } from 'next/router';
import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from './api';
import { IS_SLOS_ENABLED } from './config';

const SLOS_QUERY_KEY = ['slos'];
// Snapshots refresh server-side every few minutes; polling the stored state
// is cheap because it never runs a ClickHouse query.
const SLO_POLL_MS = 60_000;

/**
 * Direct-URL guard while the feature bakes: the nav only links to SLOs when
 * the flag is on, but the routes must bounce too.
 */
export function useSlosEnabledGuard(): boolean {
  const router = useRouter();
  useEffect(() => {
    if (!IS_SLOS_ENABLED) router.replace('/search');
  }, [router]);
  return IS_SLOS_ENABLED;
}

export function useSlos() {
  return useQuery({
    queryKey: SLOS_QUERY_KEY,
    queryFn: () => hdxServer('slos').json<SloApiResponse[]>(),
    enabled: IS_SLOS_ENABLED,
    refetchInterval: SLO_POLL_MS,
  });
}

export function useDeleteSlo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => hdxServer(`slos/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SLOS_QUERY_KEY }),
  });
}
