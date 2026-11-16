import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * Arrow-key list. Single choice submits the highlighted item on Enter; with
 * `multi`, Space toggles items and Enter submits the checked ones.
 */
export default function Choice<T>({
  title,
  items,
  label,
  initial = 0,
  multi = false,
  isChecked = () => true,
  onSubmit,
  onCancel,
}: {
  title: string;
  items: T[];
  label: (item: T) => string;
  initial?: number;
  multi?: boolean;
  /** Which items start ticked in a `multi` list. Defaults to all. */
  isChecked?: (item: T) => boolean;
  onSubmit: (chosen: T[]) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(initial);
  const [checked, setChecked] = useState(() => items.map(isChecked));

  useInput((input, key) => {
    if (key.upArrow || input === 'k') setCursor(c => Math.max(0, c - 1));
    if (key.downArrow || input === 'j') {
      setCursor(c => Math.min(items.length - 1, c + 1));
    }
    if (multi && input === ' ') {
      setChecked(c => c.map((on, i) => (i === cursor ? !on : on)));
    }
    if (key.return) {
      const chosen = multi
        ? items.filter((_, i) => checked[i])
        : [items[cursor]];
      if (chosen.length > 0) onSubmit(chosen);
    }
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text>{title}</Text>
      {items.map((item, i) => (
        <Text key={i} color={i === cursor ? 'green' : undefined}>
          {i === cursor ? '▸ ' : '  '}
          {multi && (checked[i] ? '[x] ' : '[ ] ')}
          {label(item)}
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>
        {multi ? 'Space to toggle, Enter to continue' : 'Enter to select'}, Esc
        to cancel
      </Text>
    </Box>
  );
}
