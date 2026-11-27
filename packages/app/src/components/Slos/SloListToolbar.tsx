import { Group, MultiSelect, Select, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import {
  DEFAULT_SLO_SORT,
  isSloSort,
  SLO_SORT_OPTIONS,
  type SloSort,
} from './sloListSort';

/** Search, tag and source filters and the sort of the SLO list. */
export function SloListToolbar({
  search,
  onSearchChange,
  tags,
  tagFilter,
  onTagFilterChange,
  sources,
  sourceFilter,
  onSourceFilterChange,
  sort,
  onSortChange,
}: {
  search: string;
  onSearchChange: (search: string) => void;
  /** The tags the team's SLOs carry. */
  tags: string[];
  tagFilter: string[];
  onTagFilterChange: (tags: string[]) => void;
  /** The sources the team's SLOs are defined on. */
  sources: { value: string; label: string }[];
  sourceFilter: string | null;
  onSourceFilterChange: (source: string | null) => void;
  sort: SloSort;
  onSortChange: (sort: SloSort) => void;
}) {
  return (
    <Group gap="xs" mb="md">
      <TextInput
        placeholder="Search by name, description or tag"
        leftSection={<IconSearch size={14} />}
        value={search}
        onChange={e => onSearchChange(e.currentTarget.value)}
        w={320}
        data-testid="slo-search"
      />
      {/* Stay while a filter is set, so a stale link can still be cleared. */}
      {(tags.length > 0 || tagFilter.length > 0) && (
        <MultiSelect
          aria-label="Filter by tag"
          placeholder={tagFilter.length > 0 ? undefined : 'All tags'}
          data={[...new Set([...tags, ...tagFilter])]}
          value={tagFilter}
          onChange={onTagFilterChange}
          searchable
          clearable
          w={220}
          data-testid="slo-tag-filter"
        />
      )}
      {(sources.length > 1 || sourceFilter != null) && (
        <Select
          aria-label="Filter by source"
          placeholder="All sources"
          data={sources}
          value={sourceFilter}
          onChange={onSourceFilterChange}
          clearable
          w={200}
          data-testid="slo-source-filter"
        />
      )}
      <Select
        aria-label="Sort by"
        data={SLO_SORT_OPTIONS.map(o => ({ ...o }))}
        value={sort}
        onChange={value =>
          onSortChange(isSloSort(value) ? value : DEFAULT_SLO_SORT)
        }
        allowDeselect={false}
        w={180}
        data-testid="slo-sort"
      />
    </Group>
  );
}
