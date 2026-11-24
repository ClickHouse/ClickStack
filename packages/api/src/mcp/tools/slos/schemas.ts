import { SloInputSchema } from '@hyperdx/common-utils/dist/slo';
import { z } from 'zod/v3';

/** How an SLO is written, for the save and preview tool descriptions. */
const SLO_DEFINITION_GUIDE =
  'Fields: name; description; tags (strings); source (ID of a log or trace ' +
  'source, from clickstack_list_sources); indicator { template: ' +
  '"availability" | "latency"; eligible { where, whereLanguage: "sql" | ' +
  '"lucene" } (the events that count; an empty where counts every event ' +
  'in the source); good (availability only: the SQL condition a good event ' +
  "matches, e.g. StatusCode != 'Error'; NULL counts as bad); latency " +
  '(latency only: { expression (the duration column or expression, e.g. ' +
  'Duration), unit: "ns" | "us" | "ms" | "s", thresholdMs (events at or ' +
  'under it are good), numeric (true for a numeric duration column; ' +
  'otherwise the value is cast), requireDuration (default true: events ' +
  'without a duration are left out; false counts them as bad) }) }; ' +
  'target (percentage of good events, e.g. 99.9); window ("7d" or "30d", ' +
  'rolling); groupBy (optional SQL expression such as ServiceName: each ' +
  'value gets its own SLI, error budget and alerts, and the 100 values with ' +
  'the most events are tracked); alerts (optional { fastBurn, slowBurn }, ' +
  'each null for off or { channels: [{ type: "webhook", webhookId }] } ' +
  'with webhook IDs from clickstack_get_webhook: fastBurn notifies when 2% ' +
  'of the error budget is spent within 1 hour, slowBurn when 5% is spent ' +
  'within 6 hours; each notifies once when it starts and once when it ' +
  'resolves).';

// Items stay loose: the MCP SDK validates the whole call before the handler
// runs, so a strict schema would reject the batch instead of saying which
// items failed. The handlers parse each definition with SloInputSchema.
const definitionSchema = z.record(z.string(), z.unknown());

export const mcpSaveSloSchema = z.object({
  slos: z
    .array(
      definitionSchema.describe(
        'One SLO. Include "id" to update that SLO (the definition is ' +
          'replaced, not merged), omit it to create one. ' +
          SLO_DEFINITION_GUIDE,
      ),
    )
    .min(1)
    .max(20)
    .describe(
      'Between 1 and 20 SLOs, each validated and saved on its own, so one ' +
        'failing item does not block the others.',
    ),
});

export const mcpPreviewSloSchema = z.object({
  definition: definitionSchema.describe(
    'The SLO to preview, as for clickstack_save_slo; name and alerts are ' +
      `not needed. ${SLO_DEFINITION_GUIDE}`,
  ),
});

/** A definition to preview: no name needed, and the alerts play no part. */
export const SloPreviewDefinitionSchema = SloInputSchema.omit({
  alerts: true,
}).extend({ name: z.string().max(256).optional() });
