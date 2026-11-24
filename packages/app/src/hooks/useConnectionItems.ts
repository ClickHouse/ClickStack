import { useMemo } from 'react';

import { useConnections } from '@/connection';

/** The team's connections as select options, optionally sorted by name. */
export function useConnectionItems({ sorted = false } = {}) {
  const { data } = useConnections();
  return useMemo(() => {
    const items = (data ?? []).map(connection => ({
      value: connection.id,
      label: connection.name,
    }));
    return sorted
      ? items.sort((a, b) => a.label.localeCompare(b.label))
      : items;
  }, [data, sorted]);
}
