/**
 * A `DATA_SOURCE` dashboard filter is a single-select variable whose value is
 * a source. Tiles and other filters reference it as `$name` in place of a
 * source, block until it has a selection, and cannot carry alerts.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../utils/constants';

test.describe(
  'Dashboard data source variables',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    test('drives tiles and filters from the selected source', async ({
      page,
    }) => {
      const editor = dashboardPage.chartEditor;
      const reloadWithoutFilterState = async () => {
        const url = new URL(page.url());
        url.search = '';
        await page.goto(url.toString());
        await dashboardPage.waitForLoaded();
      };

      await test.step('Create a data source variable limited to logs', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addDataSourceFilterToDashboard(
          'Logs source',
          ['Logs'],
          'logs',
        );
        await expect(
          dashboardPage.getFilterItemByName('Logs source'),
        ).toContainText('($logs)');
      });

      await test.step('A queried filter can read from the variable', async () => {
        await dashboardPage.addFilterToDashboard(
          'Service',
          '$logs',
          'ServiceName',
        );
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toContainText('$logs');
        await dashboardPage.closeFiltersModal();
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Service'),
        ).toBeVisible();
      });

      await test.step('The variable offers only allowed kinds', async () => {
        await dashboardPage.getFilterSelectByName('Logs source').click();
        await expect(
          dashboardPage.getFilterOption(DEFAULT_LOGS_SOURCE_NAME),
        ).toBeVisible();
        await expect(
          dashboardPage.getFilterOption(DEFAULT_TRACES_SOURCE_NAME),
        ).toHaveCount(0);
        await page.keyboard.press('Escape');
      });

      await test.step('A tile can be saved on the variable before it has a value', async () => {
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await expect(editor.alertButton).toBeVisible();
        await editor.setChartName('Variable tile');
        await editor.selectSource('$logs');
        await expect(editor.alertButton).toHaveCount(0);
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1);
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).toContainText('Logs source');
      });

      await test.step('A selection loads the tile and the filter', async () => {
        await dashboardPage.selectReferenceFilterValue(
          'Logs source',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).toHaveCount(0);
        await expect(dashboardPage.getTileTimeChart(0)).toBeVisible();
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Service'),
        ).toHaveCount(0);
        await dashboardPage.openFilterDropdown('Service');
        await expect(dashboardPage.getFilterOption(SERVICES[0])).toBeVisible();
        await page.keyboard.press('Escape');
      });

      await test.step('The editor keeps the reference', async () => {
        await dashboardPage.editTile(0);
        await expect(editor.source).toHaveValue('$logs');
        await expect(editor.alertButton).toHaveCount(0);
        await editor.save();
      });

      await test.step('A saved selection is the initial value', async () => {
        await dashboardPage.saveQueryAndFiltersAsDefault();
        await reloadWithoutFilterState();

        await expect(
          dashboardPage.getFilterSelectByName('Logs source'),
        ).toHaveValue(DEFAULT_LOGS_SOURCE_NAME);
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).toHaveCount(0);
      });

      await test.step('A selection the variable no longer offers stops applying', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openEditFilterForm('Logs source');
        const kindsInput = page.getByTestId(
          'filter-allowed-source-kinds-input',
        );
        await kindsInput.click();
        await dashboardPage.getFilterOption('Traces').click();
        await dashboardPage.getFilterOption('Logs').click();
        await dashboardPage.getFilterNameInput().click();
        await page.getByTestId('save-filter-button').click();
        await dashboardPage.closeFiltersModal();

        await expect(
          dashboardPage.getFilterSelectByName('Logs source'),
        ).toHaveValue('');
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).toContainText('Logs source');
      });
    });

    // Data source variables are always required, so "Block every tile" is
    // offered on its own and reaches tiles with a fixed source.
    test('blocks a fixed-source tile when set to block every tile', async () => {
      test.setTimeout(150000);

      await test.step('Add a fixed-source tile and a global data source variable', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Logs count',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addDataSourceFilterToDashboard(
          'Logs source',
          ['Logs'],
          'logs',
          { globalRequirement: true },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The tile is blocked though it does not use the variable', async () => {
        const placeholder = dashboardPage.getTileMissingRequiredFilters(0);
        await expect(placeholder).toBeVisible({ timeout: 20000 });
        await expect(placeholder).toContainText('Logs source');
      });

      await test.step('Selecting a source loads it', async () => {
        await dashboardPage.selectReferenceFilterValue(
          'Logs source',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).toHaveCount(0, { timeout: 20000 });
        await expect(dashboardPage.getNumberTileValue(0)).toBeVisible({
          timeout: 30000,
        });
      });
    });

    // A filter edit can leave other filters with a variable they can't always
    // use. It still saves, and the filter shows an error while it can't.
    test("saves a kind other filters can't use, and flags them while it's selected", async ({
      page,
    }) => {
      await test.step('An ad hoc filter reads from a logs variable', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addDataSourceFilterToDashboard(
          'Logs source',
          ['Logs'],
          'logs',
        );
        await dashboardPage.addAdhocFilterToDashboard('Conditions', ['$logs']);
      });

      await test.step('Metrics can be added to the variable', async () => {
        await dashboardPage.openEditFilterForm('Logs source');
        await page.getByTestId('filter-allowed-source-kinds-input').click();
        await dashboardPage.getFilterOption('OTel metrics').click();
        await dashboardPage.getFilterNameInput().click();
        await page.getByTestId('save-filter-button').click();
        await dashboardPage.closeFiltersModal();
        await expect(page.getByText('Unable to save dashboard')).toHaveCount(0);
      });

      await test.step('Selecting a metric source flags the ad hoc filter', async () => {
        await dashboardPage.selectReferenceFilterValue(
          'Logs source',
          DEFAULT_METRICS_SOURCE_NAME,
        );
        await expect(
          dashboardPage.getFilterErrorIcon('Conditions'),
        ).toBeVisible();

        await dashboardPage.selectReferenceFilterValue(
          'Logs source',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await expect(
          dashboardPage.getFilterErrorIcon('Conditions'),
        ).toHaveCount(0);
      });

      await test.step('The added kind was saved', async () => {
        await page.reload();
        await dashboardPage.waitForLoaded();
        await dashboardPage.getFilterSelectByName('Logs source').click();
        await expect(
          dashboardPage.getFilterOption(DEFAULT_METRICS_SOURCE_NAME),
        ).toBeVisible();
      });
    });
  },
);
