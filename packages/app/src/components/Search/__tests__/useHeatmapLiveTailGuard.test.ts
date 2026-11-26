import { renderHook } from '@testing-library/react';

import { useHeatmapLiveTailGuard } from '@/components/Search/useHeatmapLiveTailGuard';

type Props = {
  isHeatmapChartVisible: boolean;
  isLive: boolean;
};

function renderGuard(initialProps: Props) {
  // A stable setter, like the nuqs one on the search page, so only the props
  // under test retrigger the effect.
  const setIsLive = jest.fn();
  const hook = renderHook(
    (props: Props) => useHeatmapLiveTailGuard({ ...props, setIsLive }),
    { initialProps },
  );
  return { ...hook, setIsLive };
}

describe('useHeatmapLiveTailGuard', () => {
  it('turns live tail off when the heatmap becomes visible', () => {
    const { rerender, setIsLive } = renderGuard({
      isHeatmapChartVisible: false,
      isLive: true,
    });
    expect(setIsLive).not.toHaveBeenCalled();

    rerender({ isHeatmapChartVisible: true, isLive: true });
    expect(setIsLive).toHaveBeenCalledTimes(1);
    expect(setIsLive).toHaveBeenCalledWith(false);
  });

  it('turns live tail off again when it is resumed under the heatmap', () => {
    const { rerender, setIsLive } = renderGuard({
      isHeatmapChartVisible: true,
      isLive: false,
    });
    expect(setIsLive).not.toHaveBeenCalled();

    rerender({ isHeatmapChartVisible: true, isLive: true });
    expect(setIsLive).toHaveBeenCalledTimes(1);
    expect(setIsLive).toHaveBeenCalledWith(false);
  });

  it('leaves live tail alone while the RED view is showing', () => {
    const { rerender, setIsLive } = renderGuard({
      isHeatmapChartVisible: false,
      isLive: true,
    });
    rerender({ isHeatmapChartVisible: false, isLive: false });
    rerender({ isHeatmapChartVisible: false, isLive: true });

    expect(setIsLive).not.toHaveBeenCalled();
  });
});
