import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { getSloDefaultDuration } from '@hyperdx/common-utils/dist/core/sloLatency';
import {
  type SloInput,
  SloInputSchema,
  type SloLatency,
} from '@hyperdx/common-utils/dist/slo';
import type { TSource } from '@hyperdx/common-utils/dist/types';

/**
 * The builder edits the API input directly, so schema errors land on the
 * fields they belong to. The form keeps the good condition and the latency
 * settings side by side while the user switches templates; toSloInput keeps
 * the one the template uses.
 */
export type SloFormValues = Omit<SloInput, 'indicator'> & {
  indicator: Omit<SloInput['indicator'], 'good' | 'latency'> & {
    good: string;
    latency: Omit<SloLatency, 'numeric'>;
  };
};

const DEFAULT_LATENCY: SloFormValues['indicator']['latency'] = {
  expression: '',
  unit: 'ms',
  thresholdMs: 500,
  requireDuration: true,
};

export const DEFAULT_SLO_FORM_VALUES: SloFormValues = {
  name: '',
  description: '',
  tags: [],
  source: '',
  indicator: {
    template: 'availability',
    // SQL like the good condition, so both inputs read the same way.
    eligible: { where: '', whereLanguage: 'sql' },
    good: '',
    latency: DEFAULT_LATENCY,
  },
  target: 99.9,
  window: '30d',
};

/**
 * The source's duration column and its unit, when the expression is that
 * column. It needs no cast and its unit is the source's duration precision.
 * Any other expression is read as a number with a cast, which also works for
 * string attributes, in the unit the user picks.
 */
function getNativeDuration(expression: string, source: TSource | undefined) {
  const native = source ? getSloDefaultDuration(source) : undefined;
  return native != null && native.expression === expression.trim()
    ? native
    : undefined;
}

/** The latency settings as saved, with the unit of a native duration. */
function toSloLatency(
  latency: SloFormValues['indicator']['latency'],
  source: TSource | undefined,
): SloLatency {
  const native = getNativeDuration(latency.expression, source);
  return {
    ...latency,
    unit: native?.unit ?? latency.unit,
    numeric: native != null,
  };
}

/** The indicator as saved: the good condition or the latency settings. */
function toSloIndicator(
  indicator: SloFormValues['indicator'],
  source?: TSource,
): SloInput['indicator'] {
  const { good, latency, ...rest } = indicator;
  return rest.template === 'latency'
    ? { ...rest, latency: toSloLatency(latency, source) }
    : { ...rest, good };
}

export function toSloInput(values: SloFormValues, source?: TSource): SloInput {
  return {
    ...values,
    indicator: toSloIndicator(values.indicator, source),
  };
}

const sloInputResolver = zodResolver(SloInputSchema);

/** Validates what will be saved, not the fields the template leaves out. */
export const sloFormResolver: Resolver<SloFormValues> = async (
  values,
  context,
  { criteriaMode, fields, shouldUseNativeValidation },
) => {
  const { errors } = await sloInputResolver(toSloInput(values), context, {
    criteriaMode,
    fields,
    shouldUseNativeValidation,
  });
  // Submit the form's own values; toSloInput runs again with the source.
  return Object.keys(errors).length > 0
    ? { values: {}, errors }
    : { values, errors: {} };
};
