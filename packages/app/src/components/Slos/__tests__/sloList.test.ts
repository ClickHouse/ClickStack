import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';
import { AlertState } from '@hyperdx/common-utils/dist/types';

import { compareSlos } from '@/components/Slos/sloListSort';
import { getAlertEpisodes } from '@/components/Slos/SloRecentFirings';

/** An SLO with only what the sort reads; no status means no update yet. */
const slo = (
  name: string,
  status?: { sli: number; budgetRemaining: number; burnRate: number },
): SloApiResponse => ({
  id: name,
  version: 1,
  name,
  tags: [],
  source: 'source-1',
  indicator: {
    template: 'availability',
    eligible: { where: '', whereLanguage: 'sql' },
    good: "StatusCode != 'Error'",
  },
  target: 99,
  window: '7d',
  alerts: {},
  alertStates: {},
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  status: status && {
    eligible: 1000,
    good: Math.round(status.sli * 1000),
    bad: 1000 - Math.round(status.sli * 1000),
    sli: status.sli,
    errorBudget: 10,
    budgetRemaining: status.budgetRemaining,
    budgetRemainingEvents: 0,
    burn: [
      {
        rule: 'fastBurn',
        window: '1h',
        shortWindow: '5m',
        budgetSpent: 0.02,
        minEvents: 20,
        threshold: 3.36,
        eligible: 100,
        bad: 1,
        burnRate: status.burnRate,
        shortBurnRate: status.burnRate,
      },
    ],
    state: status.budgetRemaining <= 0 ? 'breached' : 'healthy',
    evaluatedAt: '2026-11-01T00:00:00.000Z',
    windowStart: '2026-10-25T00:00:00.000Z',
    windowEnd: '2026-11-01T00:00:00.000Z',
    durationMs: 0,
    rowsRead: 0,
  },
});

describe('SLO list sort', () => {
  const slos = [
    slo('b', { sli: 0.999, budgetRemaining: 0.9, burnRate: 0.5 }),
    slo('pending'),
    slo('a', { sli: 0.95, budgetRemaining: -1, burnRate: 30 }),
    slo('c', { sli: 0.998, budgetRemaining: 0.4, burnRate: 4 }),
  ];
  const sorted = (sort: Parameters<typeof compareSlos>[0]) =>
    [...slos].sort(compareSlos(sort)).map(s => s.name);

  it('puts SLOs without numbers last', () => {
    expect(sorted('sli')).toEqual(['a', 'c', 'b', 'pending']);
    expect(sorted('budget')).toEqual(['a', 'c', 'b', 'pending']);
    expect(sorted('burn')).toEqual(['a', 'c', 'b', 'pending']);
  });

  it('sorts by name, or worst first', () => {
    expect(sorted('name')).toEqual(['a', 'b', 'c', 'pending']);
    expect(sorted('worst')[0]).toBe('a');
  });
});

describe('SLO alert firings', () => {
  const at = (minutes: number) =>
    new Date(Date.UTC(2026, 10, 20, 0, minutes)).toISOString();
  const change = (minutes: number, state: AlertState) => ({
    createdAt: at(minutes),
    state,
  });

  it('pairs each firing with the next recovery, newest first', () => {
    expect(
      getAlertEpisodes([
        change(0, AlertState.ALERT),
        change(30, AlertState.OK),
        change(60, AlertState.ALERT),
        // Repeated firing changes extend the open episode.
        change(65, AlertState.ALERT),
      ]),
    ).toEqual([{ start: at(60) }, { start: at(0), end: at(30) }]);
  });

  it('ignores a recovery without a firing before it', () => {
    expect(getAlertEpisodes([change(5, AlertState.OK)])).toEqual([]);
  });
});
