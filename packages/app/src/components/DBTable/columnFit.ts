import { MIN_COLUMN_WIDTH } from '@/tableUtils';

/** The widest a column gets when it is fitted to its content. */
const MAX_FITTED_COLUMN_WIDTH = 600;

/**
 * Width, in px, that a column's widest cell needs to show its content without
 * truncating or wrapping it. Only cells rendered in `table` count: the header
 * and whichever body rows are mounted. Cells name their column in
 * `data-column-id`; cells of tables nested in an expanded row are skipped.
 * Returns 0 when the column has no cells.
 */
export function measureColumnContentWidth(
  table: HTMLTableElement,
  columnId: string,
): number {
  const probes: HTMLElement[] = [];
  try {
    const measured = Array.from(
      table.querySelectorAll('[data-column-id]'),
    ).flatMap(cell => {
      const content = cell.firstElementChild;
      if (
        !(cell instanceof HTMLElement) ||
        cell.dataset.columnId !== columnId ||
        cell.closest('table') !== table ||
        !(content instanceof HTMLElement)
      ) {
        return [];
      }
      // A hidden copy at max-content width reports the width the content
      // needs, whatever width the column has now.
      const probe = content.cloneNode(true);
      if (!(probe instanceof HTMLElement)) return [];
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.width = 'max-content';
      cell.append(probe);
      probes.push(probe);
      return [{ cell, content, probe }];
    });

    // Every copy is in place before the first read, so the browser lays the
    // table out once rather than once per cell.
    const widths = measured.map(
      ({ cell, content, probe }) =>
        probe.getBoundingClientRect().width +
        // The padding and border the cell keeps around its content
        cell.getBoundingClientRect().width -
        content.getBoundingClientRect().width,
    );
    return Math.max(0, ...widths);
  } finally {
    probes.forEach(probe => probe.remove());
  }
}

/**
 * The width to give a column whose content is `contentWidth` px wide: no less
 * than the minimum column width, and no more than 600px or half of
 * `visibleTableWidth`, whichever is smaller, so one long value can't push the
 * other columns out of view.
 */
export function getFittedColumnWidth(
  contentWidth: number,
  visibleTableWidth: number,
): number {
  const maxWidth = Math.max(
    MIN_COLUMN_WIDTH,
    Math.min(MAX_FITTED_COLUMN_WIDTH, visibleTableWidth / 2),
  );
  return Math.min(
    maxWidth,
    Math.max(MIN_COLUMN_WIDTH, Math.ceil(contentWidth)),
  );
}
