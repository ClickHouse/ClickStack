import { Badge } from '@clickhouse/click-ui';
import { Tooltip } from '@mantine/core';

import {
  type SloDisplayState,
  sloStateDescription,
  sloStateLabel,
} from './sloUtils';

export function SloStateBadge({ state }: { state: SloDisplayState }) {
  const label = sloStateLabel(state);
  const badge = (() => {
    switch (state) {
      case 'breached':
        return <Badge text={label} state="danger" type="solid" />;
      case 'burning':
        return <Badge text={label} state="warning" type="solid" />;
      case 'error':
        return <Badge text={label} state="danger" />;
      case 'healthy':
        return <Badge text={label} state="success" />;
      case 'no_data':
      case 'pending':
        return <Badge text={label} state="neutral" />;
    }
  })();
  return (
    <Tooltip label={sloStateDescription(state)} openDelay={400} withArrow>
      <span data-testid={`slo-state-${state}`}>{badge}</span>
    </Tooltip>
  );
}
