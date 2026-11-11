import { useMemo } from 'react';
import { Box, Button, Collapse, Group, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { simplifyPattern } from '@/components/Patterns/simplifyPattern';
import type { DenoiseSkipReason } from '@/hooks/useDenoisedRows';

function skipMessage(
  skipped: DenoiseSkipReason,
  bodyExpression: string | undefined,
) {
  switch (skipped) {
    case 'body_not_in_results':
      return `Add ${bodyExpression} to the table columns to denoise results.`;
    case 'no_body_expression':
      return 'This source has no body column, so results cannot be denoised.';
    case 'patterns_failed':
      return 'Could not load event patterns. Showing all results.';
  }
}

const percent = (count: number, total: number) =>
  `${Math.max(Math.round((count / total) * 100), 1)}%`;

export function DenoiseSummary({
  noisyPatterns,
  sampledRowCount,
  skipped,
  bodyExpression,
  isLoading,
}: {
  noisyPatterns: { pattern: string; count: number }[];
  sampledRowCount: number;
  skipped: DenoiseSkipReason | undefined;
  bodyExpression: string | undefined;
  isLoading: boolean;
}) {
  const [opened, { toggle }] = useDisclosure(false);

  // Patterns that read the same once simplified are shown once
  const lines = useMemo(() => {
    const byText = new Map<string, { full: string; count: number }>();
    for (const p of noisyPatterns) {
      const text = simplifyPattern(p.pattern);
      const line = byText.get(text);
      if (line) line.count += p.count;
      else byText.set(text, { full: p.pattern, count: p.count });
    }
    return [...byText.entries()]
      .map(([text, line]) => ({ text, ...line }))
      .sort((a, b) => b.count - a.count);
  }, [noisyPatterns]);

  const hiddenCount = noisyPatterns.reduce((sum, p) => sum + p.count, 0);

  let summary: string;
  if (skipped != null) {
    summary = skipMessage(skipped, bodyExpression);
  } else if (isLoading) {
    summary = 'Finding common patterns…';
  } else if (lines.length === 0) {
    summary = 'No common patterns to hide.';
  } else {
    summary =
      `Hiding ${lines.length} common ${lines.length === 1 ? 'pattern' : 'patterns'}, ` +
      `about ${percent(hiddenCount, sampledRowCount)} of events. ` +
      'Errors and warnings are never hidden.';
  }

  const canExpand = skipped == null && !isLoading && lines.length > 0;

  return (
    <Box mb="xxs" px="sm">
      <Group gap="xs" wrap="nowrap">
        <Text fz="xs" c="dimmed">
          {summary}
        </Text>
        {canExpand && (
          <Button variant="link" size="compact-xs" onClick={toggle}>
            {opened ? 'Hide patterns' : 'Show patterns'}
          </Button>
        )}
      </Group>
      {canExpand && (
        <Collapse expanded={opened}>
          <Stack gap={2} mt={4} mah={160} style={{ overflow: 'auto' }}>
            {lines.map(line => (
              <Group key={line.text} gap="xs" wrap="nowrap">
                <Text
                  fz="xs"
                  c="dimmed"
                  w={32}
                  ta="right"
                  style={{ flexShrink: 0 }}
                >
                  {percent(line.count, sampledRowCount)}
                </Text>
                <Text fz="xs" ff="monospace" truncate="end" title={line.full}>
                  {line.text}
                </Text>
              </Group>
            ))}
          </Stack>
        </Collapse>
      )}
    </Box>
  );
}
