/**
 * A `DATA_SOURCE` dashboard filter is a single-select variable whose value is
 * a source, picked from the filter bar.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
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

    test('picks a source of the allowed kinds from the filter bar', async ({
      page,
    }) => {
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
        await dashboardPage.closeFiltersModal();
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

      await test.step('A saved selection is the initial value', async () => {
        await dashboardPage.selectReferenceFilterValue(
          'Logs source',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.saveQueryAndFiltersAsDefault();
        const url = new URL(page.url());
        url.search = '';
        await page.goto(url.toString());
        await dashboardPage.waitForLoaded();

        await expect(
          dashboardPage.getFilterSelectByName('Logs source'),
        ).toHaveValue(DEFAULT_LOGS_SOURCE_NAME);
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
  },
);
