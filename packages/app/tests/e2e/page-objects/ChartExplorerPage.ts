/**
 * ChartExplorerPage - Page object for the /chart page
 * Encapsulates all interactions with the chart explorer interface
 */
import { Locator, Page } from '@playwright/test';

import { ChartEditorComponent } from '../components/ChartEditorComponent';

export class ChartExplorerPage {
  readonly page: Page;
  readonly chartEditor: ChartEditorComponent;
  private readonly chartForm: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chartEditor = new ChartEditorComponent(page);
    this.chartForm = page.locator('[data-testid="chart-explorer-form"]');
  }

  /**
   * Navigate to the chart explorer page
   */
  async goto() {
    await this.page.goto('/chart');
  }

  /** Navigate to the chart explorer with an absolute time range. */
  async gotoWithTimeRange(from: Date, to: Date) {
    await this.page.goto(`/chart?from=${from.getTime()}&to=${to.getTime()}`);
  }

  /** Read the time chart's x-axis tick labels, left to right. */
  async getTimeChartXAxisLabels(): Promise<string[]> {
    const ticks = this.getFirstChart().locator(
      '.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value',
    );
    await ticks.first().waitFor({ state: 'visible', timeout: 15000 });
    const labels = await ticks.allTextContents();
    return labels.map(l => l.trim());
  }

  /**
   * Get chart containers (recharts)
   */
  getChartContainers() {
    return this.page.locator('.recharts-responsive-container');
  }

  /**
   * Get the first chart container
   */
  getFirstChart() {
    return this.getChartContainers().first();
  }

  /**
   * Get the rendered bar rectangles inside the categorical bar chart. One
   * locator per bar, so `.count()` yields the number of bars displayed.
   */
  getBars() {
    return this.page.locator(
      '[data-testid="bar-chart-container"] .recharts-bar-rectangle',
    );
  }

  /**
   * Read the x-axis category labels of the bar chart in the order they are
   * rendered (left to right), which reflects the order of the underlying
   * query result. Labels may be truncated with an ellipsis by the chart.
   */
  async getBarLabels(): Promise<string[]> {
    // Recharts renders axis tick labels in a dedicated
    // `.recharts-<axis>-tick-labels` group (hoisted into a top-level z-index
    // layer, so it is no longer nested inside the `.recharts-xAxis` element).
    // Scope to the x-axis label group to read category labels without picking
    // up the y-axis ticks.
    const ticks = this.page.locator(
      '[data-testid="bar-chart-container"] .recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value',
    );
    await ticks.first().waitFor({ state: 'visible', timeout: 15000 });
    const labels = await ticks.allTextContents();
    return labels.map(l => l.trim());
  }

  /**
   * Read the legend labels of the pie chart in the order they are rendered
   * (top to bottom), which reflects the order of the underlying query result.
   */
  async getPieLegendLabels(): Promise<string[]> {
    const legend = this.page.locator('[data-testid="pie-chart-legend"]');
    await legend.waitFor({ state: 'visible', timeout: 15000 });
    // Each legend row renders its label in a <p> (Mantine Text) that carries a
    // `title` attribute equal to the full, untruncated label.
    const titles = await legend
      .locator('[title]')
      .evaluateAll(nodes =>
        nodes.map(n => (n.getAttribute('title') ?? '').trim()),
      );
    return titles.filter(t => t.length > 0);
  }

  /** The sort button in the header of the results table column `name`. */
  getTableSortButton(name: string) {
    return this.page
      .getByTestId('raw-log-table-sort-button')
      .filter({ hasText: name });
  }

  /** Header sort arrows shown in the results table. */
  getTableSortIndicators() {
    return this.page.getByTestId('raw-log-table-sort-indicator');
  }

  /** The text of the chart editor's ORDER BY input, excluding its placeholder. */
  async getOrderByText(): Promise<string> {
    const content = this.page
      .getByTestId('order-by-input')
      .locator('.cm-content');
    // CodeMirror renders the placeholder only when the editor is empty.
    if ((await content.locator('.cm-placeholder').count()) > 0) return '';
    return ((await content.textContent()) ?? '').trim();
  }

  /** Cell values of results table column `name`, top to bottom. */
  async getTableColumnValues(name: string): Promise<string[]> {
    const headers = (
      await this.page.locator('table thead th').allTextContents()
    ).map(h => h.trim());
    const index = headers.findIndex(h => h === name);
    if (index === -1) return [];
    const cells = this.page.locator(
      `table tbody tr[data-index] td:nth-child(${index + 1})`,
    );
    return (await cells.allTextContents()).map(c => c.trim());
  }

  // Getters for assertions

  get form() {
    return this.chartForm;
  }
}
