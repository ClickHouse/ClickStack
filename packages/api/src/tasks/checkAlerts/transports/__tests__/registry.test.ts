import { fromAny } from '@total-typescript/shoehorn';

import { AlertState } from '@/models/alert';
import { deliverToChannel } from '@/tasks/checkAlerts/transports';
import type { Message } from '@/tasks/checkAlerts/transports/types';

const message: Message = {
  hdxLink: 'https://example.test/alert',
  title: 'title',
  body: 'body',
  state: AlertState.ALERT,
  startTime: 0,
  endTime: 1,
  eventId: 'evt-1',
};

describe('deliverToChannel', () => {
  it('throws on an unknown channel type', async () => {
    await expect(
      deliverToChannel(fromAny({ type: 'carrier-pigeon' }), message, {}),
    ).rejects.toThrow('Unsupported channel type: carrier-pigeon');
  });

  it('throws on an unknown webhook service', async () => {
    await expect(
      deliverToChannel(
        fromAny({
          type: 'webhook',
          channel: { service: 'fax' },
        }),
        message,
        {},
      ),
    ).rejects.toThrow('Unsupported webhook service: fax');
  });
});
