import { ReactNode } from 'react';
import { Group, Stack, Text, Title } from '@mantine/core';

import styles from './TeamSettings.module.scss';

/** A titled group inside a settings page, for pages that hold more than one thing. */
export default function SettingsBlock({
  id,
  title,
  description,
  actions,
  children,
}: {
  id?: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap="sm" id={id}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Stack gap={2}>
          <Title order={3} size="sm" fw={500}>
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </Stack>
        {actions}
      </Group>
      {children}
    </Stack>
  );
}

/** One setting in a bordered list: what it is on the left, its control on the right. */
export function SettingsRow({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.row} id={id}>
      <Stack gap={2}>
        <Title order={3} size="sm" fw={500}>
          {title}
        </Title>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </Stack>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}
