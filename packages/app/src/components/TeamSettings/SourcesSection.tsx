import { Box } from '@mantine/core';

import { SourcesList } from '@/components/Sources/SourcesList';

export default function SourcesSection() {
  return (
    <Box id="sources" data-testid="sources-section">
      <SourcesList
        withBorder={false}
        variant="default"
        showEmptyState={false}
      />
    </Box>
  );
}
