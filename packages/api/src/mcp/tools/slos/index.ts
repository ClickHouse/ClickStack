import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerGetSlo } from './getSlo';

const slosTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerGetSlo(registrar);
};

export default slosTools;
