import { type Control, type UseFormSetValue, useWatch } from 'react-hook-form';
import {
  describeSloAlertRule,
  describeSloAlertRuleDetails,
  getSloAlertRuleLabel,
  SLO_BURN_CONDITIONS,
  type SloAlertRule,
} from '@hyperdx/common-utils/dist/slo';
import { Switch } from '@mantine/core';

import { AlertChannelForm } from '@/components/Alerts';

import { newSloAlertTarget, type SloFormValues } from './sloForm';
import { SloFormRow } from './SloFormLayout';

/** One burn alert: its rule as the switch's label, and where it notifies. */
function SloAlertRuleFields({
  rule,
  control,
  setValue,
}: {
  rule: SloAlertRule;
  control: Control<SloFormValues>;
  setValue: UseFormSetValue<SloFormValues>;
}) {
  const target = useWatch({ control, name: `alerts.${rule}` });
  const sloWindow = useWatch({ control, name: 'window' });
  return (
    <>
      <SloFormRow
        label={getSloAlertRuleLabel(rule)}
        helpText={describeSloAlertRuleDetails(rule)}
        inline
      >
        <Switch
          label={`Notify when ${describeSloAlertRule(rule, sloWindow)}`}
          checked={target != null}
          onChange={e =>
            setValue(
              `alerts.${rule}`,
              e.currentTarget.checked ? newSloAlertTarget() : null,
              { shouldDirty: true },
            )
          }
          data-testid={`slo-alert-${rule}`}
        />
      </SloFormRow>
      {target != null && (
        <SloFormRow label="Send to">
          <AlertChannelForm
            control={control}
            channelsName={`alerts.${rule}.channels`}
          />
        </SloFormRow>
      )}
    </>
  );
}

/** The fast and slow burn alerts, each on its own with its own channels. */
export function SloAlertFields({
  control,
  setValue,
}: {
  control: Control<SloFormValues>;
  setValue: UseFormSetValue<SloFormValues>;
}) {
  return (
    <>
      {SLO_BURN_CONDITIONS.map(({ rule }) => (
        <SloAlertRuleFields
          key={rule}
          rule={rule}
          control={control}
          setValue={setValue}
        />
      ))}
    </>
  );
}
