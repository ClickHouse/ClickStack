import { ComponentProps, ComponentType, ReactNode } from 'react';
import {
  Control,
  UseFormGetValues,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import type { DBTimeChart } from '@/components/DBTimeChart';
import { alertUIExtension } from '@/extensions';
import { TILE_ALERT_INTERVAL_OPTIONS } from '@/utils/alerts';

type ChartEditorAlert = NonNullable<ChartEditorFormState['alert']>;

/** Pieces of the alert condition row an extension can supply.
 * @public For extension implementations. */
export type AlertConditionUI = {
  /** Above the condition row, e.g. a choice of detection mode. */
  header?: ReactNode;
  /** Replaces the threshold fields. */
  conditionFields?: ReactNode;
  /** Replaces "Trigger when the value". */
  conditionLabel?: ReactNode;
  /** Replaces "over" before the interval. */
  intervalLabel?: ReactNode;
  intervalOptions?: Partial<typeof TILE_ALERT_INTERVAL_OPTIONS>;
  /** Below the condition row. */
  footer?: ReactNode;
};

/** Changes to the alert preview on the chart editor's time chart.
 * @public For extension implementations. */
export type AlertTimeChartPreviewUI = {
  /** Replaces the previewed config, e.g. to change its window or buckets. */
  config?: ChartConfigWithDateRange;
  /** Hides the threshold reference lines. */
  hideThresholdLines?: boolean;
  timeChartProps?: Partial<ComponentProps<typeof DBTimeChart>>;
  /** Below the chart. */
  footer?: ReactNode;
};

/** Callbacks must keep their identity across renders: the editor's submit
 * and save callbacks depend on them. */
export type AlertChartEditorUI = {
  /** Return false to stop a save; show the reason to the user yourself. */
  beforeSave?: (form: ChartEditorFormState) => boolean;
  /** Applied to the alert of a saved builder chart. */
  normalizeAlert?: <T>(alert: T) => T;
};

/**
 * Optional UI for alert detection strategies other than a static threshold.
 * Supplied by `@/extensions`; without one, alerts edit and preview as
 * thresholds. The hooks are called on every render of their component.
 */
export type AlertUIExtension = {
  /** Wraps the chart editor, e.g. to share state between the hooks below. */
  Provider?: ComponentType<{ children: ReactNode }>;
  useChartEditor?: (form: {
    watch: UseFormWatch<ChartEditorFormState>;
    getValues: UseFormGetValues<ChartEditorFormState>;
    setValue: UseFormSetValue<ChartEditorFormState>;
  }) => AlertChartEditorUI;
  useConditionEditor?: (args: {
    control: Control<ChartEditorFormState>;
    setValue: UseFormSetValue<ChartEditorFormState>;
    alert: ChartEditorAlert;
  }) => AlertConditionUI;
  useTimeChartPreview?: (args: {
    alert: ChartEditorFormState['alert'];
    config: ChartConfigWithDateRange | undefined;
    enabled: boolean;
  }) => AlertTimeChartPreviewUI;
};

const useNone = () => ({});
const allowSave = () => true;
const keepAlert = <T,>(alert: T) => alert;

// Resolved once: `@/extensions` is static, so each hook is the same function
// on every render.
const useChartEditorExtension: NonNullable<AlertUIExtension['useChartEditor']> =
  alertUIExtension?.useChartEditor ?? useNone;

export function useAlertChartEditorUI(
  form: Parameters<typeof useChartEditorExtension>[0],
): Required<AlertChartEditorUI> {
  const ui = useChartEditorExtension(form);
  return {
    beforeSave: ui.beforeSave ?? allowSave,
    normalizeAlert: ui.normalizeAlert ?? keepAlert,
  };
}
export const useAlertConditionUI: NonNullable<
  AlertUIExtension['useConditionEditor']
> = alertUIExtension?.useConditionEditor ?? useNone;
export const useAlertTimeChartPreviewUI: NonNullable<
  AlertUIExtension['useTimeChartPreview']
> = alertUIExtension?.useTimeChartPreview ?? useNone;

/** Wraps a component in the extension's Provider, if it has one. */
export function withAlertUIProvider<P extends object>(
  Component: ComponentType<P>,
): ComponentType<P> {
  const MaybeProvider = alertUIExtension?.Provider;
  if (MaybeProvider == null) {
    return Component;
  }
  // Narrowing doesn't reach into the hoisted function below.
  const Provider = MaybeProvider;
  function WithAlertUIProvider(props: P) {
    return (
      <Provider>
        <Component {...props} />
      </Provider>
    );
  }
  WithAlertUIProvider.displayName = `withAlertUIProvider(${
    Component.displayName ?? Component.name
  })`;
  return WithAlertUIProvider;
}
