import { useCallback, useEffect, useRef } from 'react';

import type { TraceChartMode } from './TraceRedMetricsChart';

/**
 * Resets the trace RED/Heatmap choice to RED after the user picks a source,
 * so coming back to a trace source doesn't silently reopen the heatmap. The
 * page arms it on a pick, and it fires once the searched source reaches that
 * pick, so it lands on the new history entry; Back/Forward never arm it, and
 * an undone pick disarms it. It clears the param: nuqs 1.x would write 'red'.
 */
export function useTraceChartModeReset({
  searchedSourceId,
  setTraceChartMode,
}: {
  searchedSourceId: string | undefined;
  setTraceChartMode: (mode: TraceChartMode | null) => unknown;
}) {
  const pendingSourceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      pendingSourceIdRef.current != null &&
      pendingSourceIdRef.current === searchedSourceId
    ) {
      pendingSourceIdRef.current = null;
      setTraceChartMode(null);
    }
  }, [searchedSourceId, setTraceChartMode]);

  const arm = useCallback((sourceId: string | null) => {
    pendingSourceIdRef.current = sourceId;
  }, []);
  const disarm = useCallback(() => {
    pendingSourceIdRef.current = null;
  }, []);

  return { arm, disarm };
}
