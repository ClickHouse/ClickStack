import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import {
  AppNavContext,
  AppNavHelpMenu,
} from '@/components/AppNav/AppNav.components';

// The closed What's new drawer still mounts and reads the router's basePath.
jest.mock('next/router', () => ({
  useRouter: () => ({ basePath: '' }),
}));

const renderHelpMenu = (isCollapsed: boolean, whatsNewVersion?: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <AppNavContext value={{ isCollapsed, pathname: '/search' }}>
          <AppNavHelpMenu whatsNewVersion={whatsNewVersion} />
        </AppNavContext>
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('AppNavHelpMenu', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('names the Help button when the nav is expanded', () => {
    renderHelpMenu(false);
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('keeps the Help button name when the nav is collapsed to icons', () => {
    renderHelpMenu(true);
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('keeps the Help name next to the sparkle label when collapsed', async () => {
    // A browser that has never seen the release notes gets the sparkle, which
    // adds its own label to the button's name.
    renderHelpMenu(true, '2.37.0');
    expect(await screen.findByTestId('whats-new-sparkle')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New updates available Help' }),
    ).toBeInTheDocument();
  });
});
