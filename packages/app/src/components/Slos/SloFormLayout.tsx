import { Flex, Paper, Stack, Text } from '@mantine/core';

import { EDITOR_INPUT_HEIGHTS } from '@/components/editorInputHeights';
import { FormRow } from '@/components/Sources/SourceForm/FormRow';

/** A titled group of rows in the SLO builder. */
export function SloFormSection({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Paper withBorder p="md" radius="sm" id={id}>
      <Text fw={500}>{title}</Text>
      {description && (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      )}
      <Stack gap="md" mt="md">
        {children}
      </Stack>
    </Paper>
  );
}

/**
 * A row of the SLO builder: the Source form's label column, with the label
 * kept in sentence case. `inline` centers a control shorter than an input,
 * such as a radio group or a switch, on the label.
 */
export function SloFormRow({
  label,
  helpText,
  inline,
  children,
}: {
  label: string;
  helpText?: string;
  inline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <FormRow label={<Text size="sm">{label}</Text>} helpText={helpText}>
      {inline ? (
        <Flex mih={EDITOR_INPUT_HEIGHTS.sm} align="center">
          {children}
        </Flex>
      ) : (
        children
      )}
    </FormRow>
  );
}
