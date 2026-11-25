import { useEffect } from 'react';

import styles from './TeamSettings.module.scss';

const WAIT_FOR_ELEMENT_MS = 3000;
const HIGHLIGHT_MS = 1600;

/**
 * Scrolls to and briefly highlights the setting whose id is `anchor`. Sections
 * render their fields once their data loads, so this waits for the element.
 * Bump `nonce` to jump to the same setting again.
 */
export function useScrollToSetting(anchor: string | null, nonce: number) {
  useEffect(() => {
    if (!anchor) return;
    const started = performance.now();
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let el: HTMLElement | null = null;

    const tryScroll = () => {
      el = document.getElementById(anchor);
      if (!el) {
        if (performance.now() - started < WAIT_FOR_ELEMENT_MS) {
          frame = requestAnimationFrame(tryScroll);
        }
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.remove(styles.highlighted);
      // Restart the animation when the same setting is picked twice.
      void el.offsetWidth;
      el.classList.add(styles.highlighted);
      timeout = setTimeout(
        () => el?.classList.remove(styles.highlighted),
        HIGHLIGHT_MS,
      );
    };
    frame = requestAnimationFrame(tryScroll);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      el?.classList.remove(styles.highlighted);
    };
  }, [anchor, nonce]);
}
