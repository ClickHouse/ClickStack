import { useCallback, useEffect, useRef } from 'react';

import type { TraceChartMode } from './TraceRedMetricsChart';

/**
 * Resets the trace RED/Heatmap choice to the default RED view when the user
 * picks a different source. The choice was made for the previous source, so
 * coming back to a trace source shouldn't silently reopen the heatmap (and
 * turn live tail off again).
 *
 * The page arms the reset when the user picks a source, and it fires once the
 * searched source (from the URL) reaches that source. Resetting at the pick
 * itself would rewrite the previous history entry, since the pick runs before
 * the debounced search pushes the new source. Back and Forward never arm it,
 * so they keep the mode the URL restores, and the page disarms it when the
 * user re-selects the searched source before the search runs. The mode is
 * cleared rather than set to 'red', since nuqs 1.x writes an explicitly set
 * default into the URL.
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
