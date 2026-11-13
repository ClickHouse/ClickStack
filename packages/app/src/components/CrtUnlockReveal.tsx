import * as React from 'react';

import styles from './CrtUnlockReveal.module.scss';

const LINES = [
  { text: 'Cheat code accepted', delay: 0.3 },
  { text: 'Loading crt_mode.sys', delay: 0.8 },
  { text: 'Warming up the tube...', delay: 2.4 },
];

/** Plays a retro boot scene over `children`, then powers them on underneath. */
export function CrtUnlockReveal({ children }: { children: React.ReactNode }) {
  const [playing, setPlaying] = React.useState(true);

  return (
    <div className={styles.root}>
      <div className={styles.content}>{children}</div>
      {playing && (
        <>
          <div className={styles.flash} aria-hidden />
          <div
            className={styles.scene}
            aria-hidden
            data-testid="crt-unlock-scene"
            onAnimationEnd={e => {
              // Child animations bubble up here; only the final collapse ends the scene.
              if (
                e.target === e.currentTarget &&
                e.animationName.includes('collapse')
              ) {
                setPlaying(false);
              }
            }}
          >
            {LINES.slice(0, 2).map(line => (
              <Line key={line.text} {...line} />
            ))}
            <div className={styles.bar}>
              <div className={styles.barFill} />
            </div>
            <Line {...LINES[2]} cursor />
          </div>
        </>
      )}
    </div>
  );
}

function Line({
  text,
  delay,
  cursor,
}: {
  text: string;
  delay: number;
  cursor?: boolean;
}) {
  return (
    <div className={cursor ? styles.cursor : undefined}>
      <span
        className={styles.line}
        style={
          {
            '--chars': text.length,
            '--delay': `${delay}s`,
          } as React.CSSProperties
        }
      >
        {'> '}
        {text}
      </span>
    </div>
  );
}
