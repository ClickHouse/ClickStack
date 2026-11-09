import { Separator } from '@clickhouse/click-ui';
import { Box, Card, Stack, Text } from '@mantine/core';

import WebhooksSection from './WebhooksSection';

export default function IntegrationsSection() {
  return (
    <Box id="integrations" data-testid="integrations-section">
      <Text size="md">Integrations</Text>
      <Separator size="lg" />
      <Card>
        <Stack gap="md">
          <WebhooksSection />
        </Stack>
      </Card>
    </Box>
  );
}
