import { useEffect } from 'react';
import { Stack } from '@mantine/core';

import SelectControlled from '@/components/SelectControlled';
import { PROMQL_TIMESTAMP_EXPRESSION } from '@/source';

import { PROMQL_BACKEND_OPTIONS } from './constants';
import { FormRow } from './FormRow';
import { MinAutoGranularityFormRow } from './MinAutoGranularityFormRow';
import { TableModelProps } from './types';

const PROMQL_MIN_AUTO_GRANULARITY_HELP_TEXT =
  "Floor for 'auto granularity' on charts querying this source. Set this to your metrics' scrape interval to avoid sparse-looking charts on short time ranges. Doesn't affect an explicitly chosen (non-auto) granularity. $__rate_interval is also sized from it, assuming a 15 second scrape interval when no minimum is set.";

const PROMQL_BACKEND_HELP_TEXT =
  'How ClickHouse evaluates queries on this source. Auto uses the Prometheus HTTP API when the server serves it (ClickHouse 26.6+ with the prometheus_api_v1 handler configured) and the prometheusQuery table functions otherwise, and re-checks every few minutes. Pick one to skip that check.';

export function PromqlTableModelForm({
  control,
  setValue,
  isPrometheusEndpoint,
}: TableModelProps) {
  useEffect(() => {
    setValue('timestampValueExpression', PROMQL_TIMESTAMP_EXPRESSION);
  }, [setValue]);

  // PromQL sources use the standard database + table fields from BaseSourceSchema.
  // The table should point to the TimeSeries engine table.
  return (
    <Stack gap="sm">
      {/* A Prometheus endpoint is always queried through its own API. */}
      {!isPrometheusEndpoint && (
        <FormRow label="PromQL backend" helpText={PROMQL_BACKEND_HELP_TEXT}>
          <SelectControlled
            control={control}
            name="promqlBackend"
            data={PROMQL_BACKEND_OPTIONS}
            allowDeselect={false}
            // Unset on an existing source, which is not one of the options.
            placeholder="Auto (detect from server)"
            data-testid="promql-backend-select"
          />
        </FormRow>
      )}
      <MinAutoGranularityFormRow
        control={control}
        helpText={PROMQL_MIN_AUTO_GRANULARITY_HELP_TEXT}
      />
    </Stack>
  );
}
