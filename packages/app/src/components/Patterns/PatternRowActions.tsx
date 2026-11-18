import { useMemo } from 'react';
import type { ConditionFilter } from '@hyperdx/common-utils/dist/types';
import { IconFilter, IconFilterX } from '@tabler/icons-react';

import { DBRowTableIconButton } from '@/components/DBTable/DBRowTableIconButton';
import {
  buildPatternFilter,
  PatternFilterAction,
} from '@/components/Patterns/patternFilter';

/** Hover buttons on a pattern row: filter for it, or exclude it. */
export function PatternRowActions({
  template,
  valueExpression,
  onFilter,
}: {
  template: string;
  valueExpression: string;
  onFilter: (filter: ConditionFilter, action: PatternFilterAction) => void;
}) {
  const filters = useMemo(
    () => ({
      include: buildPatternFilter(valueExpression, template, 'include'),
      exclude: buildPatternFilter(valueExpression, template, 'exclude'),
    }),
    [valueExpression, template],
  );
  const { include, exclude } = filters;
  if (include == null || exclude == null) return null;

  return (
    <>
      <DBRowTableIconButton
        variant="copy"
        title="Filter for this pattern"
        onClick={() => onFilter(include, 'include')}
      >
        <IconFilter size={16} />
      </DBRowTableIconButton>
      <DBRowTableIconButton
        variant="copy"
        title="Exclude this pattern"
        onClick={() => onFilter(exclude, 'exclude')}
      >
        <IconFilterX size={16} />
      </DBRowTableIconButton>
    </>
  );
}
