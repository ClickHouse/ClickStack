import { useFieldArray } from 'react-hook-form';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  InputLabel,
  Stack,
  Text,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

import { TextInputControlled } from '@/components/InputControlled';

import { DrawerControl } from './utils';

export function FilterTemplateList({
  control,
  allowVariables = false,
}: {
  control: DrawerControl;
  /** Offer filters keyed by the destination dashboard's variable name. */
  allowVariables?: boolean;
}) {
  const {
    fields: filters,
    append,
    remove,
  } = useFieldArray({
    control,
    name: 'onClick.filters' as const,
  });

  return (
    <Box>
      <InputLabel>Filters</InputLabel>
      <Text size="xs" c="dimmed" mb="xs">
        Enter an expression (e.g. a column name)
        {allowVariables ? ' or a variable name' : ''} and a template for its
        value.
      </Text>
      <Stack gap="xs">
        {filters.map((filter, i) => (
          <Group key={filter.id} gap="xs" align="flex-start" wrap="nowrap">
            {filter.kind === 'variableTemplate' ? (
              <TextInputControlled
                control={control}
                name={`onClick.filters.${i}.variableName` as const}
                placeholder="Variable"
                leftSection="$"
                style={{ flex: 1 }}
                data-testid="onclick-filter-variable-input"
              />
            ) : (
              <TextInputControlled
                control={control}
                name={`onClick.filters.${i}.expression` as const}
                placeholder="Expression"
                style={{ flex: 1 }}
                data-testid="onclick-filter-expression-input"
              />
            )}
            <TextInputControlled
              control={control}
              name={`onClick.filters.${i}.template` as const}
              placeholder="Template (e.g. {{ServiceName}})"
              style={{ flex: 1 }}
              data-testid="onclick-filter-template-input"
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Remove filter"
              onClick={() => remove(i)}
              mt={3}
              data-testid="onclick-filter-remove-button"
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Group gap="xs">
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<IconPlus size={14} />}
            onClick={() =>
              append({
                kind: 'expressionTemplate',
                expression: '',
                template: '',
              })
            }
          >
            Add filter
          </Button>
          {allowVariables && (
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                append({
                  kind: 'variableTemplate',
                  variableName: '',
                  template: '',
                })
              }
              data-testid="onclick-add-variable-button"
            >
              Add variable
            </Button>
          )}
        </Group>
      </Stack>
    </Box>
  );
}
