import React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ColumnsPopover } from '@/components/SearchResultsToolbar/ColumnsPopover';

const confirm = jest.fn();
jest.mock('@/useConfirm', () => ({ useConfirm: () => confirm }));

jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

function renderPopover(
  props: Partial<React.ComponentProps<typeof ColumnsPopover>> = {},
) {
  const onApply = jest.fn();
  render(
    <MantineProvider>
      <ColumnsPopover
        value="Timestamp, Body"
        defaultValue="Timestamp, ServiceName, Body"
        fieldOptions={['Body', 'ServiceName', 'SeverityText', 'Timestamp']}
        knownColumns={new Set(['Body', 'ServiceName', 'Timestamp'])}
        onApply={onApply}
        tableConnection={undefined}
        {...props}
      />
    </MantineProvider>,
  );
  return { onApply };
}

const openPopover = () =>
  fireEvent.click(screen.getByTestId('search-columns-button'));

const closePopover = () =>
  fireEvent.click(screen.getByTestId('search-columns-button'));

describe('ColumnsPopover', () => {
  beforeEach(() => {
    confirm.mockReset();
    confirm.mockResolvedValue(true);
  });

  it('shows the column count and falls back to the default SELECT', () => {
    renderPopover({ value: '' });
    expect(screen.getByTestId('search-columns-button')).toHaveAccessibleName(
      'Columns 3 fields',
    );
  });

  it('offers a drag handle for each column', async () => {
    renderPopover();
    openPopover();
    expect(
      await screen.findByLabelText('Reorder Timestamp'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Reorder Body')).toBeInTheDocument();
  });

  it('stays empty after the last column is removed', async () => {
    const { onApply } = renderPopover({
      value: 'Timestamp',
      defaultValue: 'Timestamp, ServiceName, Body',
    });
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Timestamp'));
    expect(screen.getByText('No columns selected.')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Remove ServiceName'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('search-columns-button-apply')).toBeDisabled();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText('Search columns');
    fireEvent.change(input, { target: { value: 'Body' } });
    fireEvent.click(screen.getByTestId('search-columns-add-button'));
    expect(screen.getByLabelText('Remove Body')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Remove ServiceName'),
    ).not.toBeInTheDocument();
  });

  it('keeps a backtick-quoted name when another column is removed', async () => {
    const { onApply } = renderPopover({
      value: 'Timestamp, `a,b`, Body',
      defaultValue: 'Timestamp',
    });
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    expect(screen.getByLabelText('Remove `a,b`')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp, `a,b`', ['Body']);
  });

  it('removes one copy when the same column is listed twice', async () => {
    const { onApply } = renderPopover({
      value: 'Body, Body',
      defaultValue: 'Timestamp',
    });
    openPopover();
    const removes = await screen.findAllByLabelText('Remove Body');
    fireEvent.click(removes[0]);
    expect(screen.getAllByLabelText('Remove Body')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Body', []);
  });

  it('does not add a map key that is already selected under its alias', async () => {
    const column = `LogAttributes['x'] AS "x"`;
    renderPopover({
      value: column,
      defaultValue: 'Timestamp',
      fieldOptions: ["LogAttributes['x']", 'Body'],
      knownColumns: new Set(['Body']),
    });
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, { target: { value: "LogAttributes['x']" } });
    expect(
      screen.queryByRole('option', { name: "LogAttributes['x']" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-add-button'));
    expect(screen.getAllByLabelText(`Remove ${column}`)).toHaveLength(1);
  });

  it('removes a column and reports it on apply', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp', ['Body']);
  });

  it('leaves a typed map subscript unchanged', async () => {
    renderPopover({
      fieldOptions: ["LogAttributes['region']"],
    });
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, {
      target: { value: "LogAttributes['region']" },
    });
    expect(input).toHaveValue("LogAttributes['region']");
  });

  it('adds a picked map key with its alias and clears the input', async () => {
    renderPopover({
      fieldOptions: ["LogAttributes['ads.consent_given']"],
    });
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, {
      target: { value: "LogAttributes['ads" },
    });
    fireEvent.click(
      await screen.findByText("LogAttributes['ads.consent_given']"),
    );
    expect(input).toHaveValue('');
    expect(
      screen.getByText(
        `LogAttributes['ads.consent_given'] AS "ads.consent_given"`,
      ),
    ).toBeInTheDocument();
  });

  it('adds a column as soon as a suggestion is picked', async () => {
    const { onApply } = renderPopover();
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, { target: { value: 'Severity' } });
    fireEvent.click(await screen.findByText('SeverityText'));
    expect(input).toHaveValue('');
    expect(screen.getByLabelText('Remove SeverityText')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('Timestamp, Body, SeverityText', []);
  });

  it('adds a typed expression such as an alias', async () => {
    const { onApply } = renderPopover();
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, {
      target: { value: 'upper(Body) as message' },
    });
    fireEvent.click(screen.getByTestId('search-columns-add-button'));
    expect(input).toHaveValue('');
    expect(
      screen.getByLabelText('Remove upper(Body) as message'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith(
      'Timestamp, Body, upper(Body) as message',
      [],
    );
  });

  describe('editing a column in place', () => {
    const tz = `LogAttributes['tz'] AS "tz"`;
    const openWithTz = async () => {
      const rendered = renderPopover({
        value: `Timestamp, ${tz}`,
        defaultValue: 'Timestamp',
      });
      openPopover();
      fireEvent.click(await screen.findByLabelText(`Edit ${tz}`));
      return {
        ...rendered,
        input: screen.getByTestId('search-columns-edit-input'),
      };
    };

    it('renames an alias on Enter and reports the old item as removed', async () => {
      const { onApply, input } = await openWithTz();
      expect(input).toHaveValue(tz);
      fireEvent.change(input, {
        target: { value: `LogAttributes['tz'] AS "timezone"` },
      });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(
        screen.queryByTestId('search-columns-edit-input'),
      ).not.toBeInTheDocument();
      expect(
        screen.getByLabelText(`Remove LogAttributes['tz'] AS "timezone"`),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('search-columns-button-apply'));
      expect(onApply).toHaveBeenCalledWith(
        `Timestamp, LogAttributes['tz'] AS "timezone"`,
        [tz],
      );
    });

    it('edits in a wrapping field and drops pasted line breaks', async () => {
      const { onApply, input } = await openWithTz();
      expect(input.tagName).toBe('TEXTAREA');
      fireEvent.change(input, {
        target: { value: `LogAttributes['tz']\n  AS "timezone"` },
      });
      expect(input).toHaveValue(`LogAttributes['tz'] AS "timezone"`);
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.click(screen.getByTestId('search-columns-button-apply'));
      expect(onApply).toHaveBeenCalledWith(
        `Timestamp, LogAttributes['tz'] AS "timezone"`,
        [tz],
      );
    });

    it('commits on blur', async () => {
      const { input } = await openWithTz();
      fireEvent.change(input, {
        target: { value: `LogAttributes['tz'] AS "zone"` },
      });
      fireEvent.blur(input);
      expect(
        screen.getByLabelText(`Remove LogAttributes['tz'] AS "zone"`),
      ).toBeInTheDocument();
    });

    it('starts editing when the column text is clicked', async () => {
      renderPopover();
      openPopover();
      fireEvent.click(await screen.findByText('Body'));
      expect(screen.getByTestId('search-columns-edit-input')).toHaveValue(
        'Body',
      );
    });

    it('cancels on Escape without closing the popover or asking to discard', async () => {
      const { input } = await openWithTz();
      fireEvent.change(input, {
        target: { value: `LogAttributes['tz'] AS "timezone"` },
      });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.getByLabelText(`Remove ${tz}`)).toBeInTheDocument();
      expect(confirm).not.toHaveBeenCalled();
      expect(
        screen.getByTestId('search-columns-button-popover'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('search-columns-edit-input'),
      ).not.toBeInTheDocument();
    });

    it('reverts an empty value instead of removing the column', async () => {
      const { input } = await openWithTz();
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.blur(input);
      expect(screen.getByLabelText(`Remove ${tz}`)).toBeInTheDocument();
    });
  });

  it('resets a changed column list to the source default', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    fireEvent.click(screen.getByTestId('search-columns-button-reset'));
    expect(screen.getByLabelText('Remove ServiceName')).toBeInTheDocument();
    expect(screen.getByTestId('search-columns-button-reset')).toBeDisabled();
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('', []);
  });

  it('shows the default SELECT as the SQL value', async () => {
    renderPopover({ value: '' });
    openPopover();
    expect(
      await screen.findByTestId('search-columns-button-reset'),
    ).toBeDisabled();
    fireEvent.click(await screen.findByText('SQL'));
    expect(screen.getByLabelText('SELECT')).toHaveValue(
      'Timestamp, ServiceName, Body',
    );
  });

  it('edits the SELECT on the SQL tab', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('SQL'));
    fireEvent.change(screen.getByLabelText('SELECT'), {
      target: { value: 'count()' },
    });
    fireEvent.click(screen.getByTestId('search-columns-button-apply'));
    expect(onApply).toHaveBeenCalledWith('count()', ['Timestamp', 'Body']);
  });

  it('says Apply is what updates the search', async () => {
    renderPopover();
    openPopover();
    expect(await screen.findByText(/Then click Apply/)).toBeInTheDocument();
  });

  it('asks before Escape discards a SQL edit', async () => {
    renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('SQL'));
    fireEvent.change(screen.getByLabelText('SELECT'), {
      target: { value: 'count()' },
    });
    fireEvent.keyDown(screen.getByTestId('search-columns-button-popover'), {
      key: 'Escape',
    });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  });

  it('lets Escape close the column suggestions without closing the popover', async () => {
    renderPopover();
    openPopover();
    const input = await screen.findByPlaceholderText('Search columns');
    fireEvent.change(input, { target: { value: 'Severity' } });
    expect(await screen.findByText('SeverityText')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('search-columns-button')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('Severity');
  });

  it('lets Escape close the SQL completion list without discarding', async () => {
    renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('SQL'));
    fireEvent.change(screen.getByLabelText('SELECT'), {
      target: { value: 'count()' },
    });
    const popover = screen.getByTestId('search-columns-button-popover');
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const field = document.createElement('div');
    const tooltip = document.createElement('div');
    tooltip.className = 'cm-tooltip-autocomplete';
    field.appendChild(tooltip);
    editor.appendChild(field);
    popover.appendChild(editor);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(confirm).not.toHaveBeenCalled();
    expect(popover).toBeInTheDocument();
  });

  it('shrinks to the viewport so Apply stays on screen', async () => {
    renderPopover();
    openPopover();
    await waitFor(() => {
      const popover = document.querySelector(
        '[data-testid="search-columns-button-popover"]',
      );
      expect(popover?.getAttribute('style')).toContain('calc(100vw - 16px)');
    });
  });

  it('discards the draft on cancel', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() =>
      expect(
        screen.queryByTestId('search-columns-button-popover'),
      ).not.toBeInTheDocument(),
    );
    openPopover();
    expect(await screen.findByLabelText('Remove Body')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not ask when the stored clause already equals the default', async () => {
    const clause = 'Timestamp, Body';
    renderPopover({ value: clause, defaultValue: clause });
    openPopover();
    expect(await screen.findByLabelText('Remove Body')).toBeInTheDocument();
    closePopover();
    await waitFor(() =>
      expect(
        screen.queryByTestId('search-columns-button-popover'),
      ).not.toBeInTheDocument(),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks after editing a clause that already equals the default', async () => {
    const clause = 'Timestamp, Body';
    renderPopover({ value: clause, defaultValue: clause });
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    confirm.mockResolvedValueOnce(false);
    closePopover();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId('search-columns-button-popover'),
    ).toBeInTheDocument();
  });

  it('closes an unchanged list without asking', async () => {
    renderPopover();
    openPopover();
    expect(
      await screen.findByTestId('search-columns-button-popover'),
    ).toBeInTheDocument();
    closePopover();
    await waitFor(() =>
      expect(
        screen.queryByTestId('search-columns-button-popover'),
      ).not.toBeInTheDocument(),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before discarding a column edit', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));

    confirm.mockResolvedValueOnce(false);
    closePopover();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      'Discard unsaved changes?',
      'Discard',
      {
        variant: 'danger',
      },
    );
    expect(
      screen.getByTestId('search-columns-button-popover'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove Body')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    closePopover();
    await waitFor(() =>
      expect(
        screen.queryByTestId('search-columns-button-popover'),
      ).not.toBeInTheDocument(),
    );
    openPopover();
    expect(await screen.findByLabelText('Remove Body')).toBeInTheDocument();
  });

  it('asks when a click outside would discard a column edit', async () => {
    renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    confirm.mockResolvedValueOnce(false);
    fireEvent.mouseDown(document.documentElement);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId('search-columns-button-popover'),
    ).toBeInTheDocument();
  });

  it('asks when a click outside lands during an unsaved inline edit', async () => {
    const { onApply } = renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('Body'));
    fireEvent.change(screen.getByTestId('search-columns-edit-input'), {
      target: { value: 'upper(Body) AS message' },
    });
    confirm.mockResolvedValueOnce(false);
    fireEvent.mouseDown(document.documentElement);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId('search-columns-button-popover'),
    ).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not ask for an inline edit that has not changed the column', async () => {
    renderPopover();
    openPopover();
    fireEvent.click(await screen.findByText('Body'));
    expect(screen.getByTestId('search-columns-edit-input')).toHaveValue('Body');
    fireEvent.mouseDown(document.documentElement);
    await waitFor(() =>
      expect(
        screen.queryByTestId('search-columns-button-popover'),
      ).not.toBeInTheDocument(),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks when a click outside lands with unadded search text', async () => {
    renderPopover();
    openPopover();
    fireEvent.change(await screen.findByPlaceholderText('Search columns'), {
      target: { value: 'upper(Body)' },
    });
    confirm.mockResolvedValueOnce(false);
    fireEvent.mouseDown(document.documentElement);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  });

  it('ignores a second dismiss while the discard dialog is open', async () => {
    let settle: (discard: boolean) => void = () => {};
    confirm.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          settle = resolve;
        }),
    );
    renderPopover();
    openPopover();
    fireEvent.click(await screen.findByLabelText('Remove Body'));
    closePopover();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));

    fireEvent.mouseDown(document.documentElement);
    closePopover();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('search-columns-button-popover'),
    ).toBeInTheDocument();

    settle(false);
    await waitFor(() =>
      expect(
        screen.getByTestId('search-columns-button-popover'),
      ).toBeInTheDocument(),
    );
  });
});
