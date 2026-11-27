import { MantineProvider } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { render, screen } from '@testing-library/react';

import {
  AppNavContext,
  AppNavLink,
} from '@/components/AppNav/AppNav.components';

const renderLink = (isCollapsed: boolean) =>
  render(
    <MantineProvider>
      <AppNavContext value={{ isCollapsed, pathname: '/search' }}>
        <AppNavLink label="Search" href="/search" icon={<IconSearch />} />
      </AppNavContext>
    </MantineProvider>,
  );

describe('AppNavLink', () => {
  it('names the link with its label when the nav is expanded', () => {
    renderLink(false);
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument();
  });

  it('keeps the accessible name when the nav is collapsed to icons', () => {
    renderLink(true);
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument();
  });
});
