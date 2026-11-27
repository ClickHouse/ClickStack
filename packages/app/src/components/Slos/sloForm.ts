import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  buildSloCountsChartConfig,
  buildSloGroupCountChartConfig,
  buildSloSourceTotalChartConfig,
  getSloWindowRange,
} from '@hyperdx/common-utils/dist/core/slo';
import { getSloDefaultDuration } from '@hyperdx/common-utils/dist/core/sloLatency';
import {
  type SloAlertTarget,
  type SloApiResponse,
  SloIndicatorSchema,
  type SloInput,
  SloInputSchema,
  type SloLatency,
} from '@hyperdx/common-utils/dist/slo';
import type {
  BuilderChartConfigWithDateRange,
  Filter,
  TSource,
} from '@hyperdx/common-utils/dist/types';

/**
 * The builder edits the API input directly, so schema errors land on the
 * fields they belong to. The form keeps the good condition and the latency
 * settings side by side while the user switches templates; toSloInput keeps
 * the one the template uses. An empty group-by means none.
 */
export type SloFormValues = Omit<SloInput, 'indicator' | 'groupBy'> & {
  indicator: Omit<SloInput['indicator'], 'good' | 'latency'> & {
    good: string;
    latency: Omit<SloLatency, 'numeric'>;
  };
  groupBy: string;
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
    eligible: { where: '', whereLanguage: 'sql', filters: [] },
    good: '',
    latency: DEFAULT_LATENCY,
  },
  groupBy: '',
  target: 99.9,
  window: '30d',
  // Off until the user turns one on and picks where it notifies.
  alerts: { fastBurn: null, slowBurn: null },
};

/** A burn alert that is turned on starts with one empty channel to fill in. */
export function newSloAlertTarget(): SloAlertTarget {
  return { channels: [{ type: 'webhook', webhookId: '' }] };
}

export function sloToFormValues(slo: SloApiResponse): SloFormValues {
  const { template, eligible, good, latency } = slo.indicator;
  return {
    name: slo.name,
    description: slo.description ?? '',
    tags: slo.tags,
    source: slo.source,
    indicator: {
      template,
      eligible: { ...eligible, filters: eligible.filters ?? [] },
      good: good ?? '',
      latency: latency ?? DEFAULT_LATENCY,
    },
    groupBy: slo.groupBy ?? '',
    target: slo.target,
    window: slo.window,
    alerts: {
      fastBurn: slo.alerts.fastBurn ?? null,
      slowBurn: slo.alerts.slowBurn ?? null,
    },
  };
}

/** A copy of an SLO, named as such, without its alerts. */
export function sloCopyFormValues(slo: SloApiResponse): SloFormValues {
  return {
    ...sloToFormValues(slo),
    name: `Copy of ${slo.name}`.slice(0, 256),
    alerts: DEFAULT_SLO_FORM_VALUES.alerts,
  };
}

/** A search carried over by "Create SLO from this search". */
export type SloSearchPrefill = {
  source: string;
  name?: string | null;
  where?: string | null;
  whereLanguage?: string | null;
  filters?: Filter[] | null;
};

/** A new SLO counting the events of a search. */
export function sloFormValuesFromSearch(
  prefill: SloSearchPrefill,
): SloFormValues {
  return {
    ...DEFAULT_SLO_FORM_VALUES,
    name: prefill.name ?? '',
    source: prefill.source,
    indicator: {
      ...DEFAULT_SLO_FORM_VALUES.indicator,
      eligible: {
        where: prefill.where ?? '',
        whereLanguage: prefill.whereLanguage === 'lucene' ? 'lucene' : 'sql',
        filters: prefill.filters ?? [],
      },
    },
  };
}

/**
 * The source's duration column and its unit, when the expression is that
 * column. It needs no cast and its unit is the source's duration precision.
 * Any other expression is read as a number with a cast, which also works for
 * string attributes, in the unit the user picks.
 */
export function getNativeDuration(
  expression: string,
  source: TSource | undefined,
) {
  const native = source ? getSloDefaultDuration(source) : undefined;
  return native != null && native.expression === expression.trim()
    ? native
    : undefined;
}

/** The latency settings as saved, with the unit of a native duration. */
export function toSloLatency(
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
    groupBy: values.groupBy.trim() || null,
  };
}

export type SloPreviewRequest = {
  /** What the counts depend on; another key means the preview is stale. */
  key: string;
  counts: BuilderChartConfigWithDateRange;
  total: BuilderChartConfigWithDateRange;
  /** With a group-by: how many groups the window has. */
  groups?: BuilderChartConfigWithDateRange;
};

/** What a preview's counts depend on. The target only changes the math. */
export function getSloPreviewKey(
  values: Pick<SloFormValues, 'source' | 'indicator' | 'window' | 'groupBy'>,
  source?: TSource,
): string {
  return JSON.stringify([
    values.source,
    values.window,
    toSloIndicator(values.indicator, source),
    values.groupBy.trim(),
  ]);
}

/** The preview's queries, over the SLO window that ends at `nowMs`. */
export function buildSloPreviewRequest(
  values: SloFormValues,
  source: TSource,
  nowMs: number,
): SloPreviewRequest | undefined {
  const indicator = SloIndicatorSchema.safeParse(
    toSloIndicator(values.indicator, source),
  );
  if (!indicator.success) return undefined;
  const dateRange = getSloWindowRange(values.window, new Date(nowMs));
  const groupBy = values.groupBy.trim();
  return {
    key: getSloPreviewKey(values, source),
    counts: buildSloCountsChartConfig({
      slo: { indicator: indicator.data },
      source,
      dateRange,
    }),
    total: buildSloSourceTotalChartConfig({ source, dateRange }),
    ...(groupBy
      ? {
          groups: buildSloGroupCountChartConfig({
            slo: { indicator: indicator.data, groupBy },
            source,
            dateRange,
          }),
        }
      : {}),
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
