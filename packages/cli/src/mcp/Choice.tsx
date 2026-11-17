import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

/** Arrow-key checklist. Space toggles items and Enter submits the ticked ones. */
export default function Choice<T>({
  title,
  items,
  label,
  initial = 0,
  isChecked = () => true,
  onSubmit,
  onCancel,
}: {
  title: string;
  items: T[];
  label: (item: T) => string;
  initial?: number;
  /** Which items start ticked. Defaults to all. */
  isChecked?: (item: T) => boolean;
  onSubmit: (chosen: T[]) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(initial);
  const [checked, setChecked] = useState(() => items.map(isChecked));
  const [noneTicked, setNoneTicked] = useState(false);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') setCursor(c => Math.max(0, c - 1));
    if (key.downArrow || input === 'j') {
      setCursor(c => Math.min(items.length - 1, c + 1));
    }
    if (input === ' ') {
      setNoneTicked(false);
      setChecked(c => c.map((on, i) => (i === cursor ? !on : on)));
    }
    if (key.return) {
      const chosen = items.filter((_, i) => checked[i]);
      if (chosen.length > 0) onSubmit(chosen);
      else setNoneTicked(true);
    }
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text>{title}</Text>
      {items.map((item, i) => (
        <Text key={i} color={i === cursor ? 'green' : undefined}>
          {i === cursor ? '▸ ' : '  '}
          {checked[i] ? '[x] ' : '[ ] '}
          {label(item)}
        </Text>
      ))}
      <Text> </Text>
      {noneTicked && <Text color="yellow">Select at least one.</Text>}
      <Text dimColor>Space to toggle, Enter to continue, Esc to cancel</Text>
    </Box>
  );
}
