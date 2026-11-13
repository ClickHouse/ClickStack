import { useEffect } from 'react';

import styles from './CrtOverlay.module.scss';

/** Full-viewport CRT effect. Mount only while the preference is on. */
export function CrtOverlay() {
  useEffect(() => {
    // Lets the global text glow in the stylesheet apply without a body class.
    document.documentElement.setAttribute('data-crt', '');
    return () => document.documentElement.removeAttribute('data-crt');
  }, []);

  return (
    <div className={styles.overlay} aria-hidden data-testid="crt-overlay">
      <div className={styles.roll} />
    </div>
  );
}
