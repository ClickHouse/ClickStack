import { z } from 'zod/v3';

import { FilterSchema } from '@/types';

// An SLO follows OpenSLO v1 concepts in one flat document: an occurrence
// based indicator (good over eligible events), a target percentage and a
// rolling window. The eligible events keep the shape of a saved search
// (where clause, language, filters), so Search and the SLO count the same
// rows.

export const SLO_SCHEMA_VERSION = 1;

/** Guard rail on definitions per team. */
export const SLO_MAX_PER_TEAM = 200;

/** Groups tracked per SLO: the busiest by eligible events. */
export const SLO_MAX_GROUPS = 100;
/** Window events a group needs before it gets a state of its own. */
export const SLO_GROUP_MIN_EVENTS = 100;

export const SloWindowSchema = z.enum(['7d', '30d']);
export type SloWindow = z.infer<typeof SloWindowSchema>;

export const SloTemplateSchema = z.enum(['availability', 'latency']);
export type SloTemplate = z.infer<typeof SloTemplateSchema>;

export const SloEligibleSchema = z.object({
  where: z.string().max(10000),
  whereLanguage: z.enum(['lucene', 'sql']),
  filters: z.array(FilterSchema).max(50).optional(),
});

export const SloDurationUnitSchema = z.enum(['ns', 'us', 'ms', 's']);

export const SloLatencySchema = z.object({
  /** Column or expression holding the duration, e.g. Duration or LogAttributes['latency_ms']. */
  expression: z
    .string()
    .trim()
    .min(1, 'A duration expression is required')
    .max(1024),
  unit: SloDurationUnitSchema,
  thresholdMs: z.number().positive(),
  /** The expression is already numeric (a trace duration column); otherwise it is cast. */
  numeric: z.boolean().default(false),
  /** Leave out events without a readable duration instead of counting them as bad. */
  requireDuration: z.boolean().default(true),
});
export type SloLatency = z.infer<typeof SloLatencySchema>;

export const SloIndicatorSchema = z
  .object({
    template: SloTemplateSchema,
    eligible: SloEligibleSchema,
    /** SQL condition for good events; the latency template derives it instead. */
    good: z.string().trim().max(10000).optional(),
    latency: SloLatencySchema.optional(),
  })
  .superRefine((indicator, ctx) => {
    if (indicator.template === 'latency') {
      if (indicator.latency == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['latency'],
          message: 'A latency SLO needs a duration, unit and threshold',
        });
      }
    } else if (!indicator.good) {
      ctx.addIssue({
        code: 'custom',
        path: ['good'],
        message: 'A good-event condition is required',
      });
    }
  });
export type SloIndicator = z.infer<typeof SloIndicatorSchema>;

export const SloInputSchema = z.object({
  version: z.literal(SLO_SCHEMA_VERSION).default(SLO_SCHEMA_VERSION),
  name: z.string().trim().min(1, 'Name is required').max(256),
  description: z.string().max(4096).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
  source: z.string().min(1, 'Source is required'),
  indicator: SloIndicatorSchema,
  /** Percentage of good events, for example 99.9. */
  target: z
    .number()
    .gt(0, 'Target must be above 0%')
    .lt(100, 'Target must be below 100%'),
  /** Rolling window the target and the error budget apply to. */
  window: SloWindowSchema,
  /**
   * One expression whose values each get their own SLI, budget, state and
   * alert, for example ServiceName or SpanAttributes['http.route'].
   */
  groupBy: z.string().trim().max(512).nullish(),
});
export type SloInput = z.input<typeof SloInputSchema>;
export type SloDefinition = z.output<typeof SloInputSchema>;
