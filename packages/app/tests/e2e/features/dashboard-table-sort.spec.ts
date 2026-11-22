import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';

test.describe(
  'Dashboard table tile sorting',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      test.setTimeout(60000);
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
    });

    test('should run an edited Order By instead of the last header sort', async () => {
      const ts = Date.now();
      let headerSortValues: string[] = [];

      await test.step('Add a table tile grouped by ServiceName', async () => {
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartType(DisplayType.Table);
        await dashboardPage.chartEditor.setChartName(`E2E Table Sort ${ts}`);
        await dashboardPage.chartEditor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
        await dashboardPage.chartEditor.setGroupBy('ServiceName');
        await dashboardPage.chartEditor.runQuery(false);
        await dashboardPage.saveTile();
        await dashboardPage.waitForTableTileRows(0);
      });

      await test.step('Sort the tile by clicking the ServiceName header', async () => {
        await dashboardPage.getTileSortButton(0, 'ServiceName').click();
        await expect(
          dashboardPage.getTile(0).getByTestId('raw-log-table-sort-indicator'),
        ).toHaveCount(1);
        await expect
          .poll(
            async () =>
              (await dashboardPage.getTileColumnValues(0, 'ServiceName'))
                .length,
            { timeout: 10000 },
          )
          .toBeGreaterThan(1);
        headerSortValues = await dashboardPage.getTileColumnValues(
          0,
          'ServiceName',
        );
      });

      await test.step('Edit the tile to order by the opposite direction', async () => {
        const headerSortAsc =
          JSON.stringify(headerSortValues) ===
          JSON.stringify([...headerSortValues].sort());
        await dashboardPage.editTile(0);
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.setOrderBy(
          `ServiceName ${headerSortAsc ? 'DESC' : 'ASC'}`,
        );
        await dashboardPage.saveTile();
      });

      await test.step('Verify the tile runs the edited Order By', async () => {
        await expect
          .poll(() => dashboardPage.getTileColumnValues(0, 'ServiceName'), {
            timeout: 10000,
          })
          .toEqual([...headerSortValues].reverse());
        await expect(
          dashboardPage.getTile(0).getByTestId('raw-log-table-sort-indicator'),
        ).toHaveCount(0);
      });
    });
  },
);
