import {
  getFilterBroadcastTarget,
  getFilterVariableName,
  isFilterGlobalRequirement,
  isFilterRequired,
  isFilterVariableEnabled,
} from '@hyperdx/common-utils/dist/filters';
import { getObjectName } from '@hyperdx/common-utils/dist/referenceVariables';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Center,
  Group,
  Modal,
  Stack,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAsterisk,
  IconBuildingBroadcastTower,
  IconDatabase,
  IconFilter,
  IconLabel,
  IconList,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconServer,
  IconTrash,
} from '@tabler/icons-react';

import { SOURCE_KIND_LABELS } from '@/components/Sources/SourceForm/constants';
import { useConnections } from '@/connection';
import { useSources } from '@/source';

import { MODAL_SIZE } from './constants';
import {
  DashboardFilterAttribute,
  DashboardFilterListItem,
} from './DashboardFiltersListItem';

import styles from '@styles/DashboardFiltersModal.module.scss';

interface DashboardFiltersListProps {
  filters: DashboardFilter[];
  isLoading?: boolean;
  hideAppliesTo?: boolean;
  /** Whether the broadcast / variable controls are available. */
  showVariableOptions: boolean;
  onEdit: (filter: DashboardFilter) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onAddNew: () => void;
}

function getSourceNames(
  ids: string[],
  sources?: { id: string; name: string }[],
) {
  return ids
    .map(id => getObjectName(id, sources))
    .filter((name): name is string => !!name)
    .join(', ');
}

/** Where the dropdown's values come from: the queried source, or the authored list. */
function getValuesAttribute(
  filter: DashboardFilter,
  sources?: { id: string; name: string }[],
  connections?: { id: string; name: string }[],
): DashboardFilterAttribute {
  switch (filter.type) {
    case 'QUERY_EXPRESSION':
      return {
        icon: <IconSearch size={14} />,
        tooltip: 'Source the dropdown values are queried from',
        label: getObjectName(filter.source, sources) ?? '',
      };
    case 'PROMETHEUS_LABEL':
      return {
        icon: <IconLabel size={14} />,
        tooltip: 'PromQL source and label the dropdown values come from',
        label: [getObjectName(filter.source, sources), filter.label]
          .filter(Boolean)
          .join(' · '),
      };
    case 'STATIC_LIST': {
      const count = filter.options.length;
      return {
        icon: <IconList size={14} />,
        label: `${count} custom option${count === 1 ? '' : 's'}`,
      };
    }
    case 'ADHOC':
      return {
        icon: <IconFilter size={14} />,
        tooltip: 'Sources the condition keys and values come from',
        label: getSourceNames(filter.sources, sources),
      };
    case 'DATA_SOURCE':
      return {
        icon: <IconDatabase size={14} />,
        tooltip:
          'Kinds of sources offered, and the connection they are limited to',
        label: [
          filter.allowedSourceKinds
            .map(kind => SOURCE_KIND_LABELS[kind])
            .join(', '),
          filter.connection && getObjectName(filter.connection, connections),
        ]
          .filter(Boolean)
          .join(' · '),
      };
    case 'CONNECTION':
      return {
        icon: <IconServer size={14} />,
        label: 'Connections',
      };
    default:
      filter satisfies never; // exhaustive check
      return { icon: <IconSearch size={14} />, label: '' };
  }
}

function getBroadcastTargetDisplay(
  filter: DashboardFilter,
  sources?: { id: string; name: string }[],
) {
  const broadcastTarget = getFilterBroadcastTarget(filter);
  if (!broadcastTarget) return undefined;

  if (!broadcastTarget?.appliesToSourceIds?.length) {
    return 'All sources';
  }

  return getSourceNames(broadcastTarget.appliesToSourceIds, sources);
}

export const DashboardFiltersList = ({
  filters,
  isLoading,
  hideAppliesTo,
  showVariableOptions,
  onEdit,
  onRemove,
  onClose,
  onAddNew,
}: DashboardFiltersListProps) => {
  const { data: sources } = useSources();
  const { data: connections } = useConnections();

  return (
    <Modal
      opened
      onClose={onClose}
      title={showVariableOptions ? 'Filters and Variables' : 'Filters'}
      size={MODAL_SIZE}
      className={styles.modal}
    >
      <Stack
        className={styles.filtersContainer}
        gap="xs"
        data-testid="dashboard-filters-list"
      >
        {filters.map(filter => {
          const attributes = [getValuesAttribute(filter, sources, connections)];

          const broadcastTarget = getBroadcastTargetDisplay(filter, sources);
          if (!hideAppliesTo && broadcastTarget != null) {
            attributes.push({
              icon: <IconBuildingBroadcastTower size={14} />,
              tooltip: 'Sources this filter broadcasts to',
              label: broadcastTarget,
              testId: `dashboard-filter-applies-to-${filter.name}`,
            });
          }

          if (isFilterRequired(filter)) {
            const isGlobal = isFilterGlobalRequirement(filter);
            attributes.push({
              icon: <IconAsterisk size={14} />,
              tooltip: isGlobal
                ? 'Every tile is blocked until this filter has a selection'
                : 'The tiles that use this filter are blocked until it has a selection',
              label: 'Required',
              testId: `dashboard-filter-required-attr-${filter.name}`,
            });
          }

          const variableName =
            showVariableOptions && isFilterVariableEnabled(filter)
              ? getFilterVariableName(filter)
              : undefined;
          return (
            <DashboardFilterListItem
              key={filter.id}
              name={filter.name}
              nameSuffix={variableName ? ` ($${variableName})` : undefined}
              attributes={attributes}
              actions={
                <>
                  <UnstyledButton
                    onClick={() => onEdit(filter)}
                    className={styles.filterActionButton}
                    data-testid={`edit-filter-button-${filter.name}`}
                  >
                    <IconPencil size={16} />
                  </UnstyledButton>
                  <UnstyledButton
                    onClick={() => onRemove(filter.id)}
                    className={`${styles.filterActionButton} ${styles.deleteButton}`}
                    data-testid={`delete-filter-button-${filter.name}`}
                  >
                    <IconTrash size={16} />
                  </UnstyledButton>
                </>
              }
            />
          );
        })}
        {isLoading && (
          <Center>
            <IconRefresh className="spin-animate" />
          </Center>
        )}
      </Stack>

      <Group justify="space-between" my="sm">
        <Button
          variant="secondary"
          onClick={onClose}
          data-testid="close-filters-button"
        >
          Close
        </Button>
        <Button
          variant="primary"
          onClick={onAddNew}
          data-testid="add-filter-button"
        >
          Add new filter
        </Button>
      </Group>
    </Modal>
  );
};
