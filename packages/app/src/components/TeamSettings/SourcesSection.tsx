import { Separator } from '@clickhouse/click-ui';
import { Box, Text } from '@mantine/core';

import { SourcesList } from '@/components/Sources/SourcesList';

export default function SourcesSection() {
  return (
    <Box id="sources" data-testid="sources-section">
      <Text size="md">Sources</Text>
      <Separator size="lg" />
      <SourcesList
        withBorder={false}
        variant="default"
        showEmptyState={false}
      />
    </Box>
  );
}
