import { Box, Card, Stack } from '@mantine/core';

import WebhooksSection from './WebhooksSection';

export default function IntegrationsSection() {
  return (
    <Box id="integrations" data-testid="integrations-section">
      <Card>
        <Stack gap="md">
          <WebhooksSection />
        </Stack>
      </Card>
    </Box>
  );
}
