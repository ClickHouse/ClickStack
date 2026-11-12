import { useState } from 'react';

import type { ServiceAggregation } from '@/hooks/useServiceMap';

import { isServiceMapTooLarge } from './utils';

type Services = Map<string, ServiceAggregation> | undefined;

/**
 * Holds an oversized map behind "Show anyway". The override is keyed by the
 * result set's identity, so the next query result is gated again.
 */
export function useServiceMapSizeGate(services: Services) {
  const [shownAnyway, setShownAnyway] = useState<Services>();
  return {
    tooLarge: isServiceMapTooLarge(
      services?.size ?? 0,
      services !== undefined && shownAnyway === services,
    ),
    showAnyway: () => setShownAnyway(services),
  };
}
