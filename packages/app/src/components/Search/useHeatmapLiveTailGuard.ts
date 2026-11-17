import { useEffect } from 'react';

/**
 * Keeps live tail off while the trace heatmap is the visible chart, the way
 * delta and pattern modes keep it off. A live tick moves the absolute time
 * range, and the heatmap keys its uPlot instance on the chart config, so every
 * refresh would tear the chart down and rebuild it with a recomputed y-axis
 * instead of updating in place. `isLive` is part of the check, not just the
 * visibility, so live tail turned back on while the heatmap is showing
 * (through any control) is switched off again.
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
