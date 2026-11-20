import React from 'react';
import { randomUUID } from 'crypto';
import type { ColorCondition } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SeriesColorDrawer from '@/components/SeriesColorDrawer';

// The jsdom test environment may not expose crypto.randomUUID, which
// ColorRulesEditor uses for stable dnd keys. Back it with Node's
// implementation when absent so the rules path is deterministic.
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {},
    configurable: true,
  });
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: randomUUID,
    configurable: true,
  });
}

describe('SeriesColorDrawer', () => {
  it('calls onChange with the picked static color on Apply', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    renderWithMantine(
      <SeriesColorDrawer opened onChange={onChange} onClose={jest.fn()} />,
    );

    await user.click(screen.getByTestId('color-swatch-input-trigger'));
    await user.click(
      await screen.findByTestId('color-swatch-option-chart-blue'),
    );
    await user.click(screen.getByTestId('series-color-apply'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ color: 'chart-blue' });
  });

  it('round-trips existing rules on Apply and strips client-side ids', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const colorRules: ColorCondition[] = [
      { operator: 'gt', value: 500, color: 'chart-error' },
    ];

    renderWithMantine(
      <SeriesColorDrawer
        opened
        colorRules={colorRules}
        onChange={onChange}
        onClose={jest.fn()}
      />,
    );

    await user.click(screen.getByTestId('series-color-apply'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].colorRules).toEqual(colorRules);
    // The client-side localId must not leak into the persisted shape.
    expect(onChange.mock.calls[0][0].colorRules[0]).not.toHaveProperty(
      'localId',
    );
  });

  it('clears color and rules when Clear is clicked', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    renderWithMantine(
      <SeriesColorDrawer
        opened
        color="chart-error"
        onChange={onChange}
        onClose={jest.fn()}
      />,
    );

    await user.click(screen.getByTestId('series-color-clear'));
    await user.click(screen.getByTestId('series-color-apply'));

    expect(onChange).toHaveBeenCalledWith({
      color: undefined,
      colorRules: undefined,
    });
  });

  it('shows color rules but no line style for table columns', () => {
    renderWithMantine(
      <SeriesColorDrawer opened onChange={jest.fn()} onClose={jest.fn()} />,
    );

    expect(screen.getByText('Column color')).toBeInTheDocument();
    expect(screen.getByTestId('color-rules-add-button')).toBeInTheDocument();
    expect(
      screen.queryByTestId('series-line-style-control'),
    ).not.toBeInTheDocument();
  });

  describe('line series', () => {
    it('shows a line style instead of color rules', () => {
      renderWithMantine(
        <SeriesColorDrawer
          opened
          mode="line"
          onChange={jest.fn()}
          onClose={jest.fn()}
        />,
      );

      expect(screen.getByText('Series style')).toBeInTheDocument();
      expect(
        screen.getByTestId('series-line-style-control'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('color-rules-add-button'),
      ).not.toBeInTheDocument();
    });

    it('applies the picked color and line style', async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();

      renderWithMantine(
        <SeriesColorDrawer
          opened
          mode="line"
          onChange={onChange}
          onClose={jest.fn()}
        />,
      );

      await user.click(screen.getByTestId('color-swatch-input-trigger'));
      await user.click(
        await screen.findByTestId('color-swatch-option-chart-purple'),
      );
      await user.click(screen.getByRole('radio', { name: 'Dashed' }));
      await user.click(screen.getByTestId('series-color-apply'));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toMatchObject({
        color: 'chart-purple',
        lineStyle: 'dashed',
      });
    });

    it('stores solid as unset, since solid is the default', async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();

      renderWithMantine(
        <SeriesColorDrawer
          opened
          mode="line"
          lineStyle="dotted"
          onChange={onChange}
          onClose={jest.fn()}
        />,
      );

      await user.click(screen.getByRole('radio', { name: 'Solid' }));
      await user.click(screen.getByTestId('series-color-apply'));

      expect(onChange.mock.calls[0][0].lineStyle).toBeUndefined();
    });

    // Rules come from table display; they are not editable here, so a line
    // edit must hand them back untouched for a later switch back to table.
    it('keeps existing column rules when applying and clearing', async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      const colorRules: ColorCondition[] = [
        { operator: 'gt', value: 500, color: 'chart-error' },
      ];

      renderWithMantine(
        <SeriesColorDrawer
          opened
          mode="line"
          color="chart-blue"
          lineStyle="dashed"
          colorRules={colorRules}
          onChange={onChange}
          onClose={jest.fn()}
        />,
      );

      await user.click(screen.getByTestId('series-color-clear'));
      await user.click(screen.getByTestId('series-color-apply'));

      expect(onChange).toHaveBeenCalledWith({
        color: undefined,
        lineStyle: undefined,
        colorRules,
      });
    });
  });

  it('shows only a color for bar series', () => {
    renderWithMantine(
      <SeriesColorDrawer
        opened
        mode="bar"
        onChange={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Series color')).toBeInTheDocument();
    expect(
      screen.getByTestId('color-swatch-input-trigger'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('series-line-style-control'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('color-rules-add-button'),
    ).not.toBeInTheDocument();
  });
});
