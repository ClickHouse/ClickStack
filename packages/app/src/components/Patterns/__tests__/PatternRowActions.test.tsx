import { fireEvent, screen } from '@testing-library/react';

import { parsePatternFilter } from '@/components/Patterns/patternFilter';
import { PatternRowActions } from '@/components/Patterns/PatternRowActions';

describe('PatternRowActions', () => {
  it('filters for or excludes the row pattern', () => {
    const onFilter = jest.fn();
    renderWithMantine(
      <PatternRowActions
        template="GetCartAsync called with userId <*>"
        valueExpression="Body"
        onFilter={onFilter}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Filter for this pattern' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Exclude this pattern' }),
    );

    expect(
      onFilter.mock.calls.map(([filter, action]) => [
        parsePatternFilter(filter),
        action,
      ]),
    ).toEqual([
      [
        expect.objectContaining({
          valueExpression: 'Body',
          template: 'GetCartAsync called with userId <*>',
          action: 'include',
        }),
        'include',
      ],
      [
        expect.objectContaining({
          valueExpression: 'Body',
          template: 'GetCartAsync called with userId <*>',
          action: 'exclude',
        }),
        'exclude',
      ],
    ]);
  });

  it('renders nothing for a template too long to filter on', () => {
    renderWithMantine(
      <PatternRowActions
        template={'word '.repeat(1000)}
        valueExpression="Body"
        onFilter={jest.fn()}
      />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
