import { useEffect } from 'react';

import styles from './CrtOverlay.module.scss';

/** Full-viewport CRT effect. Mount only while the preference is on. */
export function CrtOverlay() {
  useEffect(() => {
    // A module class, not a global selector: the production build rejects those.
    document.documentElement.classList.add(styles.root);
    return () => document.documentElement.classList.remove(styles.root);
  }, []);

  return (
    <div className={styles.overlay} aria-hidden data-testid="crt-overlay">
      <div className={styles.roll} />
    </div>
  );
}
