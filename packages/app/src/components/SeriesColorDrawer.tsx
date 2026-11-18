import { useCallback, useEffect, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  type ChartPaletteToken,
  type ColorCondition,
  type SeriesLineStyle,
  SeriesLineStyleSchema,
} from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Drawer,
  Group,
  Input,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';

import {
  attachLocalIds,
  ColorRulesEditor,
  ColorRuleWithId,
  stripLocalIds,
} from './ColorRulesEditor';
import { ColorSwatchInput } from './ColorSwatchInput';

/**
 * What the drawer edits: a table column (color + conditional rules), a line
 * series (color + line style), or a bar series (color only).
 */
export type SeriesStyleMode = 'column' | 'line' | 'bar';

const MODE_COPY: Record<
  SeriesStyleMode,
  { title: string; colorLabel: string; colorHint: string }
> = {
  column: {
    title: 'Column color',
    colorLabel: 'Column color',
    colorHint:
      'Applies to every cell in this column unless a rule below matches.',
  },
  line: {
    title: 'Series style',
    colorLabel: 'Series color',
    colorHint: 'Applies to this series on the chart and in the legend.',
  },
  bar: {
    title: 'Series color',
    colorLabel: 'Series color',
    colorHint: 'Applies to this series on the chart and in the legend.',
  },
};

const LINE_STYLE_OPTIONS: { label: string; value: SeriesLineStyle }[] = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
];

type StyleFormState = {
  color?: ChartPaletteToken;
  colorRules?: ColorRuleWithId[];
  lineStyle?: SeriesLineStyle;
};

type SeriesStyle = {
  color?: ChartPaletteToken;
  colorRules?: ColorCondition[];
  lineStyle?: SeriesLineStyle;
};

interface SeriesColorDrawerProps extends SeriesStyle {
  opened: boolean;
  mode?: SeriesStyleMode;
  onChange: (next: SeriesStyle) => void;
  onClose: () => void;
}

/**
 * Per-series style editor, opened from the series row. Reuses
 * `ColorSwatchInput` and `ColorRulesEditor`. Fields a mode does not show are
 * handed back unchanged on Apply, so switching display type keeps them.
 * Tables resolve colors per cell in `HDXMultiSeriesTableChart` via
 * `resolveConditionalColor`; time charts via `getSelectSeriesStyles`.
 */
export default function SeriesColorDrawer({
  opened,
  mode = 'column',
  color,
  colorRules,
  lineStyle,
  onChange,
  onClose,
}: SeriesColorDrawerProps) {
  const copy = MODE_COPY[mode];
  const showRules = mode === 'column';
  const showLineStyle = mode === 'line';

  // Attach client-side localIds once per incoming value so the dnd-kit rows
  // keep stable keys for the editing session; strip them on apply. Mirrors
  // ChartDisplaySettingsDrawer's handling of number-tile color rules.
  const appliedDefaults = useMemo<StyleFormState>(
    () => ({
      color,
      colorRules: colorRules ? attachLocalIds(colorRules) : undefined,
      lineStyle,
    }),
    [color, colorRules, lineStyle],
  );

  const { control, handleSubmit, reset, setValue } = useForm<StyleFormState>({
    defaultValues: appliedDefaults,
  });

  useEffect(() => {
    reset(appliedDefaults);
  }, [appliedDefaults, reset]);

  const currentColor = useWatch({ control, name: 'color' });
  const currentRules = useWatch({ control, name: 'colorRules' });
  const currentLineStyle = useWatch({ control, name: 'lineStyle' });
  const hasSelection =
    currentColor != null ||
    (showRules && (currentRules?.length ?? 0) > 0) ||
    (showLineStyle && currentLineStyle != null && currentLineStyle !== 'solid');

  const handleClose = useCallback(() => {
    reset(appliedDefaults);
    onClose();
  }, [reset, appliedDefaults, onClose]);

  const applyChanges = useCallback(() => {
    // Close inside the success callback so a future validation rule cannot
    // discard an in-progress edit on Apply (close only follows a valid submit).
    handleSubmit(values => {
      onChange({
        color: values.color,
        colorRules:
          values.colorRules && values.colorRules.length > 0
            ? stripLocalIds(values.colorRules)
            : undefined,
        lineStyle: values.lineStyle === 'solid' ? undefined : values.lineStyle,
      });
      onClose();
    })();
  }, [handleSubmit, onChange, onClose]);

  const clearStyle = useCallback(() => {
    setValue('color', undefined);
    if (showRules) {
      setValue('colorRules', undefined);
    }
    if (showLineStyle) {
      setValue('lineStyle', undefined);
    }
  }, [setValue, showRules, showLineStyle]);

  return (
    <Drawer
      title={copy.title}
      opened={opened}
      onClose={handleClose}
      position="right"
    >
      <Stack>
        <Stack gap="xs">
          <div>
            <Text size="xs" fw={500} mb={2}>
              Color
            </Text>
            <Text size="xs" c="dimmed">
              {copy.colorHint}
            </Text>
          </div>
          <Controller
            control={control}
            name="color"
            render={({ field }) => (
              <ColorSwatchInput
                value={field.value}
                onChange={field.onChange}
                ariaLabel={copy.colorLabel}
              />
            )}
          />
        </Stack>
        {showLineStyle && (
          <Input.Wrapper size="xs" label="Line style">
            <Controller
              control={control}
              name="lineStyle"
              render={({ field: { onChange: setLineStyle, value } }) => (
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={value ?? 'solid'}
                  onChange={v => {
                    const parsed = SeriesLineStyleSchema.safeParse(v);
                    if (parsed.success) setLineStyle(parsed.data);
                  }}
                  data={LINE_STYLE_OPTIONS}
                  data-testid="series-line-style-control"
                />
              )}
            />
          </Input.Wrapper>
        )}
        {showRules && (
          <Controller
            control={control}
            name="colorRules"
            render={({ field }) => (
              <ColorRulesEditor
                value={field.value ?? []}
                onChange={field.onChange}
              />
            )}
          />
        )}
        <Group gap="xs" mt="xs" justify="space-between">
          {hasSelection ? (
            <Button
              variant="secondary"
              onClick={clearStyle}
              data-testid="series-color-clear"
            >
              Clear
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            onClick={applyChanges}
            data-testid="series-color-apply"
          >
            Apply
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
