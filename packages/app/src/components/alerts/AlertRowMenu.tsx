import * as React from 'react';
import Link from 'next/link';
import { isImportableAlert } from '@hyperdx/common-utils/dist/iac';
import { getSloAlertRuleLabel } from '@hyperdx/common-utils/dist/slo';
import { AlertSource } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Menu, Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBrandTerraform,
  IconDots,
  IconExternalLink,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import api from '@/api';
import { useBrandDisplayName } from '@/brand';
import { EditAlertModal } from '@/components/alerts/EditAlertModal';
import { EditInlineAlertModal } from '@/components/alerts/EditInlineAlertModal';
import { TerraformHelperPanel } from '@/components/Iac/TerraformHelperPanel';
import { useTerraformSnippets } from '@/components/Iac/useTerraformSnippets';
import { IS_IAC_EXPORT_ENABLED, IS_SLOS_ENABLED } from '@/config';
import type { AlertsPageItem } from '@/types';
import { useConfirm } from '@/useConfirm';
import { intervalToDateRange } from '@/utils/alerts';

type AlertRowMenuProps = {
  alert: AlertsPageItem;
  /** Link to the alert's source (saved search or dashboard tile). */
  alertUrl?: string;
  /** Label for that source, e.g. "Saved search". */
  linkTitle?: string;
  /**
   * Display name, for the delete confirmation and the menu's accessible label.
   */
  alertName?: string;
  /**
   * Range for the edit modal's threshold preview. Callers with a picked range
   * (the detail page) pass it; a list row has none and falls back to one
   * derived from the alert's interval.
   */
  dateRange?: [Date, Date];
  /** Runs after a successful delete, e.g. to navigate away from a detail page. */
  onDeleted?: () => void;
};

/**
 * Overflow menu for one alerts-page row.
 *
 * It renders unconditionally, which is the point: the actions it holds are
 * each conditional (Terraform import needs an importable alert *and* the
 * export feature, the source link needs a resolvable url), and when they
 * lived directly in the row those gaps collapsed the flex layout so no two
 * rows lined up. Collecting them behind one always-present control gives
 * every row the same trailing slot.
 */
