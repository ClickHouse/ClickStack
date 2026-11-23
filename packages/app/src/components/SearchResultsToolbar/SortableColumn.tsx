import { useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Box, Group, Text, Textarea } from '@mantine/core';
import { IconGripVertical, IconPencil, IconX } from '@tabler/icons-react';

export function SortableColumn({
  id,
  label,
  onRemove,
  editText,
  onStartEdit,
  onChangeEdit,
  onFinishEdit,
}: {
  id: string;
  label: string;
  onRemove: () => void;
  /** The text being edited, or null when this row is not being edited. */
  editText: string | null;
  onStartEdit: () => void;
  onChangeEdit: (text: string) => void;
  /** Receives the edited text to keep, or null to cancel the edit. */
  onFinishEdit: (next: string | null) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const editing = editText != null;
  // Enter and Escape unmount the input, which can fire blur. Without this the
  // edit would be finished a second time.
  const finishedRef = useRef(false);

  const startEdit = () => {
    finishedRef.current = false;
    onStartEdit();
  };

  const finishEdit = (next: string | null) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishEdit(next);
  };

  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <Group
        gap={4}
        wrap="nowrap"
        align="flex-start"
        w="100%"
        px={4}
        py={2}
        style={{
          borderRadius: 'var(--mantine-radius-sm)',
          background: 'var(--color-bg-muted)',
        }}
      >
        <ActionIcon
          variant="subtle"
          size="xs"
          aria-label={`Reorder ${label}`}
          style={{ cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={14} />
        </ActionIcon>
        {editing ? (
          <Textarea
            size="xs"
            aria-label={`Edit ${label}`}
            value={editText}
            // A column is one expression. Pasted line breaks would otherwise
            // be stored as part of it.
            onChange={e =>
              onChangeEdit(e.currentTarget.value.replace(/\s*\r?\n\s*/g, ' '))
            }
            onFocus={e => {
              const end = e.currentTarget.value.length;
              e.currentTarget.setSelectionRange(end, end);
            }}
            onBlur={() => finishEdit(editText)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                // The search form is an ancestor, so Enter would submit it.
                e.preventDefault();
                e.stopPropagation();
                finishEdit(editText);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                finishEdit(null);
              }
            }}
            autoFocus
            // Wrap and grow like the row text, so a long expression stays
            // readable instead of scrolling sideways.
            autosize
            minRows={1}
            maxRows={8}
            styles={{
              input: {
                fontFamily: 'var(--mantine-font-family-monospace)',
                lineHeight: 1.5,
                overflowWrap: 'anywhere',
              },
            }}
            style={{ flex: 1, minWidth: 0 }}
            // Lets ClausePopover pass Escape through instead of discarding.
            data-handles-escape
            data-testid="search-columns-edit-input"
          />
        ) : (
          <Text
            size="xs"
            ff="monospace"
            lh={1.5}
            onClick={startEdit}
            style={{
              flex: 1,
              minWidth: 0,
              overflowWrap: 'anywhere',
              cursor: 'text',
            }}
          >
            {label}
          </Text>
        )}
        {!editing && (
          <ActionIcon
            variant="subtle"
            size="xs"
            onClick={startEdit}
            aria-label={`Edit ${label}`}
            style={{ flexShrink: 0 }}
          >
            <IconPencil size={14} />
          </ActionIcon>
        )}
        <ActionIcon
          variant="subtle"
          size="xs"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          style={{ flexShrink: 0 }}
        >
          <IconX size={14} />
        </ActionIcon>
      </Group>
    </Box>
  );
}
