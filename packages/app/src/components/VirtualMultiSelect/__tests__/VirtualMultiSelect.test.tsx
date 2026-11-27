import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VirtualMultiSelect } from '../VirtualMultiSelect';

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const renderSelect = (
  props: Partial<React.ComponentProps<typeof VirtualMultiSelect>> = {},
) => {
  const onChange = jest.fn();
  renderWithMantine(
    <VirtualMultiSelect
      data={['prod', 'staging']}
      values={[]}
      onChange={onChange}
      data-testid="select"
      {...props}
    />,
  );
  return { onChange, user: userEvent.setup() };
};

describe('VirtualMultiSelect "All" option', () => {
  it('is not offered unless enabled', async () => {
    const { user } = renderSelect();

    await user.click(screen.getByRole('textbox'));

    expect(screen.queryByText('All')).toBeNull();
  });

  it('selects "All" from the dropdown', async () => {
    const { onChange, user } = renderSelect({ enableAllOption: true });

    await user.click(screen.getByRole('textbox'));
    await user.click(await screen.findByText('All'));

    expect(onChange).toHaveBeenCalledWith({ all: true });
  });

  it('shows "All" as a pill that clears the selection when removed', async () => {
    const { onChange, user } = renderSelect({
      enableAllOption: true,
      isAllOptionSelected: true,
    });

    const pill = within(screen.getByTestId('select'))
      .getByText('All')
      .closest<HTMLElement>('.mantine-Pill-root');
    if (!pill) throw new Error('expected an "All" pill');
    await user.click(within(pill).getByRole('button', { hidden: true }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
