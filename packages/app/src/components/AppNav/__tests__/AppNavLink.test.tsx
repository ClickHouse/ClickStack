import Link from 'next/link';
import { MantineProvider } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { render, screen } from '@testing-library/react';

import { BRAND_DISPLAY_NAME } from '@/brand';
import {
  AppNavCollapsedLogo,
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

describe('AppNavCollapsedLogo', () => {
  it('names the logo link with the brand name', () => {
    render(
      <MantineProvider>
        <Link href="/search">
          <AppNavCollapsedLogo />
        </Link>
      </MantineProvider>,
    );
    expect(
      screen.getByRole('link', { name: BRAND_DISPLAY_NAME }),
    ).toBeInTheDocument();
  });
});
