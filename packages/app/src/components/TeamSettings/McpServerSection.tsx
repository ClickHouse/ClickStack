import { useMemo } from 'react';
import { Box, Card } from '@mantine/core';

import api from '@/api';
import { type DeploymentShape } from '@/components/ClickStackOnboarding/installSnippets';
import McpInstallPanel from '@/components/ClickStackOnboarding/McpInstallPanel';

/**
 * MCP install snippet for the AI agents settings page. Self-managed deployments
 * mount the server at `<origin>/api/mcp` with the user's access key as bearer,
 * and the server resolves the team from that token.
 */
export default function McpServerSection() {
  const { data: me, isLoading: isLoadingMe } = api.useMe();

  const deployment = useMemo<DeploymentShape | null>(() => {
    if (!me?.accessKey) return null;
    return {
      apiUrl: `${window.location.origin}/api`,
      accessKey: me.accessKey,
    };
  }, [me]);

  if (isLoadingMe || !deployment) {
    return null;
  }

  return (
    <Box id="mcp_server" data-testid="mcp-server-section">
      <Card>
        <McpInstallPanel deployment={deployment} />
      </Card>
    </Box>
  );
}
