import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  AppNavContext,
  AppNavUserMenu,
} from '@/components/AppNav/AppNav.components';

const renderUserMenu = (isCollapsed: boolean) =>
  render(
    <MantineProvider>
      <AppNavContext value={{ isCollapsed, pathname: '/search' }}>
        <AppNavUserMenu userName="Jane Doe" teamName="Acme" />
      </AppNavContext>
    </MantineProvider>,
  );

describe('AppNavUserMenu', () => {
  it.each([
    ['expanded', false],
    ['collapsed', true],
  ])(
    'opens from the keyboard when the nav is %s',
    async (_state, isCollapsed) => {
      const user = userEvent.setup();
      renderUserMenu(isCollapsed);

      await user.tab();
      const trigger = screen.getByRole('button', { name: /Jane Doe/ });
      expect(trigger).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(
        await screen.findByRole('menuitem', { name: 'User preferences' }),
      ).toBeInTheDocument();
    },
  );
});
