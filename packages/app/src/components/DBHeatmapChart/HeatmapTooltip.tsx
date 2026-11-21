import { createPortal } from 'react-dom';
import { Divider, Text } from '@mantine/core';

import {
  toViewportPoint,
  useChartTooltipZIndex,
} from '@/components/charts/ChartTooltip';
import { FormatTime } from '@/useFormatTime';

import type { HighlightedPoint } from './highlightDataPlugin';

/** What the hovered cell holds: a series' value, or a y bucket's count. */
export type HeatmapTooltipCell =
  | { kind: 'series'; name: string; formattedValue: string }
  | {
      kind: 'bucket';
      formattedRange: string;
      percentile: number | undefined;
    }
  | {
      kind: 'distribution';
      formattedY: string;
      percentile: number | undefined;
    };

// Histogram cells hold rate() values, which can be far below 0.001; keep
// significant digits there without rounding large counts.
const COUNT_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3,
  maximumSignificantDigits: 3,
  roundingPriority: 'morePrecision',
});

type HeatmapTooltipProps = {
  point: HighlightedPoint;
  cell: HeatmapTooltipCell;
  /** Chart container's viewport rect; the tooltip is portaled so a tile can't clip or scroll it. */
  containerRect: DOMRect | undefined;
  showDragHint: boolean;
};

export function HeatmapTooltip({
  point,
  cell,
  containerRect,
  showDragHint,
}: HeatmapTooltipProps) {
  const zIndex = useChartTooltipZIndex();
  const anchor = toViewportPoint(containerRect, {
    x: point.xCoord,
    y: point.yCoord,
  });
  // Fixed elements resolve against the viewport minus scrollbars, not window.inner*.
  const { clientWidth: viewportWidth, clientHeight: viewportHeight } =
    document.documentElement;
  // Open away from the nearer edges so the tooltip fits without knowing its size.
  const flipLeft = point.xCoord > (containerRect?.width ?? 0) / 2;
  const flipUp = anchor.y > viewportHeight / 2;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: point.yCoord - point.ySize / 2,
          left: point.xCoord - point.xSize / 2,
          width: point.xSize,
          height: point.ySize,
          pointerEvents: 'none',
          background: 'var(--mantine-color-default-hover)',
        }}
      />
      {createPortal(
        <div
          data-testid="heatmap-tooltip"
          className="px-2 py-1 fs-8"
          style={{
            position: 'fixed',
            zIndex,
            ...(flipUp
              ? { bottom: viewportHeight - anchor.y + 5 }
              : { top: anchor.y + 5 }),
            ...(flipLeft
              ? { right: viewportWidth - anchor.x + 10 }
              : { left: anchor.x + 10 }),
            maxWidth: (containerRect?.width ?? viewportWidth) / 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
            backdropFilter: 'blur(8px)',
            backgroundColor: 'var(--mantine-color-body)',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        >
          {showDragHint && (
            <>
              <Text size="10px" pt="4px">
                Drag to Compare · Click to Clear
              </Text>
              <Divider my="xs" />
            </>
          )}
          <div>
            <FormatTime value={point.xVal} />
          </div>
          {cell.kind === 'series' ? (
            <>
              <div>
                <b>Series:</b> {cell.name}
              </div>
              <div>
                <b>Value:</b> {cell.formattedValue}
              </div>
            </>
          ) : (
            <>
              <div>
                {cell.kind === 'bucket' ? (
                  <>
                    <b>Bucket:</b> {cell.formattedRange}
                  </>
                ) : (
                  <>
                    <b>Y Value:</b> {cell.formattedY}
                  </>
                )}
                {cell.percentile != null &&
                  ` (p${new Intl.NumberFormat('en-US', {
                    maximumFractionDigits: 1,
                  }).format(cell.percentile)})`}
              </div>
              <div>
                <b>Count Value:</b> {COUNT_FORMAT.format(point.countVal)}
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
