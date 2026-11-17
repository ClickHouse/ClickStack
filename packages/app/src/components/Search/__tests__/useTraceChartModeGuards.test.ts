import { renderHook } from '@testing-library/react';

import { useTraceChartModeGuards } from '@/components/Search/useTraceChartModeGuards';

type Props = {
  sourceId: string | undefined;
  isHeatmapChartVisible: boolean;
  isLive: boolean;
};

function renderGuards(initialProps: Props) {
  // Stable setters, like the nuqs ones on the search page, so only the
  // props under test retrigger the effects.
  const setTraceChartMode = jest.fn();
  const setIsLive = jest.fn();
  const hook = renderHook(
    (props: Props) =>
      useTraceChartModeGuards({ ...props, setTraceChartMode, setIsLive }),
    { initialProps },
  );
  return { ...hook, setTraceChartMode, setIsLive };
}

describe('useTraceChartModeGuards', () => {
  describe('source change', () => {
    it('keeps the mode when the source first resolves', () => {
      const { rerender, setTraceChartMode } = renderGuards({
        sourceId: undefined,
        isHeatmapChartVisible: false,
        isLive: false,
      });
      rerender({
        sourceId: 'traces',
        isHeatmapChartVisible: true,
        isLive: false,
      });

      expect(setTraceChartMode).not.toHaveBeenCalled();
    });

    // null clears the param, so the URL falls back to the RED default instead
    // of carrying ?traceChartMode=red after every source switch.
    it('resets to RED by clearing the param when the source changes', () => {
      const { rerender, setTraceChartMode } = renderGuards({
        sourceId: 'traces',
        isHeatmapChartVisible: true,
        isLive: false,
      });
      rerender({
        sourceId: 'logs',
        isHeatmapChartVisible: false,
        isLive: false,
      });

      expect(setTraceChartMode).toHaveBeenCalledTimes(1);
      expect(setTraceChartMode).toHaveBeenCalledWith(null);
    });

    it('does not reset on a re-render with the same source', () => {
      const { rerender, setTraceChartMode } = renderGuards({
        sourceId: 'traces',
        isHeatmapChartVisible: false,
        isLive: true,
      });
      rerender({
        sourceId: 'traces',
        isHeatmapChartVisible: true,
        isLive: true,
      });
      rerender({
        sourceId: 'traces',
        isHeatmapChartVisible: true,
        isLive: false,
      });

      expect(setTraceChartMode).not.toHaveBeenCalled();
    });
  });

  describe('live tail', () => {
    it('turns live tail off when the heatmap becomes visible', () => {
      const { rerender, setIsLive } = renderGuards({
        sourceId: 'traces',
        isHeatmapChartVisible: false,
        isLive: true,
      });
      expect(setIsLive).not.toHaveBeenCalled();

      rerender({
        sourceId: 'traces',
        isHeatmapChartVisible: true,
        isLive: true,
      });
      expect(setIsLive).toHaveBeenCalledTimes(1);
      expect(setIsLive).toHaveBeenCalledWith(false);
    });

    it('turns live tail off again when it is resumed under the heatmap', () => {
      const { rerender, setIsLive } = renderGuards({
        sourceId: 'traces',
        isHeatmapChartVisible: true,
        isLive: false,
      });
      expect(setIsLive).not.toHaveBeenCalled();

      rerender({
        sourceId: 'traces',
        isHeatmapChartVisible: true,
        isLive: true,
      });
      expect(setIsLive).toHaveBeenCalledTimes(1);
      expect(setIsLive).toHaveBeenCalledWith(false);
    });

    it('leaves live tail alone while the RED view is showing', () => {
      const { rerender, setIsLive } = renderGuards({
        sourceId: 'traces',
        isHeatmapChartVisible: false,
        isLive: true,
      });
      rerender({
        sourceId: 'traces',
        isHeatmapChartVisible: false,
        isLive: false,
      });
      rerender({
        sourceId: 'traces',
        isHeatmapChartVisible: false,
        isLive: true,
      });

      expect(setIsLive).not.toHaveBeenCalled();
    });
  });
});
