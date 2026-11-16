import { act, renderHook } from '@testing-library/react';

import { useServiceMapSizeGate } from '@/components/ServiceMap/useServiceMapSizeGate';
import { MAX_SERVICE_MAP_NODES } from '@/components/ServiceMap/utils';
import type { ServiceAggregation } from '@/hooks/useServiceMap';

function servicesOfSize(size: number): Map<string, ServiceAggregation> {
  const services = new Map<string, ServiceAggregation>();
  for (let i = 0; i < size; i++) {
    services.set(`svc-${i}`, {
      key: `svc-${i}`,
      serviceName: `svc-${i}`,
      dimensions: [],
      incomingRequests: {
        totalRequests: 1,
        errorCount: 0,
        errorPercentage: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        hasLatency: false,
      },
      incomingRequestsByClient: new Map(),
      outgoingRequests: 0,
    });
  }
  return services;
}

describe('useServiceMapSizeGate', () => {
  it('does not gate a map at the limit', () => {
    const { result } = renderHook(() =>
      useServiceMapSizeGate(servicesOfSize(MAX_SERVICE_MAP_NODES)),
    );
    expect(result.current.tooLarge).toBe(false);
  });

  it('gates an oversized map until Show anyway, then gates the next result again', () => {
    const first = servicesOfSize(MAX_SERVICE_MAP_NODES + 1);
    const { result, rerender } = renderHook(
      ({ services }) => useServiceMapSizeGate(services),
      { initialProps: { services: first } },
    );
    expect(result.current.tooLarge).toBe(true);

    act(() => result.current.showAnyway());
    expect(result.current.tooLarge).toBe(false);

    // Same result set re-rendered: still shown.
    rerender({ services: first });
    expect(result.current.tooLarge).toBe(false);

    // A new query result of the same size is held back again.
    rerender({ services: servicesOfSize(MAX_SERVICE_MAP_NODES + 1) });
    expect(result.current.tooLarge).toBe(true);
  });
});
