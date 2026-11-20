import { screen } from '@testing-library/react';

import { HeatmapTooltip } from '@/components/DBHeatmapChart/HeatmapTooltip';

jest.mock('@/useFormatTime', () => ({
  FormatTime: ({ value }: { value: number }) => <span>time:{value}</span>,
}));

const point = {
  xVal: 1000,
  yVal: 2,
  countVal: 1234,
  closestDistance: 0,
  closestIndex: 0,
  xCoord: 10,
  yCoord: 10,
  xSize: 5,
  ySize: 5,
};

const renderTooltip = (
  props: Partial<React.ComponentProps<typeof HeatmapTooltip>> = {},
) =>
  renderWithMantine(
    <HeatmapTooltip
      point={point}
      cell={{ kind: 'distribution', formattedY: 'y=2', percentile: undefined }}
      containerRect={new DOMRect(100, 200, 400, 300)}
      showDragHint={false}
      {...props}
    />,
  );

describe('HeatmapTooltip', () => {
  it('shows the time, formatted y value and count', () => {
    renderTooltip();

    expect(screen.getByText('time:1000')).toBeInTheDocument();
    expect(screen.getByText('y=2')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('keeps significant digits of small counts', () => {
    renderTooltip({ point: { ...point, countVal: 0.000278 } });

    expect(screen.getByText('0.000278')).toBeInTheDocument();
  });

  it('appends the percentile when known', () => {
    renderTooltip({
      cell: { kind: 'distribution', formattedY: 'y=2', percentile: 95.25 },
    });

    expect(screen.getByText(/y=2 \(p95\.3\)/)).toBeInTheDocument();
  });

  it('shows the series name and value instead of the y value and count', () => {
    renderTooltip({
      cell: { kind: 'series', name: 'checkout', formattedValue: '12 ms' },
    });

    expect(screen.getByText('checkout')).toBeInTheDocument();
    expect(screen.getByText('12 ms')).toBeInTheDocument();
    expect(screen.queryByText('y=2')).not.toBeInTheDocument();
    expect(screen.queryByText('1,234')).not.toBeInTheDocument();
  });

  it('centers the cell highlight on the hovered cell', () => {
    const { container } = renderTooltip({
      point: { ...point, xCoord: 100, yCoord: 50, xSize: 20, ySize: 40 },
    });

    const highlight = container.querySelector<HTMLElement>(
      'div[style*="pointer-events: none"]',
    );
    expect(highlight?.style).toMatchObject({
      top: '30px',
      left: '90px',
      width: '20px',
      height: '40px',
    });
  });

  it('shows the drag hint only when filtering is enabled', () => {
    const { unmount } = renderTooltip();
    expect(screen.queryByText(/Drag to Compare/)).not.toBeInTheDocument();
    unmount();

    renderTooltip({ showDragHint: true });
    expect(screen.getByText(/Drag to Compare/)).toBeInTheDocument();
  });

  it('renders the tooltip outside the chart container, in viewport coordinates', () => {
    const viewportHeight = jest
      .spyOn(document.documentElement, 'clientHeight', 'get')
      .mockReturnValue(1000);
    const { container } = renderTooltip();

    const tooltip = screen
      .getByText('time:1000')
      .closest<HTMLElement>('div[style*="position: fixed"]');
    expect(tooltip).not.toBeNull();
    expect(container.contains(tooltip)).toBe(false);
    expect(tooltip?.style.top).toBe('215px');
    expect(tooltip?.style.left).toBe('120px');
    viewportHeight.mockRestore();
  });

  it('keeps the tooltip inside the viewport near its bottom and right edges', () => {
    const viewport = [
      jest
        .spyOn(document.documentElement, 'clientHeight', 'get')
        .mockReturnValue(400),
      jest
        .spyOn(document.documentElement, 'clientWidth', 'get')
        .mockReturnValue(1200),
    ];
    renderTooltip({ point: { ...point, xCoord: 300, yCoord: 190 } });

    const tooltip = screen
      .getByText('time:1000')
      .closest<HTMLElement>('div[style*="position: fixed"]');
    // Cursor at y=390 in a 400px viewport: opens above the cursor.
    expect(tooltip?.style.bottom).toBe('15px');
    expect(tooltip?.style.top).toBe('');
    // Right half of the container: anchored to the left of the cursor.
    expect(tooltip?.style.right).toBe('810px');
    expect(tooltip?.style.left).toBe('');
    viewport.forEach(spy => spy.mockRestore());
  });
});
