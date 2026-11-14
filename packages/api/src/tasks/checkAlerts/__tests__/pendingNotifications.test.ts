import { getNextAttemptAt } from '@/tasks/checkAlerts/pendingNotifications';

describe('getNextAttemptAt', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const minutesAfterNow = (attempts: number) =>
    (getNextAttemptAt(now, attempts).getTime() - now.getTime()) / 60_000;

  it('waits 1 minute after the first failure and doubles after each one', () => {
    expect([1, 2, 3, 4, 5].map(minutesAfterNow)).toEqual([1, 2, 4, 8, 16]);
  });

  it('waits at most 30 minutes', () => {
    expect(minutesAfterNow(6)).toBe(30);
    expect(minutesAfterNow(50)).toBe(30);
  });
});
