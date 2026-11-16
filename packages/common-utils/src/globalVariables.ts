import { MacroExpansionError } from './macroErrors';
import { RawSqlQueryParam, renderQueryParam } from './rawSqlParams';
import { ChartVariable, VariableFilterValue } from './types';
import { scanTemplateTokens } from './variables';

/**
 * Grafana-compatible global variables (`$__from`, `${__from:date:iso}`,
 * `$__range`, `${__timezone}`, `${__url_time_range}`, `${__all_variables}`),
 * shared by raw SQL templates and link templates.
 */
export type GlobalVariableContext = {
  dateRange?: [Date, Date];
  /** IANA zone the user views times in. Defaults to UTC, e.g. for alerts. */
  timeZone?: string;
  variables?: ChartVariable[];
};

type GlobalVariable = {
  name: string;
  minArgs: number;
  maxArgs: number;
  description: string;
  expand: (ctx: GlobalVariableContext, args: string[]) => string;
};

const TIME_FORMATS = ['date', 'date:iso', 'date:seconds'];

// shortcut: no custom moment.js formats (${__from:date:YYYY-MM}), add a token translation if users need them.
function formatTime(
  name: 'from' | 'to',
  ms: number | undefined,
  format: string | undefined,
): string {
  if (format != null && !TIME_FORMATS.includes(format)) {
    throw new MacroExpansionError(
      name,
      `Unsupported format '${format}' in '\${__${name}:${format}}'. Expected one of: ${TIME_FORMATS.join(', ')}.`,
    );
  }
  // Without a date range (saved-config validation) the query param stands in,
  // so the time-range checks still see the template uses the range.
  if (ms == null) {
    return renderQueryParam(
      name === 'from'
        ? RawSqlQueryParam.startDateMilliseconds
        : RawSqlQueryParam.endDateMilliseconds,
    );
  }
  if (format === 'date:seconds') return String(Math.floor(ms / 1000));
  if (format != null) return new Date(ms).toISOString();
  return String(ms);
}

const rangeMs = ({ dateRange }: GlobalVariableContext) =>
  dateRange ? dateRange[1].getTime() - dateRange[0].getTime() : 0;

// IANA names only, since the value is interpolated into SQL and URLs as written.
const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;

// encodeURIComponent leaves `'` alone, which would end a SQL string literal.
const encodeUrlValue = (value: string) =>
  encodeURIComponent(value).replace(/'/g, '%27');

export const GLOBAL_VARIABLES = [
  {
    name: 'from',
    minArgs: 0,
    maxArgs: 1,
    description:
      'Start of the selected time range in epoch milliseconds. ${__from:date} or ${__from:date:iso} gives ISO 8601, ${__from:date:seconds} gives epoch seconds.',
    expand: (ctx, args) =>
      formatTime('from', ctx.dateRange?.[0].getTime(), args[0]),
  },
  {
    name: 'to',
    minArgs: 0,
    maxArgs: 1,
    description:
      'End of the selected time range in epoch milliseconds. ${__to:date} or ${__to:date:iso} gives ISO 8601, ${__to:date:seconds} gives epoch seconds.',
    expand: (ctx, args) =>
      formatTime('to', ctx.dateRange?.[1].getTime(), args[0]),
  },
  {
    name: 'range',
    minArgs: 0,
    maxArgs: 0,
    description:
      'Length of the selected time range as a duration in seconds, such as 3600s.',
    expand: ctx => `${Math.round(rangeMs(ctx) / 1000)}s`,
  },
  {
    name: 'range_s',
    minArgs: 0,
    maxArgs: 0,
    description: 'Length of the selected time range, in seconds.',
    expand: ctx => String(Math.round(rangeMs(ctx) / 1000)),
  },
  {
    name: 'range_ms',
    minArgs: 0,
    maxArgs: 0,
    description: 'Length of the selected time range, in milliseconds.',
    expand: ctx => String(rangeMs(ctx)),
  },
  {
    name: 'timezone',
    minArgs: 0,
    maxArgs: 0,
    description:
      "The time zone times are shown in, such as America/New_York. Use it quoted, e.g. toTimeZone(ts, '${__timezone}').",
    expand: ({ timeZone = 'UTC' }) => {
      if (!TIME_ZONE_PATTERN.test(timeZone)) {
        throw new MacroExpansionError(
          'timezone',
          `Invalid time zone '${timeZone}'.`,
        );
      }
      return timeZone;
    },
  },
  {
    name: 'url_time_range',
    minArgs: 0,
    maxArgs: 0,
    description:
      'The selected time range as URL query params: from=<epoch ms>&to=<epoch ms>.',
    expand: ({ dateRange }) =>
      dateRange
        ? `from=${dateRange[0].getTime()}&to=${dateRange[1].getTime()}`
        : '',
  },
  {
    name: 'all_variables',
    minArgs: 0,
    maxArgs: 0,
    description:
      "Every dashboard variable's selection as a filters=<...> URL query param, so a link to another dashboard carries them.",
    expand: ({ variables = [] }) => {
      const entries: VariableFilterValue[] = variables
        .filter(({ values }) => values.length > 0)
        .map(({ name, values }) => ({ type: 'variable', name, values }));
      return `filters=${encodeUrlValue(JSON.stringify(entries))}`;
    },
  },
] as const satisfies readonly GlobalVariable[];

export type GlobalVariableName = (typeof GLOBAL_VARIABLES)[number]['name'];

export const GLOBAL_VARIABLE_NAMES: readonly GlobalVariableName[] =
  GLOBAL_VARIABLES.map(({ name }) => name);

const GLOBAL_VARIABLES_BY_NAME = new Map<string, GlobalVariable>(
  GLOBAL_VARIABLES.map(variable => [variable.name, variable]),
);

/** Expand one global variable. `args` holds the format, as in `${__from:date:iso}`. */
export function expandGlobalVariable(
  name: GlobalVariableName,
  ctx: GlobalVariableContext,
  args: string[],
): string {
  const variable = GLOBAL_VARIABLES_BY_NAME.get(name)!;
  if (args.length > variable.maxArgs) {
    throw new MacroExpansionError(
      name,
      `'$__${name}' takes ${variable.maxArgs === 0 ? 'no format' : 'at most one format'}, but got '${args.join(', ')}'.`,
    );
  }
  return variable.expand(ctx, args);
}

const isGlobalVariableName = (name: string): name is GlobalVariableName =>
  GLOBAL_VARIABLES_BY_NAME.has(name);

/**
 * Expand the global variables in a link template, leaving everything else
 * (Handlebars, `$name` references) as written. Values are URL-safe, so they
 * can't introduce Handlebars syntax.
 */
export function expandLinkGlobalVariables(
  template: string,
  ctx: GlobalVariableContext,
  { encodeValues = false }: { encodeValues?: boolean } = {},
): string {
  return scanTemplateTokens(template, GLOBAL_VARIABLE_NAMES, {
    onMalformed: 'skip',
    // A URL's `#fragment` isn't a SQL comment.
    skipSqlComments: false,
  })
    .map(token => {
      if (token.kind === 'text') return token.text;
      if (token.kind !== 'macro' || !isGlobalVariableName(token.name)) {
        return token.raw;
      }
      const value = expandGlobalVariable(token.name, ctx, token.args);
      // `Etc/GMT+5` would read back as a space in a query string.
      return encodeValues && token.name === 'timezone'
        ? encodeUrlValue(value)
        : value;
    })
    .join('');
}
