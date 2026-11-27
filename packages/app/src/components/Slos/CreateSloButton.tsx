import Link from 'next/link';
import type { Filter } from '@hyperdx/common-utils/dist/types';
import { Button, Tooltip } from '@mantine/core';
import { IconTargetArrow } from '@tabler/icons-react';

import {
  encodeJsonUrlParamValue,
  encodeUrlParamValue,
} from '@/utils/urlParamEncoding';

/**
 * Opens the SLO builder with the current search as the eligible events. The
 * query and filters are copied, so later edits to the search leave the SLO
 * alone.
 */
export function CreateSloButton({
  source,
  where,
  whereLanguage,
  filters,
  savedSearchName,
}: {
  source?: string | null;
  where?: string | null;
  whereLanguage?: string | null;
  filters?: Filter[] | null;
  savedSearchName?: string | null;
}) {
  if (!source) return null;
  const params = new URLSearchParams({
    source: encodeUrlParamValue(source),
    where: encodeUrlParamValue(where ?? ''),
    whereLanguage: encodeUrlParamValue(whereLanguage ?? 'lucene'),
    filters: encodeJsonUrlParamValue(filters ?? []),
  });
  if (savedSearchName) params.set('name', encodeUrlParamValue(savedSearchName));
  return (
    <Tooltip label="Create an SLO from this search" withArrow openDelay={300}>
      <Button
        component={Link}
        href={`/slos/new?${params.toString()}`}
        variant="secondary"
        size="xs"
        leftSection={<IconTargetArrow size={14} />}
        style={{ flexShrink: 0 }}
        data-testid="create-slo-button"
      >
        SLO
      </Button>
    </Tooltip>
  );
}
