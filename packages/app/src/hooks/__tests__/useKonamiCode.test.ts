import { act, renderHook } from '@testing-library/react';

import { useKonamiCode } from '@/hooks/useKonamiCode';

const CODE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];

const press = (keys: string[]) =>
  act(() => {
    keys.forEach(key =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key })),
    );
  });

describe('useKonamiCode', () => {
  it('fires once per full sequence', () => {
    const onMatch = jest.fn();
    renderHook(() => useKonamiCode(onMatch));

    press(CODE.slice(0, -1));
    expect(onMatch).not.toHaveBeenCalled();

    press(['a']);
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it('matches after stray keys and with caps lock on', () => {
    const onMatch = jest.fn();
    renderHook(() => useKonamiCode(onMatch));

    press(['ArrowUp', 'x', 'ArrowUp', ...CODE.slice(0, -2), 'B', 'A']);
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it('ignores keydown events with no key', () => {
    const onError = jest.fn();
    window.addEventListener('error', onError);
    renderHook(() => useKonamiCode(jest.fn()));

    act(() => {
      window.dispatchEvent(new Event('keydown'));
    });
    window.removeEventListener('error', onError);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops listening on unmount', () => {
    const onMatch = jest.fn();
    const { unmount } = renderHook(() => useKonamiCode(onMatch));

    unmount();
    press(CODE);
    expect(onMatch).not.toHaveBeenCalled();
  });
});
