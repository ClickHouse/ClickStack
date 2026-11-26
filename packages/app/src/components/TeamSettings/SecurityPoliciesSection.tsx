import { Box, Card, Text } from '@mantine/core';

export default function SecurityPoliciesSection({
  allowedAuthMethods,
}: {
  allowedAuthMethods: string[];
}) {
  return (
    <Box id="security-policies">
      <Card>
        <Text size="sm" c="dimmed">
          Team members can only authenticate via{' '}
          <span className="text-capitalize fw-bold">
            {allowedAuthMethods.join(', ')}
          </span>
        </Text>
      </Card>
    </Box>
  );
}
