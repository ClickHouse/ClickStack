import React from 'react';
import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import { fireEvent, screen } from '@testing-library/react';

import { DashboardLiveButton } from '@/components/DashboardLiveButton';

const OPTIONS = [
  Granularity.ThirtySecond,
  Granularity.OneMinute,
  Granularity.FiveMinute,
];

function renderButton(
  props: Partial<React.ComponentProps<typeof DashboardLiveButton>> = {},
) {
  const onToggleLive = jest.fn();
  const onRefreshIntervalChange = jest.fn();
  renderWithMantine(
    <DashboardLiveButton
      isLive={false}
      onToggleLive={onToggleLive}
      refreshInterval={Granularity.FiveMinute}
      isAutoRefreshInterval
      defaultRefreshInterval={Granularity.FiveMinute}
      refreshIntervalOptions={OPTIONS}
      onRefreshIntervalChange={onRefreshIntervalChange}
      {...props}
    />,
  );
  return { onToggleLive, onRefreshIntervalChange };
}

async function openMenu() {
  fireEvent.click(screen.getByTestId('dashboard-refresh-interval-button'));
  await screen.findByTestId('dashboard-refresh-interval-menu');
}

describe('DashboardLiveButton', () => {
  it('toggles live mode', () => {
    const { onToggleLive } = renderButton();

    fireEvent.click(screen.getByTestId('dashboard-live-button'));

    expect(onToggleLive).toHaveBeenCalledTimes(1);
  });

  it('shows auto as the first, checked item', async () => {
    renderButton();

    expect(
      screen.getByTestId('dashboard-refresh-interval-button'),
    ).toHaveTextContent('Auto (5m)');

    await openMenu();
    const items = screen.getAllByRole('menuitem', { hidden: true });
    expect(items.map(item => item.textContent)).toEqual([
      'Auto (5m)',
      '30s',
      '1m',
      '5m',
    ]);
    expect(items[0]).toHaveAttribute('data-checked', 'true');
    expect(items[3]).toHaveAttribute('data-checked', 'false');
  });

  it('checks a fixed interval equal to auto without checking auto', async () => {
    renderButton({ isAutoRefreshInterval: false });

    expect(
      screen.getByTestId('dashboard-refresh-interval-button'),
    ).toHaveTextContent(/^5m$/);

    await openMenu();
    expect(
      screen.getByRole('menuitem', { name: 'Auto (5m)', hidden: true }),
    ).toHaveAttribute('data-checked', 'false');
    expect(
      screen.getByRole('menuitem', { name: '5m', hidden: true }),
    ).toHaveAttribute('data-checked', 'true');
  });

  it('selects a fixed interval or auto', async () => {
    const { onRefreshIntervalChange } = renderButton();

    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '1m', hidden: true }));
    expect(onRefreshIntervalChange).toHaveBeenLastCalledWith(
      Granularity.OneMinute,
    );

    await openMenu();
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Auto (5m)', hidden: true }),
    );
    expect(onRefreshIntervalChange).toHaveBeenLastCalledWith(undefined);
  });

  it('offers only auto when there are no fixed intervals', async () => {
    renderButton({
      refreshInterval: Granularity.FifteenSecond,
      defaultRefreshInterval: Granularity.FifteenSecond,
      refreshIntervalOptions: [],
    });

    await openMenu();
    expect(
      screen
        .getAllByRole('menuitem', { hidden: true })
        .map(item => item.textContent),
    ).toEqual(['Auto (15s)']);
  });
});
