import { useEffect, useState } from 'react';
import { FieldValues, UseFormGetValues, UseFormWatch } from 'react-hook-form';
import { useDebouncedCallback } from '@mantine/hooks';

/**
 * The form's values, updated `delay` ms after the last change. Unlike
 * `useWatch({ control })`, which types them as a deep partial, they're typed
 * as complete.
 *
 * Kept out of the form component because the React Compiler skips any
 * component that calls `watch`.
 */
export function useDebouncedFormValues<T extends FieldValues>(
  watch: UseFormWatch<T>,
  getValues: UseFormGetValues<T>,
  delay: number,
): T {
  const [values, setValues] = useState(() => getValues());
  const update = useDebouncedCallback(() => setValues(getValues()), delay);
  useEffect(() => {
    const subscription = watch(() => update());
    return () => subscription.unsubscribe();
  }, [watch, update]);
  return values;
}
