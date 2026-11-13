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
  },
);
