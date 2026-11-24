import Link from 'next/link';
import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import { ActionIcon, Menu } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDots, IconPencil, IconTrash } from '@tabler/icons-react';

import { useDeleteSlo } from '@/slo';
import { useConfirm } from '@/useConfirm';
import { getApiErrorMessage } from '@/utils/apiErrors';

export function SloRowMenu({ slo }: { slo: SloApiResponse }) {
  const confirm = useConfirm();
  const deleteSlo = useDeleteSlo();

  const handleDelete = async () => {
    if (
      !(await confirm(
        <>
          Delete <b>{slo.name}</b>?
          {slo.alerts.fastBurn || slo.alerts.slowBurn
            ? ' Its burn alerts are deleted too.'
            : ''}{' '}
          This is <b>not reversible</b>.
        </>,
        'Delete',
        { variant: 'danger' },
      ))
    ) {
      return;
    }
    try {
      await deleteSlo.mutateAsync(slo.id);
      notifications.show({ color: 'green', message: `Deleted ${slo.name}` });
    } catch (e) {
      notifications.show({
        color: 'red',
        message: await getApiErrorMessage(e, 'Could not delete the SLO'),
      });
    }
  };

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          aria-label={`Actions for ${slo.name}`}
          data-testid={`slo-row-menu-${slo.id}`}
          onClick={e => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={e => e.stopPropagation()}>
        <Menu.Item
          component={Link}
          href={`/slos/${slo.id}/edit`}
          leftSection={<IconPencil size={14} />}
        >
          Edit
        </Menu.Item>
        {/* A copy starts without its alerts, as a duplicated tile does. */}
        <Menu.Item
          component={Link}
          href={`/slos/new?duplicate=${slo.id}`}
          leftSection={<IconCopy size={14} />}
          data-testid="slo-duplicate"
        >
          Duplicate
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={handleDelete}
          data-testid="slo-delete"
        >
          Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
