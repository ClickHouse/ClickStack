/**
 * `DATA_SOURCE` and `CONNECTION` dashboard filters are single-select variables
 * whose value is a source or a connection. Tiles and other filters reference
 * them as `$name` in place of an ID, block until they have a selection, and
 * cannot carry alerts.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_CONNECTION_NAME,
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

    test('drives a raw SQL tile from connection and source variables', async () => {
      const editor = dashboardPage.chartEditor;

      await test.step('Create a connection variable and a source variable limited to it', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addConnectionFilterToDashboard(
          'Cluster',
          'cluster',
        );
        await dashboardPage.addDataSourceFilterToDashboard(
          'Logs source',
          ['Logs'],
          'logs',
          '$cluster',
        );
        await expect(
          dashboardPage.getFilterItemByName('Logs source'),
        ).toContainText('$cluster');
        await dashboardPage.closeFiltersModal();
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Logs source'),
        ).toBeVisible();
      });

      await test.step('A raw SQL tile on the variables cannot have an alert', async () => {
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.setChartType(DisplayType.Number);
        await editor.setChartName('Variable count');
        await editor.switchToSqlMode();
        await expect(editor.alertButton).toBeVisible();
        await editor.selectConnection('$cluster');
        await editor.selectSource('$logs');
        await expect(editor.alertButton).toHaveCount(0);
        await editor.typeSqlQuery('SELECT count() FROM $__sourceTable');
        await editor.save();
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).toContainText('Cluster');
      });

      await test.step('Selecting a connection, then a source on it, loads the tile', async () => {
        await dashboardPage.selectReferenceFilterValue(
          'Cluster',
          DEFAULT_CONNECTION_NAME,
        );
        await dashboardPage.selectReferenceFilterValue(
          'Logs source',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).toHaveCount(0);
        await expect(dashboardPage.getNumberTileValue(0)).toBeVisible();
      });

      await test.step('The editor keeps both references', async () => {
        await dashboardPage.editTile(0);
        await expect(editor.connection).toHaveValue('$cluster');
        await expect(editor.source).toHaveValue('$logs');
      });
    });
  },
);
