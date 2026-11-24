import type { SloLatency } from '@/slo';
import { Filter, isTraceSource, TSource } from '@/types';

type SloDurationUnit = SloLatency['unit'];

function unitsPerMs(unit: SloDurationUnit): number {
  switch (unit) {
    case 'ns':
      return 1_000_000;
    case 'us':
      return 1_000;
    case 'ms':
      return 1;
    case 's':
      return 0.001;
  }
}

/** Trace sources store the precision as digits after seconds: 3 is ms, 9 is ns. */
function unitFromPrecision(precision: number): SloDurationUnit {
  if (precision >= 9) return 'ns';
  if (precision >= 6) return 'us';
  if (precision >= 3) return 'ms';
  return 's';
}

/**
 * The duration as a number. A string attribute (every Map value in the OTel
 * schema) is cast, and anything that does not parse becomes NULL.
 */
export function getSloDurationValueExpression(latency: SloLatency): string {
  return latency.numeric
    ? `(${latency.expression})`
    : `accurateCastOrNull(${latency.expression}, 'Float64')`;
}

export function buildSloLatencyGoodSql(latency: SloLatency): string {
  const threshold = Number(
    (latency.thresholdMs * unitsPerMs(latency.unit)).toPrecision(12),
  );
  return `${getSloDurationValueExpression(latency)} <= ${threshold}`;
}

/**
 * Eligibility guard for a cast duration: events that lack it, such as log
 * lines without the attribute, stay out of the SLO rather than burning budget.
 */
export function getSloLatencyEligibleFilter(
  latency: SloLatency,
): Filter | undefined {
  if (latency.numeric || !latency.requireDuration) return undefined;
  return {
    type: 'sql',
    condition: `isNotNull(${getSloDurationValueExpression(latency)})`,
  };
}

/** The source's own duration column, when it has one (trace sources). */
export function getSloDefaultDuration(
  source: TSource,
): Pick<SloLatency, 'expression' | 'unit' | 'numeric'> | undefined {
  if (!isTraceSource(source) || !source.durationExpression) return undefined;
  return {
    expression: source.durationExpression,
    unit: unitFromPrecision(source.durationPrecision ?? 3),
    numeric: true,
  };
}
