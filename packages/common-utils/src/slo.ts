import { z } from 'zod/v3';

import { AlertInterval, FilterSchema } from '@/types';

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

export type SloBurnWindow = '5m' | '30m' | '1h' | '6h';

/** The burn checks an SLO can alert on, each an alert of its own. */
export const SloAlertRuleSchema = z.enum(['fastBurn', 'slowBurn']);
export type SloAlertRule = z.infer<typeof SloAlertRuleSchema>;

export type SloBurnCondition = {
  /** The alert that fires on this condition. */
  rule: SloAlertRule;
  /** The long window, in which the share of the budget burns. */
  window: SloBurnWindow;
  /** A twelfth of the long window, which has to burn as fast: still going. */
  shortWindow: SloBurnWindow;
  /** Share of the SLO window's error budget spent within the long window. */
  budgetSpent: number;
  /** Long-window events needed before the condition can hold. */
  minEvents: number;
};

/**
 * The fast and slow burn checks, the multiwindow burn-rate alerts of the
 * SRE Workbook (https://sre.google/workbook/alerting-on-slos/). An SLO is
 * burning when either holds, and each can be an alert with its own
 * channels. The burn rate threshold follows from the SLO window, so a 7d SLO
 * alerts on the same share of its budget as a 30d SLO. The short window lets
 * an alert resolve soon after a burn stops instead of when the long window
 * forgets it.
 */
export const SLO_BURN_CONDITIONS = [
  {
    rule: 'fastBurn',
    window: '1h',
    shortWindow: '5m',
    budgetSpent: 0.02,
    minEvents: 20,
  },
  {
    rule: 'slowBurn',
    window: '6h',
    shortWindow: '30m',
    budgetSpent: 0.05,
    minEvents: 100,
  },
] as const satisfies readonly SloBurnCondition[];

export function getSloBurnCondition(rule: SloAlertRule): SloBurnCondition {
  return rule === 'slowBurn' ? SLO_BURN_CONDITIONS[1] : SLO_BURN_CONDITIONS[0];
}

/** How often a burn alert is checked: about its short window. */
export function getSloAlertInterval(rule: SloAlertRule): AlertInterval {
  return rule === 'slowBurn' ? '15m' : '5m';
}

export function getSloAlertRuleLabel(rule: SloAlertRule): string {
  return rule === 'slowBurn' ? 'Slow burn' : 'Fast burn';
}

/** "1 hour", "30 minutes": a burn window in a sentence. */
export function formatSloBurnWindow(window: SloBurnWindow): string {
  switch (window) {
    case '5m':
      return '5 minutes';
    case '30m':
      return '30 minutes';
    case '1h':
      return '1 hour';
    case '6h':
      return '6 hours';
  }
}

/** "the last hour", "the last 5 minutes": a burn window ending now. */
export function describeSloLastWindow(window: SloBurnWindow): string {
  return window === '1h'
    ? 'the last hour'
    : `the last ${formatSloBurnWindow(window)}`;
}

/** "30-day": the SLO window as an adjective. */
export function formatSloWindowAdjective(window: SloWindow): string {
  return window === '7d' ? '7-day' : '30-day';
}

/**
 * When a burn alert fires: "2% of the 30-day error budget is spent within 1
 * hour (14.4x the allowed rate)", or the share alone without a window.
 */
export function describeSloAlertRule(
  rule: SloAlertRule,
  window?: SloWindow,
): string {
  const condition = getSloBurnCondition(rule);
  const share = `${Math.round(condition.budgetSpent * 100)}%`;
  const within = formatSloBurnWindow(condition.window);
  return window
    ? `${share} of the ${formatSloWindowAdjective(window)} error budget ` +
        `is spent within ${within} ` +
        `(${getSloBurnThreshold(condition, window)}x the allowed rate)`
    : `${share} of the error budget is spent within ${within}`;
}

/** The rest of a burn alert's rule: when it resolves, its minimum, its cadence. */
export function describeSloAlertRuleDetails(rule: SloAlertRule): string {
  const { shortWindow, minEvents, window } = getSloBurnCondition(rule);
  const minutes = getSloAlertInterval(rule) === '15m' ? 15 : 5;
  return (
    `Resolves once the last ${formatSloBurnWindow(shortWindow)} burn slower ` +
    `than that. Needs at least ${minEvents} events in ` +
    `${formatSloBurnWindow(window)}. Checked every ${minutes} minutes.`
  );
}

const HOUR_MS = 60 * 60 * 1000;

export function getSloWindowMs(window: SloWindow): number {
  return (window === '7d' ? 7 : 30) * 24 * HOUR_MS;
}

export function getSloBurnWindowMs(window: SloBurnWindow): number {
  switch (window) {
    case '5m':
      return HOUR_MS / 12;
    case '30m':
      return HOUR_MS / 2;
    case '1h':
      return HOUR_MS;
    case '6h':
      return 6 * HOUR_MS;
  }
}

/** The burn rate at which a condition spends its share of the budget. */
export function getSloBurnThreshold(
  condition: Pick<SloBurnCondition, 'window' | 'budgetSpent'>,
  window: SloWindow,
): number {
  const ratio = getSloWindowMs(window) / getSloBurnWindowMs(condition.window);
  return Math.round(condition.budgetSpent * ratio * 100) / 100;
}

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