export function AlertRowMenu({
  alert,
  alertUrl,
  linkTitle,
  alertName,
  dateRange,
  onDeleted,
}: AlertRowMenuProps) {
  // `||`, not `??`: the empty string these arrive as for an unresolvable
  // source is not nullish, and would read as "Open " and "Delete ?".
  const name = alertName?.trim() || 'this alert';
  // An SLO owns its alert: it is edited from the SLO, and deleting it here
  // turns the alert off on the SLO. With SLOs turned off there is no SLO
  // page to edit it on.
  const isSloAlert = alert.source === AlertSource.SLO;
  const sloManaged = isSloAlert && IS_SLOS_ENABLED;
  // The alert carries its SLO's name, so "Delete {name}?" would read as
  // deleting the SLO.
  const deleteMessage = isSloAlert
    ? `Delete the ${getSloAlertRuleLabel(alert.sloRule ?? 'fastBurn').toLowerCase()} alert of ${alertName?.trim() || 'this SLO'}? The SLO keeps tracking.`
    : `Delete ${name}?`;
  // "SLO" is an acronym, so it keeps its case mid-sentence.
  const sourceLabel = isSloAlert
    ? 'SLO'
    : linkTitle?.trim().toLowerCase() || 'source';
  const [terraformOpened, setTerraformOpened] = React.useState(false);
  const [editOpened, setEditOpened] = React.useState(false);
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const brandName = useBrandDisplayName();
  const deleteAlert = api.useDeleteAlert();

  const isTileAlert = alert.source === AlertSource.TILE;
  const resource = React.useMemo(
    () => ({
      type: 'alert' as const,
      id: alert._id,
      // No fallback to the saved search's name: the name only labels the
      // generated block, and the manifest the bulk export reads carries the
      // alert's own name, so a fallback here would make the two surfaces
      // disagree about what they call this alert.
      name: alert.name ?? undefined,
      // Raises the provider version floor in the "Provider setup" snippet.
      tileAlert: isTileAlert,
    }),
    [alert._id, alert.name, isTileAlert],
  );
  const snippets = useTerraformSnippets({
    resource,
    enabled: terraformOpened,
  });

  // The edit modal's threshold preview needs a range. Callers with a picked
  // one pass it; otherwise derive from the alert's interval, recomputed when
  // the modal opens so a long-lived list doesn't preview a stale window.
  const derivedRange = React.useMemo(
    () => intervalToDateRange(alert.interval),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editOpened refreshes the window
    [alert.interval, editOpened],
  );
  const previewRange = dateRange ?? derivedRange;

  // Eligibility comes from the shared predicate rather than an inline source
  // check, so this and the bulk export can't diverge on which alerts the
  // provider can actually model. The feature flag is checked here too because
  // this renders the panel directly rather than through the popover, which
  // does its own gating.
  // `unaddressableTile` comes from the server on both surfaces — this
  // response's `dashboard.tiles` holds only this alert's own tile, so the
  // client cannot tell whether a sibling tile shares its name.
  const canExport =
    IS_IAC_EXPORT_ENABLED &&
    isImportableAlert({
      source: alert.source,
      savedSearchId: alert.savedSearchId,
      unaddressableTile: alert.unaddressableTile,
    });

  const onDelete = React.useCallback(async () => {
    const confirmed = await confirm(deleteMessage, 'Delete', {
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteAlert.mutateAsync(alert._id);
      notifications.show({
        color: 'green',
        message: 'Alert deleted!',
        autoClose: 5000,
      });
      // The alerts list and the source-bound edit surfaces (saved search
      // modal / dashboard tile editor / SLO pages) all render this alert.
      queryClient.invalidateQueries({ queryKey: api.getAlertsQueryKey() });
      queryClient.invalidateQueries({ queryKey: ['saved-search'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      queryClient.invalidateQueries({ queryKey: ['slos'] });
      onDeleted?.();
    } catch (error) {
      console.error('Failed to delete alert:', error);
      notifications.show({
        color: 'red',
        message: `Something went wrong. Please contact ${brandName} team.`,
        autoClose: 5000,
      });
    }
  }, [
    alert._id,
    brandName,
    confirm,
    deleteAlert,
    deleteMessage,
    onDeleted,
    queryClient,
  ]);

  return (
    <>
      <Menu withArrow position="bottom-end">
        <Menu.Target>
          <ActionIcon
            variant="secondary"
            size="input-xs"
            aria-label={`Actions for ${name}`}
            data-testid={`alert-row-menu-${alert._id}`}
          >
            <IconDots size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {sloManaged ? (
            <Menu.Item
              component={Link}
              href={`/slos/${alert.sloId}/edit#alerts`}
              leftSection={<IconPencil size={16} />}
              data-testid={`alert-edit-${alert._id}`}
            >
              Edit in SLO
            </Menu.Item>
          ) : (
            !isSloAlert && (
              <Menu.Item
                leftSection={<IconPencil size={16} />}
                onClick={() => setEditOpened(true)}
                data-testid={`alert-edit-${alert._id}`}
              >
                Edit alert
              </Menu.Item>
            )
          )}
          {alertUrl && (
            <Menu.Item
              component={Link}
              href={alertUrl}
              leftSection={<IconExternalLink size={16} />}
            >
              Open {sourceLabel}
            </Menu.Item>
          )}
          {canExport && (
            <Menu.Item
              leftSection={<IconBrandTerraform size={16} />}
              onClick={() => setTerraformOpened(true)}
              data-testid={`terraform-menu-item-${alert._id}`}
            >
              Export to Terraform
            </Menu.Item>
          )}
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={onDelete}
            data-testid={`alert-delete-${alert._id}`}
          >
            Delete alert
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {/* Outside the dropdown, which unmounts on close. An inline alert owns
          its query, so it is edited through the full chart editor rather than
          the field-only modal. */}
      {alert.source === AlertSource.INLINE ? (
        <EditInlineAlertModal
          alert={alert}
          opened={editOpened}
          onClose={() => setEditOpened(false)}
          dateRange={previewRange}
        />
      ) : (
        <EditAlertModal
          alert={alert}
          opened={editOpened}
          onClose={() => setEditOpened(false)}
          dateRange={previewRange}
        />
      )}
      <Modal
        opened={terraformOpened}
        onClose={() => setTerraformOpened(false)}
        title="Export to Terraform"
        size="lg"
      >
        <TerraformHelperPanel snippets={snippets} />
      </Modal>
    </>
  );
}
