import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

/**
 * An alert notification whose delivery failed and that the check-alerts task
 * sends again on later ticks. Only resolves are stored: a firing alert sends
 * ALERT again on every evaluation, but a resolve is sent once.
 */
export interface IPendingNotification {
  /** Idempotency key of the notification: hash of alert, channel and group. */
  eventId: string;
  team: ObjectId;
  alert: ObjectId;
  /** Group key of a group-by alert; '' for an alert without groups. */
  group: string;
  webhook: ObjectId;
  /**
   * The rendered message as JSON. A string because group-by column names can
   * contain dots, which Mongo would read as nested paths in a key.
   */
  message: string;
  /** Evaluation window whose ERROR history row records the failure. */
  windowStart: Date;
  firstFailedAt: Date;
  /** Failed deliveries so far, including the original one. */
  attempts: number;
  nextAttemptAt: Date;
  /** Removes records nothing ever cleans up, e.g. for a deleted alert. */
  expireAt: Date;
}

const PendingNotificationSchema = new Schema<IPendingNotification>(
  {
    eventId: { type: String, required: true },
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    alert: { type: Schema.Types.ObjectId, ref: 'Alert', required: true },
    group: { type: String, default: '' },
    webhook: { type: Schema.Types.ObjectId, ref: 'Webhook', required: true },
    message: { type: String, required: true },
    windowStart: { type: Date, required: true },
    firstFailedAt: { type: Date, required: true },
    attempts: { type: Number, required: true },
    nextAttemptAt: { type: Date, required: true },
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
);

PendingNotificationSchema.index({ eventId: 1 }, { unique: true });
PendingNotificationSchema.index({ alert: 1 });
PendingNotificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IPendingNotification>(
  'PendingNotification',
  PendingNotificationSchema,
);
