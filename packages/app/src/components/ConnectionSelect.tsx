import { UseControllerProps, useWatch } from 'react-hook-form';
import { parseVariableReference } from '@hyperdx/common-utils/dist/referenceVariables';
import { SelectProps } from '@mantine/core';
import { IconServer } from '@tabler/icons-react';

import SelectControlled from '@/components/SelectControlled';
import {
  useWithConnectionVariableItems,
  VARIABLE_ICON,
} from '@/components/sourceSelectUtils';
import { useConnectionItems } from '@/hooks/useConnectionItems';

export function ConnectionSelectControlled({
  size,
  allowConnectionVariables = false,
  placeholder = 'Connection',
  clearable = false,
  ...props
}: {
  size?: string;
  /** Whether to offer the dashboard's connection variables. */
  allowConnectionVariables?: boolean;
} & Pick<SelectProps, 'placeholder' | 'clearable'> &
  UseControllerProps<any>) {
  const selected = useWatch({ control: props.control, name: props.name });
  const connectionItems = useConnectionItems();
  const items = useWithConnectionVariableItems(
    connectionItems,
    allowConnectionVariables,
  );

  return (
    <SelectControlled
      {...props}
      allowDeselect={false}
      clearable={clearable}
      data={items}
      // disabled={isDatabasesLoading}
      comboboxProps={{ withinPortal: true }}
      searchable
      placeholder={placeholder}
      leftSection={
        parseVariableReference(selected) != null ? (
          VARIABLE_ICON
        ) : (
          <IconServer size={16} />
        )
      }
      maxDropdownHeight={280}
      size={size}
    />
  );
}
