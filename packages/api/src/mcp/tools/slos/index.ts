import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerDeleteSlo } from './deleteSlo';
import { registerGetSlo } from './getSlo';
import { registerPreviewSlo } from './previewSlo';
import { registerSaveSlo } from './saveSlo';

const slosTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerGetSlo(registrar);
  registerPreviewSlo(registrar);
  registerSaveSlo(registrar);
  registerDeleteSlo(registrar);
};

export default slosTools;
