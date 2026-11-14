import { AlertErrorType } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import ms from 'ms';

import { AlertState, IAlert } from '@/models/alert';
import { IPendingNotification } from '@/models/pendingNotification';
import { IWebhook } from '@/models/webhook';
import {
  deliverNotification,
  NotificationJob,
} from '@/tasks/checkAlerts/notifications';
import type { AlertProvider } from '@/tasks/checkAlerts/providers';
import type { Message } from '@/tasks/checkAlerts/transports';
import { serializeErrorWithCause } from '@/utils/errors';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

/** How long a failed resolve keeps being sent again. */
export const RESEND_WINDOW_MS = ms('24h');
const BASE_BACKOFF_MS = ms('1m');
const MAX_BACKOFF_MS = ms('30m');
// Longer than the re-send window, so the TTL only removes records the task
// never gets to, such as those of a deleted alert.
const RECORD_TTL_MS = RESEND_WINDOW_MS + ms('7d');

export type ResendOutcome =
  | 'delivered'
  | 'failed'
  | 'expired'
  | 'superseded'
  | 'webhook_missing'
  | 'skipped_silenced';

const notificationResendsCounter = getCounter(
  'hyperdx.alerts.notification_resends',
  {
    description:
      'Count of attempts to send a failed alert resolve again, labeled by outcome (delivered, failed, expired, superseded, webhook_missing, skipped_silenced).',
  },
);

/** 1m after the first failure, doubling up to 30m. */
export const getNextAttemptAt = (now: Date, attempts: number): Date =>
  new Date(
    now.getTime() +
      Math.min(
        BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1),
        MAX_BACKOFF_MS,
      ),
  );

/**
 * The record to store for a resolve whose delivery failed, or undefined when
 * the job cannot be sent again from a record (it is not a webhook delivery, or
 * it has no alert or team).
 */
export const toPendingNotification = (
  job: NotificationJob,
  windowStart: Date,
  now: Date,
): IPendingNotification | undefined => {
  if (
    job.populatedChannel.type !== 'webhook' ||
    job.alertId == null ||
    job.teamId == null
  ) {
    return undefined;
  }
  return {
    eventId: job.eventId,
    team: new mongoose.Types.ObjectId(job.teamId),
    alert: new mongoose.Types.ObjectId(job.alertId),
    group: job.group ?? '',
    webhook: new mongoose.Types.ObjectId(
      job.populatedChannel.channel._id.toString(),
    ),
    message: JSON.stringify(job.message),
    windowStart,
    firstFailedAt: now,
    attempts: 1,
    nextAttemptAt: getNextAttemptAt(now, 1),
    expireAt: new Date(now.getTime() + RECORD_TTL_MS),
  };
};

const resendOne = async ({
  alert,
  getPreviousState,
  now,
  provider,
  record,
  teamWebhooksById,
}: {
  alert: IAlert;
  getPreviousState: (group: string) => AlertState | undefined;
  now: Date;
  provider: AlertProvider;
  record: IPendingNotification;
  teamWebhooksById: Map<string, IWebhook>;
}): Promise<ResendOutcome | undefined> => {
  // The group fired again after the failed resolve, and that ALERT has gone
  // out. A late resolve would close the new incident.
  if (getPreviousState(record.group) === AlertState.ALERT) {
    await provider.deletePendingNotification(record.eventId);
    return 'superseded';
  }

  const webhook = teamWebhooksById.get(record.webhook.toString());
  if (webhook == null) {
    await provider.deletePendingNotification(record.eventId);
    return 'webhook_missing';
  }

  if (now.getTime() - record.firstFailedAt.getTime() >= RESEND_WINDOW_MS) {
    await provider.appendAlertErrorHistory(alert.id, record.windowStart, {
      timestamp: now,
      type: AlertErrorType.WEBHOOK_ERROR,
      message: `Resolve notification to webhook "${webhook.name}" was not delivered within ${ms(RESEND_WINDOW_MS, { long: true })} (${record.attempts} ${record.attempts === 1 ? 'attempt' : 'attempts'}). The incident may still be open in the receiving tool.`,
    });
    await provider.deletePendingNotification(record.eventId);
    return 'expired';
  }

  if (record.nextAttemptAt.getTime() > now.getTime()) {
    return undefined;
  }

  if ((alert.silenced?.until?.getTime() ?? 0) > now.getTime()) {
    return 'skipped_silenced';
  }

  const message: Message = JSON.parse(record.message);
  try {
    await deliverNotification({
      eventId: record.eventId,
      alertId: alert.id,
      teamId: record.team.toString(),
      group: record.group,
      populatedChannel: { type: 'webhook', channel: webhook },
      message,
    });
  } catch (e) {
    const attempts = record.attempts + 1;
    logger.warn(
      {
        alertId: alert.id,
        eventId: record.eventId,
        webhookId: webhook._id.toString(),
        attempts,
        error: serializeErrorWithCause(e),
      },
      'Failed to send alert resolve again',
    );
    await provider.updatePendingNotification(record.eventId, {
      attempts,
      nextAttemptAt: getNextAttemptAt(now, attempts),
    });
    return 'failed';
  }
  await provider.deletePendingNotification(record.eventId);
  logger.info(
    {
      alertId: alert.id,
      eventId: record.eventId,
      webhookId: webhook._id.toString(),
      attempts: record.attempts + 1,
    },
    'Sent alert resolve again after an earlier delivery failed',
  );
  return 'delivered';
};

/**
 * Send the alert's failed resolves again, ahead of its evaluation so a resolve
 * still reaches the receiver before any ALERT this evaluation sends. Never
 * throws: a failure here must not stop the evaluation.
 */
export const resendPendingNotifications = async ({
  alert,
  getPreviousState,
  now,
  pending,
  provider,
  teamWebhooksById,
}: {
  alert: IAlert;
  /** The state of the group's latest history row. */
  getPreviousState: (group: string) => AlertState | undefined;
  now: Date;
  pending: IPendingNotification[];
  provider: AlertProvider;
  teamWebhooksById: Map<string, IWebhook>;
}): Promise<void> => {
  for (const record of pending) {
    try {
      const outcome = await resendOne({
        alert,
        getPreviousState,
        now,
        provider,
        record,
        teamWebhooksById,
      });
      if (outcome != null) {
        notificationResendsCounter.add(1, { outcome });
      }
      if (outcome === 'expired') {
        logger.error(
          {
            alertId: alert.id,
            eventId: record.eventId,
            webhookId: record.webhook.toString(),
            attempts: record.attempts,
          },
          'Gave up sending alert resolve again',
        );
      }
    } catch (e) {
      logger.error(
        {
          alertId: alert.id,
          eventId: record.eventId,
          error: serializeErrorWithCause(e),
        },
        'Failed to process pending alert notification',
      );
    }
  }
};
