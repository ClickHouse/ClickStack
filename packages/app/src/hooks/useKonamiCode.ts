import { useEffect } from 'react';

const KONAMI_CODE = [
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
].join();

/** Calls `onMatch` each time the Konami code is typed. Pass a stable callback. */
export function useKonamiCode(onMatch: () => void) {
  useEffect(() => {
    const recent: string[] = [];
    const onKeyDown = (e: KeyboardEvent) => {
      recent.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if (recent.length > 10) recent.shift();
      if (recent.join() === KONAMI_CODE) {
        recent.length = 0;
        onMatch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onMatch]);
}
