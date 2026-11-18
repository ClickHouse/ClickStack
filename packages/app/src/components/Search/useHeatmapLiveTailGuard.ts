import { useEffect } from 'react';

/**
 * Keeps live tail off while the trace heatmap shows: each tick moves the time
 * range, and the heatmap keys its uPlot instance on the config, so it would
 * rebuild on every refresh. Checking `isLive` too switches live tail off again
 * if any control turns it back on under the heatmap.
 */
export function useHeatmapLiveTailGuard({
  isHeatmapChartVisible,
  isLive,
  setIsLive,
}: {
  isHeatmapChartVisible: boolean;
  isLive: boolean;
  setIsLive: (isLive: boolean) => unknown;
}) {
  useEffect(() => {
    if (isHeatmapChartVisible && isLive) {
      setIsLive(false);
    }
  }, [isHeatmapChartVisible, isLive, setIsLive]);
}
