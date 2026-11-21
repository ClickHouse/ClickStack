import { act, renderHook } from '@testing-library/react';

import { useTraceChartModeReset } from '@/components/Search/useTraceChartModeReset';

type Props = { searchedSourceId: string | undefined };

function renderReset(searchedSourceId: string | undefined) {
  // A stable setter, like the nuqs one on the search page, so only the
  // searched source retriggers the effect.
  const setTraceChartMode = jest.fn();
  const hook = renderHook(
    ({ searchedSourceId }: Props) =>
      useTraceChartModeReset({ searchedSourceId, setTraceChartMode }),
    { initialProps: { searchedSourceId } },
  );
  return { ...hook, setTraceChartMode };
}

describe('useTraceChartModeReset', () => {
  it('clears the mode once the searched source reaches the picked source', () => {
    const { result, rerender, setTraceChartMode } = renderReset('traces');

    act(() => result.current.arm('logs'));
    // The pick alone doesn't reset: the URL still points at the old source.
    rerender({ searchedSourceId: 'traces' });
    expect(setTraceChartMode).not.toHaveBeenCalled();

    rerender({ searchedSourceId: 'logs' });
    expect(setTraceChartMode).toHaveBeenCalledTimes(1);
    expect(setTraceChartMode).toHaveBeenCalledWith(null);
  });

  it('fires once per pick', () => {
    const { result, rerender, setTraceChartMode } = renderReset('traces');

    act(() => result.current.arm('logs'));
    rerender({ searchedSourceId: 'logs' });
    rerender({ searchedSourceId: 'traces' });
    rerender({ searchedSourceId: 'logs' });

    expect(setTraceChartMode).toHaveBeenCalledTimes(1);
  });

  // Back/Forward changes the searched source without a pick, so the mode the
  // URL restores stays.
  it('leaves source changes it was not armed for alone', () => {
    const { rerender, setTraceChartMode } = renderReset('logs');

    rerender({ searchedSourceId: 'traces' });
    rerender({ searchedSourceId: 'logs' });

    expect(setTraceChartMode).not.toHaveBeenCalled();
  });

  // Re-selecting the searched source before the search runs undoes the pick;
  // a later navigation to the abandoned source must not trigger the reset.
  it('drops an armed reset when the pick is undone', () => {
    const { result, rerender, setTraceChartMode } = renderReset('traces');

    act(() => {
      result.current.arm('logs');
      result.current.disarm();
    });
    rerender({ searchedSourceId: 'logs' });

    expect(setTraceChartMode).not.toHaveBeenCalled();
  });

  it('follows the latest pick', () => {
    const { result, rerender, setTraceChartMode } = renderReset('traces');

    act(() => {
      result.current.arm('logs');
      result.current.arm('sessions');
    });
    rerender({ searchedSourceId: 'logs' });
    expect(setTraceChartMode).not.toHaveBeenCalled();

    rerender({ searchedSourceId: 'sessions' });
    expect(setTraceChartMode).toHaveBeenCalledTimes(1);
  });
});
