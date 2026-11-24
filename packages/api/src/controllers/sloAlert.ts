import {
  getSloAlertInterval,
  getSloAlertTarget,
  SLO_BURN_CONDITIONS,
  type SloAlerts,
  type SloApiResponse,
} from '@hyperdx/common-utils/dist/slo';
import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { validateAlertChannels } from '@/controllers/alerts';
import type { ObjectId } from '@/models';
import Alert, { AlertSource, AlertState } from '@/models/alert';
import type { ISlo } from '@/models/slo';

/** Checked before the SLO is saved, so an invalid alert never half-saves. */
export async function validateSloAlerts(
  teamId: string,
  alerts: SloAlerts | null | undefined,
) {
  for (const { rule } of SLO_BURN_CONDITIONS) {
    const target = getSloAlertTarget(alerts, rule);
    if (target) {
      await validateAlertChannels(
        new mongoose.Types.ObjectId(teamId),
        target.channels,
      );
    }
  }
}

/**
 * Keeps the Alert documents an SLO owns in line with its burn alerts: one
 * per alert that is on, created or updated with its channels, and deleted
 * when it is off. The alert engine schedules, evaluates and notifies from
 * those documents. Their value is how close the rule's condition is to
 * holding (getSloBurnSeverity), so they fire at 1.
 */
export async function syncSloAlerts(
  slo: Pick<ISlo, '_id' | 'team' | 'name' | 'tags' | 'alerts'>,
  userId?: string,
) {
  for (const { rule } of SLO_BURN_CONDITIONS) {
    const owner = {
      team: slo.team,
      slo: slo._id,
      source: AlertSource.SLO,
      sloRule: rule,
    };
    const target = getSloAlertTarget(slo.alerts, rule);
    if (!target) {
      await Alert.deleteMany(owner);
      continue;
    }
    await Alert.findOneAndUpdate(
      owner,
      {
        $set: {
          ...owner,
          displayName: slo.name,
          tags: slo.tags,
          // `channels` is canonical; `channel` mirrors the first, as for
          // every alert.
          channel: target.channels[0],
          channels: target.channels,
          interval: getSloAlertInterval(rule),
          threshold: 1,
          thresholdType: AlertThresholdType.ABOVE,
        },
        $setOnInsert: { state: AlertState.OK, createdBy: userId },
      },
      { upsert: true },
    );
  }
}

export async function deleteSloAlerts(teamId: string, sloId: string) {
  await Alert.deleteMany({ team: teamId, slo: sloId, source: AlertSource.SLO });
}

/**
 * The burn alerts each SLO owns, keyed by SLO id, with their current state
 * and the end of a silence that is still in effect.
 */
export async function getSloAlerts(
  teamId: string | ObjectId,
  sloIds: ObjectId[],
  now = new Date(),
): Promise<Map<string, SloApiResponse['alertStates']>> {
  const alerts = await Alert.find(
    { team: teamId, source: AlertSource.SLO, slo: { $in: sloIds } },
    { slo: 1, sloRule: 1, state: 1, silenced: 1 },
  ).lean();
  const bySlo = new Map<string, SloApiResponse['alertStates']>();
  for (const alert of alerts) {
    const until = alert.silenced?.until;
    const status = {
      id: alert._id.toString(),
      state: alert.state,
      silencedUntil: until != null && until > now ? until.toISOString() : null,
    };
    const states = bySlo.get(`${alert.slo}`) ?? {};
    bySlo.set(
      `${alert.slo}`,
      alert.sloRule === 'slowBurn'
        ? { ...states, slowBurn: status }
        : { ...states, fastBurn: status },
    );
  }
  return bySlo;
}
