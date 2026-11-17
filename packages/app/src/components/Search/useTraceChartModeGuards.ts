import { useEffect, useRef } from 'react';

import type { TraceChartMode } from './TraceRedMetricsChart';

/**
 * Keeps the trace RED/Heatmap mode coherent with the rest of the search page.
 *
 * - Resets to the default RED view when the searched source actually changes,
 *   so returning to a trace source after viewing another one doesn't silently
 *   reopen in Heatmap. The ref starts undefined and is only compared once a
 *   real id has been seen, so the async source resolution on first load
 *   (undefined -> id) doesn't count as a change and a shared link that pins
 *   ?traceChartMode=heatmap survives.
 * - Keeps live tail off while the heatmap is the visible chart. A live tick
 *   moves the absolute time range, and the heatmap keys its uPlot instance on
 *   the chart config, so every refresh would tear the chart down and rebuild
 *   it with a recomputed y-axis instead of updating in place. `isLive` is part
 *   of the check, not just the visibility, so live tail turned back on while
 *   the heatmap is showing (through any control) is switched off again.
 */
export function useTraceChartModeGuards({
  sourceId,
  setTraceChartMode,
  isHeatmapChartVisible,
  isLive,
  setIsLive,
}: {
  sourceId: string | undefined;
  setTraceChartMode: (mode: TraceChartMode) => unknown;
  isHeatmapChartVisible: boolean;
  isLive: boolean;
  setIsLive: (isLive: boolean) => unknown;
}) {
  const prevSourceIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      prevSourceIdRef.current !== undefined &&
      prevSourceIdRef.current !== sourceId
    ) {
      setTraceChartMode('red');
    }
    prevSourceIdRef.current = sourceId;
  }, [sourceId, setTraceChartMode]);

  useEffect(() => {
    if (isHeatmapChartVisible && isLive) {
      setIsLive(false);
    }
  }, [isHeatmapChartVisible, isLive, setIsLive]);
}
