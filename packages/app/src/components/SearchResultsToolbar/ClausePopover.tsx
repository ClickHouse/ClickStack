import { type ReactNode, useRef, useState } from 'react';
import { completionStatus } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { Button, Group, Popover, SegmentedControl, Stack } from '@mantine/core';

import { SplitValueButton } from '@/components/SplitValueButton/SplitValueButton';
import { useConfirm } from '@/useConfirm';

export type ClauseMode = 'pick' | 'sql';

const matchesDefault = (draft: string, defaultValue: string) =>
  draft.trim() === defaultValue.trim();

/**
 * What Apply writes. An empty form value means "use the source default", so a
 * draft that matches the default is stored as "" rather than a copy of it.
 */
export function storedClause(
  draft: string,
  value: string,
  defaultValue: string,
) {
  return matchesDefault(draft, defaultValue)
    ? ''
    : draft === (value || defaultValue)
      ? value
      : draft;
}

export const clauseResetDisabled = matchesDefault;

export const clauseApplyDisabled = (draft: string) => draft.trim() === '';

// Wide enough for the column list on a desktop, narrow enough to stay on a
// phone. The button sits to the right of the nav rail, so a fixed width runs
// off the right edge and clips Apply.
const POPOVER_MAX_WIDTH = 440;

/**
 * The draft differs from the clause the editor opened with. Apply stores a
 * matching default as "", so comparing against that form treats an untouched
 * saved search, whose stored clause already equals the default, as dirty.
 */
export const clauseDirty = (
  draft: string,
  value: string,
  defaultValue: string,
) => draft.trim() !== (value || defaultValue).trim();

const MODE_OPTIONS = [
  { label: 'Fields', value: 'pick' },
  { label: 'SQL', value: 'sql' },
];

// CodeMirror and the Fields autocomplete both close their own list on Escape,
// but the popover sees the key first. Let that Escape through while a list is
// open, so it does not close the popover or discard a draft.
const nestedListHandlesEscape = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  if (
    target.closest('[aria-expanded="true"], [data-combobox-dropdown]') != null
  )
    return true;
  const editor = target.closest('.cm-editor');
  if (!(editor instanceof HTMLElement)) return false;
  if (editor.querySelector('.cm-tooltip-autocomplete') != null) return true;
  const view = EditorView.findFromDOM(editor);
  return view != null && completionStatus(view.state) != null;
};

/**
 * A toolbar button that edits one query clause in a popover. Edits stay in a
 * draft owned by the caller until Apply. Closing with unsaved edits asks
 * first. Cancel discards them without asking.
 */
export function ClausePopover({
  name,
  summary,
  count,
  dimmed,
  title,
  initialMode,
  dirty,
  onOpen,
  onApply,
  onReset,
  resetDisabled,
  applyDisabled,
  renderPick,
  renderSql,
  'data-testid': testId,
}: {
  /** The muted side of the split button, such as Columns or Sort. */
  name: string;
  /** Desktop value: a field name, "3 fields", or "none". */
  summary: string;
  /** How many fields the summary counts. */
  count: number;
  /** The clause is still the source default, so the value is quiet. */
  dimmed?: boolean;
  /** The full clause, shown on hover since the value only summarizes it. */
  title: string;
  /** The tab to show each time the popover opens. */
  initialMode: ClauseMode;
  /** The draft would change the stored clause, so closing asks first. */
  dirty: boolean;
  /** Reset the caller's draft to the current value. */
  onOpen: () => void;
  onApply: () => void;
  /** Restore the source default in the draft. Apply still has to confirm it. */
  onReset: () => void;
  resetDisabled?: boolean;
  /** An empty clause is stored as the source default, so Apply cannot submit one. */
  applyDisabled?: boolean;
  renderPick: (apply: () => void) => ReactNode;
  renderSql: (apply: () => void) => ReactNode;
  'data-testid': string;
}) {
  const confirm = useConfirm();
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<ClauseMode>(initialMode);
  // The confirm dialog sits outside this popover, so its own clicks look like
  // another dismiss. Ignore those while it is open.
  const confirmingRef = useRef(false);

  const open = () => {
    onOpen();
    setMode(initialMode);
    setOpened(true);
  };

  const requestClose = () => {
    if (confirmingRef.current) return;
    if (!dirty) {
      setOpened(false);
      return;
    }
    confirmingRef.current = true;
    void confirm('Discard unsaved changes?', 'Discard', {
      variant: 'danger',
    }).then(discard => {
      confirmingRef.current = false;
      if (discard) setOpened(false);
    });
  };

  const apply = () => {
    if (applyDisabled) return;
    onApply();
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={next => {
        if (!next) requestClose();
      }}
      position="bottom-start"
      shadow="md"
      withinPortal
      // Escape is handled below, so a completion list can take the key first.
      closeOnEscape={false}
      // Let shift move the dropdown past the button's edge, so a dropdown
      // wider than the space to the right slides left instead of overflowing.
      middlewares={{
        shift: {
          padding: 8,
          limiter: {
            fn: ({ x, y }) => ({ x, y }),
          },
        },
        size: {
          padding: 8,
          apply({ availableWidth, availableHeight, elements }) {
            if (availableWidth > 0) {
              elements.floating.style.maxWidth = `${availableWidth}px`;
            }
            if (availableHeight > 0) {
              elements.floating.style.maxHeight = `${availableHeight}px`;
            }
          },
        },
      }}
    >
      <Popover.Target>
        <SplitValueButton
          name={name}
          summary={summary}
          count={count}
          dimmed={dimmed}
          title={title}
          onClick={() => (opened ? requestClose() : open())}
          data-testid={testId}
        />
      </Popover.Target>
      <Popover.Dropdown
        data-testid={`${testId}-popover`}
        // Set after Mantine's inline width (max-content), which would win over a class.
        style={{ width: `min(${POPOVER_MAX_WIDTH}px, calc(100vw - 16px))` }}
        onKeyDownCapture={event => {
          if (event.key !== 'Escape') return;
          if (nestedListHandlesEscape(event.target)) return;
          requestClose();
        }}
      >
        <Stack gap="sm">
          <SegmentedControl
            size="xs"
            fullWidth
            value={mode}
            onChange={value => setMode(value === 'sql' ? 'sql' : 'pick')}
            data={MODE_OPTIONS}
            data-testid={`${testId}-mode`}
          />
          {mode === 'pick' ? renderPick(apply) : renderSql(apply)}
          <Group
            justify="space-between"
            gap="xs"
            wrap="wrap"
            // The SQL completion list overflows the editor onto these buttons.
            // Fields mode uses an in-popover Autocomplete, which must stay above them.
            style={
              mode === 'sql'
                ? {
                    position: 'relative',
                    zIndex: 'var(--mantine-z-index-max)',
                  }
                : undefined
            }
          >
            <Button
              variant="link"
              size="xs"
              onClick={onReset}
              disabled={resetDisabled}
              data-testid={`${testId}-reset`}
            >
              Reset to default
            </Button>
            <Group gap="xs" wrap="nowrap" ml="auto">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setOpened(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="xs"
                onClick={apply}
                disabled={applyDisabled}
                data-testid={`${testId}-apply`}
              >
                Apply
              </Button>
            </Group>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
