import { Box, Text } from '@mantine/core';

import type { DenoiseSkipReason } from '@/hooks/useDenoisedRows';
import type { Pattern } from '@/hooks/usePatterns';

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

export function DenoiseSummary({
  noisyPatterns,
  skipped,
  bodyExpression,
}: {
  noisyPatterns: Pick<Pattern, 'id' | 'pattern'>[];
  skipped: DenoiseSkipReason | undefined;
  bodyExpression: string | undefined;
}) {
  return (
    <Box mb="xxs" px="sm">
      <Text fw="bold" fz="xs" mb="xxs">
        Removed noisy event patterns
      </Text>
      <Box mah={100} style={{ overflow: 'auto' }}>
        {skipped != null ? (
          <Text fz="xs">{skipMessage(skipped, bodyExpression)}</Text>
        ) : noisyPatterns.length === 0 ? (
          <Text fz="xs">No noisy patterns found</Text>
        ) : (
          noisyPatterns.map(p => (
            <Text fz="xs" key={p.id}>
              {p.pattern}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
