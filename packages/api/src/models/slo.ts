import type { SloDefinition, SloStatus } from '@hyperdx/common-utils/dist/slo';
import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export interface ISlo extends Omit<SloDefinition, 'source'> {
  _id: ObjectId;
  team: ObjectId;
  source: ObjectId;
  /**
   * Latest snapshot, refreshed in the background and stored with the
   * definition so lists and the detail page read it without querying.
   */
  status?: SloStatus | null;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SloSchema = new Schema<ISlo>(
  {
    version: { type: Number, required: true, default: 1 },
    name: { type: String, required: true },
    description: { type: String, required: false },
    tags: { type: [String], default: [] },
    // Immutable: `team` pins an SLO to its owning tenant.
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      immutable: true,
    },
    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Source',
      required: true,
    },
    // Validated by SloInputSchema at the API boundary.
    indicator: { type: Schema.Types.Mixed, required: true },
    target: { type: Number, required: true },
    window: { type: String, required: true },
    // Expression whose values each get their own numbers and alert.
    groupBy: { type: String, required: false },
    status: { type: Schema.Types.Mixed, required: false },
    // Immutable: ownership attribution is set once at creation.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      immutable: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  { timestamps: true },
);

SloSchema.index({ team: 1, name: 1 });
// The status refresh picks the stalest snapshots first.
SloSchema.index({ 'status.evaluatedAt': 1 });

export default mongoose.model<ISlo>('Slo', SloSchema);
