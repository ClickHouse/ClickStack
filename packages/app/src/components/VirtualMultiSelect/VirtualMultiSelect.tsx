import {
  ChangeEventHandler,
  KeyboardEventHandler,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { VariableSelection } from '@hyperdx/common-utils/dist/variableSelection';
import {
  CheckIcon,
  CloseButton,
  Combobox,
  Group,
  Pill,
  PillsInput,
  ScrollArea,
  Text,
  useCombobox,
} from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

// UI-internal routing token for the "All" combobox row. Never stored or emitted.
const ALL_ROW_VALUE = '__hdx_all_row__';

// UI-visible label for the "All" combobox row.
const ALL_ROW_LABEL = 'All';

type VirtualMultiSelectProps = {
  data: string[];
  disabled?: boolean;
  /** Show a "Loading…" empty state while values are being fetched. */
  loading?: boolean;
  placeholder?: string;
  /** Whether to sort options before rendering. True by default */
  sort?: boolean;
  isMultiSelect?: boolean;
  /** Concrete selected values. Empty when "all" is selected. */
  values: string[];
  /** Whether to show the "All" option. */
  enableAllOption?: boolean;
  /** Whether the "All" option is currently selected. */
  isAllOptionSelected?: boolean;
  /** Emits an explicit list of values, or `{ all: true }` for "All". */
  onChange: (next: VariableSelection) => void;
  'data-testid'?: string;
};

export function VirtualMultiSelect({
  data,
  disabled,
  loading,
  placeholder,
  sort = true,
  isMultiSelect = true,
  values,
  onChange,
  'data-testid': dataTestId,
  enableAllOption = false,
  isAllOptionSelected: allSelected,
}: VirtualMultiSelectProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState('');

  const isAllSelected = enableAllOption && !!allSelected;
  const concreteValues = isAllSelected ? [] : values;
  const showAllOption =
    enableAllOption &&
    ALL_ROW_LABEL.toLowerCase().includes(search.trim().toLowerCase());

  const sorted = useMemo(() => {
    return sort ? data.toSorted((a, b) => a.localeCompare(b)) : data;
  }, [data, sort]);

  const options = useMemo(() => {
    const searchLowerCase = search.trim().toLowerCase();
    return sorted.filter(
      item =>
        item.toLowerCase().includes(searchLowerCase) && item.trim().length > 0,
    );
  }, [sorted, search]);

  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 36,
    overscan: 5,
  });

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
    onDropdownOpen: () => {
      combobox.updateSelectedOptionIndex('active');
      virtualizer.measure();
    },
  });

  const handleRemoveValue = (val: string) =>
    onChange(values.filter(v => v !== val));

  const handleRemoveAllValues = () => onChange([]);

  const handleAddValue = (val: string) => {
    if (isAllSelected) {
      onChange([val]);
      return;
    }
    if (!values.includes(val)) {
      onChange(isMultiSelect ? [...values, val] : [val]);
    }
  };

  const handleSelectValue = (val: string) => {
    if (enableAllOption && val === ALL_ROW_VALUE) {
      // Toggle the "All" row: selecting it emits the structural marker and
      // clears any concrete selection; selecting it again clears everything.
      onChange(isAllSelected ? [] : { all: true });
    } else if (!isAllSelected && values.includes(val)) {
      handleRemoveValue(val);
    } else {
      // Picking a concrete value while "All" is active narrows to that value.
      handleAddValue(val);
    }
    // Clear the search input after a value is selected, matching the behavior
    // of a non-virtualized Mantine MultiSelect with search.
    setSearch('');
    if (!isMultiSelect) combobox.closeDropdown();
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = event => {
    if (event.key === 'Backspace' && search.length === 0) {
      if (isAllSelected) {
        event.preventDefault();
        onChange([]);
        return;
      }
      if (values.length > 0) {
        event.preventDefault();
        handleRemoveValue(values[values.length - 1]);
        return;
      }
    }

    if (event.key === 'Enter') {
      const trimmed = search.trim();
      // When the user has explicitly highlighted a dropdown option with the
      // arrow keys, defer to the combobox's default behavior of selecting it.
      // Otherwise, treat Enter as "add the typed value" so arbitrary values can
      // be entered without picking a specific dropdown option.
      if (trimmed.length > 0 && combobox.getSelectedOptionIndex() === -1) {
        event.preventDefault();
        handleAddValue(trimmed);
        setSearch('');
      }
    }
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = event => {
    combobox.updateSelectedOptionIndex();
    setSearch(event.currentTarget.value);
  };

  // Hide the input field (cursor) for single selects with existing values,
  // otherwise the user is visually encouraged to add another value.
  const isInputFieldLocked = !isMultiSelect && values.length > 0;

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={handleSelectValue}
      disabled={disabled}
    >
      <Combobox.DropdownTarget>
        <PillsInput
          onClick={() => combobox.openDropdown()}
          disabled={disabled}
          size="xs"
          data-testid={dataTestId}
          {...(isAllSelected || values.length
            ? {
                rightSection: (
                  <CloseButton
                    disabled={disabled}
                    size="xs"
                    variant="transparent"
                    onClick={handleRemoveAllValues}
                  />
                ),
                rightSectionPointerEvents: disabled ? 'none' : 'auto',
              }
            : {
                rightSection: <Combobox.Chevron />,
                rightSectionPointerEvents: 'none',
              })}
        >
          <Pill.Group>
            {(isAllSelected
              ? [
                  {
                    key: ALL_ROW_VALUE,
                    label: ALL_ROW_LABEL,
                    onRemove: () => onChange([]),
                  },
                ]
              : concreteValues.map(item => ({
                  key: item,
                  label: item,
                  onRemove: () => handleRemoveValue(item),
                }))
            ).map(({ key, label, onRemove }) => (
              <Pill
                key={key}
                withRemoveButton
                onRemove={onRemove}
                // manually disabling instead of using `disabled` prop
                // `disabled` prop hides remove button which can cause layout to jump
                aria-disabled={disabled}
                styles={{ root: { pointerEvents: disabled ? 'none' : 'auto' } }}
              >
                {label}
              </Pill>
            ))}

            <Combobox.EventsTarget>
              <PillsInput.Field
                onFocus={() => combobox.openDropdown()}
                onBlur={() => combobox.closeDropdown()}
                type={isInputFieldLocked ? 'hidden' : 'visible'}
                readOnly={isInputFieldLocked}
                value={search}
                placeholder={placeholder}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                data-has-values={
                  isAllSelected || values.length > 0 ? 'true' : 'false'
                }
              />
            </Combobox.EventsTarget>
          </Pill.Group>
        </PillsInput>
      </Combobox.DropdownTarget>

      <Combobox.Dropdown>
        <Combobox.Options>
          {showAllOption && (
            <Combobox.Option value={ALL_ROW_VALUE} active={isAllSelected}>
              <Group gap="xs">
                {isAllSelected && <CheckIcon size={10} />}
                <Text size="xs" fw={500}>
                  {ALL_ROW_LABEL}
                </Text>
              </Group>
            </Combobox.Option>
          )}
          {options.length > 0 ? (
            <ScrollArea.Autosize
              type="scroll"
              mah={300}
              viewportRef={viewportRef}
            >
              <div
                style={{
                  height: `${totalSize}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualItems.map(virtualItem => {
                  const item = options[virtualItem.index];
                  const isSelected = concreteValues.includes(item);

                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <Combobox.Option value={item} active={isSelected}>
                        <Group gap="xs">
                          {isSelected && <CheckIcon size={10} />}
                          <Text size="xs">{item}</Text>
                        </Group>
                      </Combobox.Option>
                    </div>
                  );
                })}
              </div>
            </ScrollArea.Autosize>
          ) : (
            // The "All" row is rendered above the (empty) list, so only fall
            // back to the empty/loading hint when there is nothing at all.
            !showAllOption && (
              <Combobox.Empty>
                {loading ? 'Loading…' : 'Nothing found...'}
              </Combobox.Empty>
            )
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
