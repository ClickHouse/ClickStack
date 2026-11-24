import { MouseEvent, useCallback, useRef } from 'react';
import type { FocusEvent } from 'react';

const selectAll = (input: HTMLInputElement) =>
  input.setSelectionRange(0, input.value.length);

/**
 * Handlers that select a text input's whole value when it gains focus, so
 * typing replaces the value instead of inserting at the click point.
 *
 * Browsers collapse the selection to the pointer position on the mouseup
 * that completes a focusing click, so that mouseup is cancelled. A click on
 * an input that already has focus places the caret as usual.
 */
export function useSelectAllOnFocus() {
  const focusingByMouseRef = useRef(false);

  const onMouseDown = useCallback((event: MouseEvent<HTMLInputElement>) => {
    focusingByMouseRef.current = document.activeElement !== event.currentTarget;
  }, []);

  const onMouseUp = useCallback((event: MouseEvent<HTMLInputElement>) => {
    if (!focusingByMouseRef.current) return;
    focusingByMouseRef.current = false;
    event.preventDefault();
    selectAll(event.currentTarget);
  }, []);

  const onFocus = useCallback((event: FocusEvent<HTMLInputElement>) => {
    selectAll(event.currentTarget);
  }, []);

  return { onFocus, onMouseDown, onMouseUp };
}
